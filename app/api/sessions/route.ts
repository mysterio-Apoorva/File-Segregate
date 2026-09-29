import { randomUUID } from "node:crypto";
import { db } from "@/lib/database";
import { uploadSchema } from "@/lib/schemas";
import { MAX_BATCH_BYTES } from "@/lib/limits";
import { uploadUrl } from "@/lib/storage";
import {
  apiError,
  checkOrigin,
  HttpError,
  parseBody,
  rateLimit,
  setSessionCookie,
} from "@/lib/security";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = uploadSchema.parse(await parseBody(request));
    if (input.files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES)
      throw new HttpError(413, "A batch can contain at most 500 MB.");
    await rateLimit(request);
    const id = randomUUID();
    const sql = db();
    const files = input.files.map((f) => ({ ...f, id: randomUUID() }));
    await sql.begin(async (tx) => {
      await tx`INSERT INTO sessions (id) VALUES (${id})`;
      for (const file of files)
        await tx`INSERT INTO files (id, session_id, original_name, extension, size, storage_key) VALUES (${file.id}, ${id}, ${file.name}, ${file.name.split(".").pop()?.toLowerCase() || ""}, ${file.size}, ${`${id}/incoming/${file.id}`})`;
    });
    const uploads = await Promise.all(
      files.map(async (file) => ({
        id: file.id,
        name: file.name,
        url: await uploadUrl(`${id}/incoming/${file.id}`, file.size),
      })),
    );
    await setSessionCookie(id);
    return Response.json({ id, uploads }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
