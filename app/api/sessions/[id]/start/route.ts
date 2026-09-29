import { db } from "@/lib/database";
import { apiError, authorize, checkOrigin, HttpError } from "@/lib/security";
import { sealObject } from "@/lib/storage";
import { inngest } from "@/lib/jobs/client";
import type { FileRow } from "@/lib/schemas";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const { id } = await context.params;
    await authorize(id);
    const sql = db();
    await sql.begin(async (tx) => {
      const [session] =
        await tx`SELECT status FROM sessions WHERE id = ${id} FOR UPDATE`;
      if (session.status === "queued") return;
      if (session.status !== "uploading")
        throw new HttpError(
          409,
          "This session has already started or was cancelled.",
        );
      const files = await tx<
        FileRow[]
      >`SELECT * FROM files WHERE session_id = ${id}`;
      for (let offset = 0; offset < files.length; offset += 5) {
        await Promise.all(
          files.slice(offset, offset + 5).map(async (file) => {
            try {
              await sealObject(
                file.storage_key,
                `${id}/originals/${file.id}`,
                file.size,
              );
            } catch {
              throw new HttpError(
                409,
                `Upload is incomplete for ${file.original_name}. Retry the upload before organizing.`,
              );
            }
          }),
        );
      }
      for (const file of files)
        await tx`UPDATE files SET storage_key = ${`${id}/originals/${file.id}`}, status = 'queued' WHERE id = ${file.id}`;
      await tx`UPDATE sessions SET status = 'queued' WHERE id = ${id}`;
    });
    try {
      await inngest.send({
        id: `organize-${id}`,
        name: "studysort/session.requested",
        data: { sessionId: id },
      });
      await sql`UPDATE sessions SET dispatch_at = now() WHERE id = ${id}`;
    } catch {
      // Persisted outbox is recovered by the maintenance job.
      return Response.json(
        {
          queued: true,
          message: "Queued. The background scheduler will retry delivery.",
        },
        { status: 202 },
      );
    }
    return Response.json({ queued: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
