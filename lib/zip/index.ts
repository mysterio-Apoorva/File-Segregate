import "server-only";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import { openObject, archiveWriter } from "@/lib/storage";
import { db } from "@/lib/database";
import type { FileRow } from "@/lib/schemas";
export function manifest(
  files: FileRow[],
  generatedAt = new Date().toISOString(),
) {
  return {
    version: 1,
    generatedAt,
    confidenceNote: "AI confidence estimates are not calibrated probabilities.",
    preservation:
      "Every successfully uploaded original is included once, including exact and likely duplicates. Files were not modified.",
    files: files.map((f) => ({
      id: f.id,
      originalName: f.original_name,
      organizedPath: f.organized_path,
      sha256: f.sha256,
      size: f.size,
      mimeType: f.mime_type,
      ...f.analysis,
      duplicateStatus: f.duplicate_status,
      duplicateOf: f.duplicate_of,
      duplicateExplanation: f.duplicate_explanation,
      lexicalSimilarity: f.similarity,
      extraction: f.extraction_metadata,
      error: f.error,
    })),
  };
}
export async function createArchive(sessionId: string, files: FileRow[]) {
  const key = `${sessionId}/archive/StudyMaterial_Organized.zip`;
  const zip = archiver("zip", { zlib: { level: 1 }, forceZip64: true });
  const body = new PassThrough();
  const upload = archiveWriter(key, body);
  zip.on("error", (error) => body.destroy(error));
  zip.on("warning", (error) => body.destroy(error));
  zip.pipe(body);
  body.on("error", () => undefined); // upload.done and entry waits propagate errors below.
  const uploaded = upload.done();
  // Attach a handler immediately so an early storage failure is never unhandled.
  let uploadFailure: unknown;
  void uploaded.catch((error: unknown) => {
    uploadFailure = error;
    body.destroy(
      error instanceof Error ? error : new Error("Archive upload failed."),
    );
    zip.abort();
  });
  try {
    zip.append(JSON.stringify(manifest(files), null, 2), {
      name: "organization_manifest.json",
    });
    for (const file of files) {
      if (uploadFailure) throw uploadFailure;
      const [session] =
        await db()`SELECT status, expires_at FROM sessions WHERE id = ${sessionId}`;
      if (
        !session ||
        session.status === "cancelled" ||
        new Date(session.expires_at).getTime() <= Date.now()
      )
        throw new Error("Archive cancelled or session expired.");
      if (
        !file.organized_path ||
        file.organized_path.split("/").some((p) => p === ".." || !p)
      )
        throw new Error("Unsafe archive path.");
      const response = await openObject(file.storage_key);
      if (uploadFailure) {
        (response.Body as Readable | undefined)?.destroy();
        throw uploadFailure;
      }
      if (!response.Body || response.ContentLength !== file.size)
        throw new Error(
          "An original file is missing or changed. Archive creation stopped to avoid data loss.",
        );
      // Only one source stream is open at once, bounding memory and connections.
      const source = response.Body as Readable;
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onEntry = (entry: { name: string }) => {
          if (entry.name === file.organized_path) {
            cleanup();
            resolve();
          }
        };
        const cleanup = () => {
          zip.off("entry", onEntry);
          zip.off("error", onError);
          body.off("error", onError);
          source.off("error", onError);
        };
        source.once("error", onError);
        zip.once("error", onError);
        body.once("error", onError);
        zip.on("entry", onEntry);
        zip.append(source, {
          name: file.organized_path!,
          date: new Date(file.created_at),
        });
      });
    }
    await zip.finalize();
    await uploaded;
    return { key, size: zip.pointer() };
  } catch (error) {
    zip.abort();
    body.destroy();
    await upload.abort().catch(() => undefined);
    await uploaded.catch(() => undefined);
    throw error;
  }
}
