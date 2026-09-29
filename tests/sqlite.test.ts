import { afterEach, describe, expect, it } from "vitest";
import { createSqliteClient } from "@/lib/database/sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const clients: ReturnType<typeof createSqliteClient>[] = [];
function memory() {
  const client = createSqliteClient(":memory:");
  clients.push(client);
  return client.sql;
}
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});
describe("SQLite database mode", () => {
  it("creates sessions, preserves JSON and content, and supports the pipeline's upserts", async () => {
    const sql = memory();
    await sql`INSERT INTO sessions (id) VALUES (${"session"})`;
    const [session] = await sql`SELECT * FROM sessions WHERE id = ${"session"}`;
    expect(session.status).toBe("uploading");
    expect(new Date(session.expires_at).getTime() - Date.now()).toBeGreaterThan(
      23 * 3600000,
    );
    await sql`INSERT INTO files (id, session_id, original_name, extension, size, storage_key) VALUES (${"file"}, ${"session"}, ${"notes.txt"}, ${"txt"}, ${12}, ${"session/file"})`;
    const analysis = {
      subject: "Open-ended subject",
      confidence: 0.9,
      keywords: ["term"],
    };
    await sql`UPDATE files SET analysis = ${sql.json(analysis)}, semantic_fingerprint = ${sql.json([1, 2, 3])} WHERE id = ${"file"}`;
    const [file] = await sql`SELECT * FROM files WHERE id = ${"file"}`;
    expect(file.analysis).toEqual(analysis);
    expect(file.semantic_fingerprint).toEqual([1, 2, 3]);
    const content =
      "Quoted text: '; DROP TABLE sessions; -- now() + interval '24 hours'";
    await sql`INSERT INTO extracted_documents (file_id, content, visual, metadata) VALUES (${"file"}, ${content}, ${true}, ${sql.json({ pages: 2 })}) ON CONFLICT (file_id) DO UPDATE SET content = excluded.content`;
    const [document] =
      await sql`SELECT * FROM extracted_documents WHERE file_id = ${"file"}`;
    expect(document.content).toBe(content);
    expect(document.visual).toBe(true);
    expect(document.metadata).toEqual({ pages: 2 });
  });
  it("creates UUID taxonomy nodes and deletes complete sessions with foreign keys intact", async () => {
    const sql = memory();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO sessions (id) VALUES (${"s"})`;
      await tx`INSERT INTO files (id, session_id, original_name, extension, size, storage_key) VALUES (${"f"}, ${"s"}, ${"a.txt"}, ${"txt"}, ${1}, ${"s/f"})`;
      const [subject] =
        await tx`INSERT INTO subjects (session_id, name) VALUES (${"s"}, ${"Ecology"}) ON CONFLICT (session_id, name) DO UPDATE SET name = excluded.name RETURNING id`;
      expect(subject.id).toMatch(/^[0-9a-f-]{36}$/);
      const [chapter] =
        await tx`INSERT INTO chapters (subject_id, name) VALUES (${subject.id}, ${"Populations"}) RETURNING id`;
      const [topic] =
        await tx`INSERT INTO topics (chapter_id, name) VALUES (${chapter.id}, ${"Growth"}) RETURNING id`;
      await tx`INSERT INTO classifications (file_id, subject_id, chapter_id, topic_id, result) VALUES (${"f"}, ${subject.id}, ${chapter.id}, ${topic.id}, ${tx.json({ subject: "Ecology" })})`;
    });
    await sql`DELETE FROM sessions WHERE id = ${"s"}`;
    expect(await sql`SELECT * FROM files`).toHaveLength(0);
    expect(await sql`SELECT * FROM classifications`).toHaveLength(0);
    expect(await sql`SELECT * FROM subjects`).toHaveLength(0);
  });
  it("rolls back failed transactions and serializes concurrent callers", async () => {
    const sql = memory();
    await expect(
      sql.begin(async (tx) => {
        await tx`INSERT INTO sessions (id) VALUES (${"rollback"})`;
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await sql`SELECT * FROM sessions`).toHaveLength(0);
    await sql`INSERT INTO sessions (id) VALUES (${"locked"})`;
    const actions: string[] = [];
    await Promise.all([
      sql.begin(async (tx) => {
        await tx`SELECT * FROM sessions WHERE id = ${"locked"} FOR UPDATE`;
        actions.push("transaction");
        await Promise.resolve();
        await tx`UPDATE sessions SET status = 'queued' WHERE id = ${"locked"}`;
      }),
      (async () => {
        const [row] = await sql`SELECT * FROM sessions WHERE id = ${"locked"}`;
        actions.push(row.status);
      })(),
    ]);
    expect(actions).toEqual(["transaction", "queued"]);
  });
  it("supports expiration queries and atomic budget counters", async () => {
    const sql = memory();
    await sql`INSERT INTO sessions (id, expires_at) VALUES (${"old"}, now() - interval '24 hours')`;
    expect(
      await sql`SELECT id FROM sessions WHERE expires_at < now() - interval '15 minutes'`,
    ).toHaveLength(1);
    const increments = await Promise.all(
      Array.from(
        { length: 5 },
        () =>
          sql`INSERT INTO request_budgets (key, count, expires_at) VALUES (${"budget"}, 1, now() + interval '2 hours') ON CONFLICT (key) DO UPDATE SET count = request_budgets.count + 1 RETURNING count`,
      ),
    );
    expect(increments.map((rows) => rows[0].count)).toEqual([1, 2, 3, 4, 5]);
  });
  it("persists data after closing and reopening the local database file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studysort-sqlite-test-"));
    const path = join(directory, "test.sqlite");
    try {
      const first = createSqliteClient(path);
      try {
        await first.sql`INSERT INTO sessions (id) VALUES (${"persisted"})`;
      } finally {
        await first.close();
      }
      const second = createSqliteClient(path);
      try {
        expect(
          await second.sql`SELECT * FROM sessions WHERE id = ${"persisted"}`,
        ).toHaveLength(1);
      } finally {
        await second.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
