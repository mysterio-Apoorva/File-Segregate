import { db } from "@/lib/database";
import { apiError, authorize, HttpError } from "@/lib/security";
import { downloadUrl } from "@/lib/storage";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const session = await authorize(id);
    if (session.status !== "complete")
      throw new HttpError(409, "Your ZIP is not ready yet.");
    const [archive] =
      await db()`SELECT storage_key FROM archives WHERE session_id = ${id}`;
    if (!archive) throw new HttpError(404, "Archive not found.");
    return Response.json(
      { url: await downloadUrl(archive.storage_key) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
