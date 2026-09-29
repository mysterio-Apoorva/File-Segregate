import { Readable } from "node:stream";
import { db } from "@/lib/database";
import { env } from "@/lib/config";
import { openObject } from "@/lib/storage";
import { apiError, authorize, HttpError } from "@/lib/security";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (env().STORAGE_DRIVER !== "local")
      throw new HttpError(404, "Local downloads are disabled.");
    const { id } = await context.params;
    const session = await authorize(id);
    if (session.status !== "complete")
      throw new HttpError(409, "Your ZIP is not ready yet.");
    const [archive] =
      await db()`SELECT storage_key FROM archives WHERE session_id = ${id}`;
    if (
      !archive ||
      archive.storage_key !== `${id}/archive/StudyMaterial_Organized.zip`
    )
      throw new HttpError(404, "Archive not found.");
    const object = await openObject(archive.storage_key);
    return new Response(Readable.toWeb(object.Body) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="StudyMaterial_Organized.zip"',
        "Content-Length": String(object.ContentLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
