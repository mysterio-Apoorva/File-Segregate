import { db } from "@/lib/database";
import { apiError, authorize, checkOrigin } from "@/lib/security";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await authorize(id);
    const sql = db();
    const [session] =
      await sql`SELECT id, status, created_at, expires_at, error, warning FROM sessions WHERE id = ${id}`;
    const files =
      await sql`SELECT id, session_id, original_name, extension, size, mime_type, status, error, analysis, duplicate_status, duplicate_of, duplicate_explanation, similarity, organized_path, extraction_metadata, created_at FROM files WHERE session_id = ${id} ORDER BY created_at, id`;
    const archive = await sql`SELECT 1 FROM archives WHERE session_id = ${id}`;
    return Response.json(
      {
        session,
        files,
        archiveReady: session.status === "complete" && archive.length > 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const { id } = await context.params;
    await authorize(id);
    await db()`UPDATE sessions SET status = 'cancelled' WHERE id = ${id} AND status NOT IN ('complete','failed','cancelled')`;
    return Response.json({ cancelled: true });
  } catch (error) {
    return apiError(error);
  }
}
