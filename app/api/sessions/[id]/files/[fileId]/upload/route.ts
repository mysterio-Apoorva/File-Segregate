import { z } from "zod";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { db } from "@/lib/database";
import { env } from "@/lib/config";
import { localStorage } from "@/lib/storage";
import { validUploadSignature } from "@/lib/storage/local";
import { apiError, authorize, checkOrigin, HttpError } from "@/lib/security";
export const runtime = "nodejs";
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    if (env().STORAGE_DRIVER !== "local")
      throw new HttpError(404, "Local uploads are disabled.");
    checkOrigin(request);
    const { id, fileId } = await context.params;
    const session = await authorize(id);
    if (!z.uuid().safeParse(fileId).success)
      throw new HttpError(404, "File not found.");
    if (session.status !== "uploading")
      throw new HttpError(409, "Uploads are closed for this session.");
    const [file] = await db()<
      { size: number; storage_key: string }[]
    >`SELECT size, storage_key FROM files WHERE id = ${fileId} AND session_id = ${id}`;
    if (!file || file.storage_key !== `${id}/incoming/${fileId}`)
      throw new HttpError(404, "File not found.");
    const query = new URL(request.url).searchParams;
    if (
      !validUploadSignature(
        env().SESSION_SECRET,
        file.storage_key,
        file.size,
        Number(query.get("expires")),
        query.get("signature") || "",
      )
    )
      throw new HttpError(
        403,
        "Upload link is invalid or expired. Start a new session.",
      );
    const length = request.headers.get("content-length");
    if (!request.body || (length !== null && Number(length) !== file.size))
      throw new HttpError(400, "Upload size does not match the selected file.");
    try {
      await localStorage().write(
        file.storage_key,
        Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>),
        file.size,
        false,
        request.signal,
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        throw new HttpError(409, "This file has already been uploaded.");
      throw new HttpError(
        400,
        "Upload could not finish. Check the file size, available disk space, and connection.",
      );
    }
    return Response.json({ uploaded: true });
  } catch (error) {
    return apiError(error);
  }
}
