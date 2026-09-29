import { inngest } from "./client";
import {
  active,
  filesFor,
  prepareFile,
  analyzeChunk,
  finishAnalysis,
  checkDuplicates,
  reconcile,
  failFile,
} from "./pipeline";
import { db } from "@/lib/database";
import { createArchive } from "@/lib/zip";
import { deleteSessionObjects } from "@/lib/storage";
// Child workflows keep even 200 maximum-length documents below Inngest's
// per-run step limit, and maintain serial ordering for exact duplicate reuse.
export const processDocument = inngest.createFunction(
  {
    id: "process-document",
    retries: 2,
    concurrency: 3,
    idempotency: "event.data.fileId",
  },
  { event: "studysort/document.requested" },
  async ({ event, step }) => {
    const fileId = event.data.fileId as string;
    const prepared = await step.run("extract", () => prepareFile(fileId));
    if (!prepared.skip) {
      for (let i = 0; i < prepared.chunks; i++)
        await step.run(`analyze-${i}`, () =>
          analyzeChunk(fileId, i, prepared.visual),
        );
      await step.run("classify", () => finishAnalysis(fileId));
      await step.run("duplicates", () => checkDuplicates(fileId));
    }
    return { fileId };
  },
);
export const organize = inngest.createFunction(
  {
    id: "organize-session",
    retries: 2,
    concurrency: [{ limit: 3 }, { limit: 1, key: "event.data.sessionId" }],
    idempotency: "event.data.sessionId",
    onFailure: async ({ event }) => {
      const id = event.data.event.data.sessionId as string;
      await db()`UPDATE sessions SET status = 'failed', error = 'Processing stopped after bounded retries. Your originals remain stored until session expiration. Start a new session to retry.' WHERE id = ${id} AND status NOT IN ('complete','cancelled')`;
    },
  },
  { event: "studysort/session.requested" },
  async ({ event, step }) => {
    const id = event.data.sessionId as string;
    const ids = await step.run("begin", async () => {
      if (!(await active(id))) return [];
      await db()`UPDATE sessions SET status = 'processing' WHERE id = ${id} AND status IN ('queued','processing')`;
      return (await filesFor(id)).map((f) => f.id);
    });
    for (const fileId of ids) {
      const running = await step.run(`active-${fileId}`, () => active(id));
      if (!running) return { cancelled: true };
      try {
        await step.invoke(`document-${fileId}`, {
          function: processDocument,
          data: { fileId, sessionId: id },
        });
      } catch {
        await step.run(`failed-${fileId}`, () =>
          failFile(
            fileId,
            "Processing this file stopped after bounded retries. Its original is preserved for review.",
          ),
        );
      }
    }
    if (!(await step.run("active-before-archive", () => active(id))))
      return { cancelled: true };
    await step.run("reconcile-hierarchy", () => reconcile(id));
    await step.run("archive", async () => {
      if (!(await active(id))) return;
      await db()`UPDATE sessions SET status = 'archiving' WHERE id = ${id} AND status = 'processing'`;
      const files = await filesFor(id);
      if (!files.length) throw new Error("No uploaded originals available.");
      const archive = await createArchive(id, files);
      const sql = db();
      await sql.begin(async (tx) => {
        await tx`INSERT INTO archives (session_id, storage_key, size) VALUES (${id}, ${archive.key}, ${archive.size}) ON CONFLICT (session_id) DO UPDATE SET storage_key = excluded.storage_key, size = excluded.size, generated_at = now()`;
        await tx`UPDATE sessions SET status = 'complete' WHERE id = ${id} AND status = 'archiving'`;
        await tx`DELETE FROM extracted_documents WHERE file_id IN (SELECT id FROM files WHERE session_id = ${id})`;
        await tx`DELETE FROM document_chunks WHERE file_id IN (SELECT id FROM files WHERE session_id = ${id})`;
      });
    });
    return { sessionId: id };
  },
);
export const maintenance = inngest.createFunction(
  { id: "maintenance", retries: 3, concurrency: 1 },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const expired = await step.run("find-expired", async () =>
      (
        await db()`SELECT id FROM sessions WHERE expires_at < now() - interval '15 minutes' ORDER BY expires_at LIMIT 100`
      ).map((s) => s.id as string),
    );
    for (const id of expired)
      await step.run(`delete-${id}`, async () => {
        await deleteSessionObjects(id);
        await db()`DELETE FROM sessions WHERE id = ${id} AND expires_at < now()`;
      });
    await step.run(
      "expire-budgets",
      () => db()`DELETE FROM request_budgets WHERE expires_at < now()`,
    );
    // Outbox recovery: a crash between committing 'queued' and sending the event cannot strand a session.
    const queued = await step.run("find-undispatched", async () =>
      (
        await db()`SELECT id FROM sessions WHERE status = 'queued' AND (dispatch_at IS NULL OR dispatch_at < now() - interval '15 minutes') AND expires_at > now() LIMIT 100`
      ).map((s) => s.id as string),
    );
    for (const id of queued)
      await step.sendEvent(`dispatch-${id}`, {
        id: `organize-${id}`,
        name: "studysort/session.requested",
        data: { sessionId: id },
      });
    return { deleted: expired.length, dispatched: queued.length };
  },
);
