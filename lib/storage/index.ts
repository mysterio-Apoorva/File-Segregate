import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/config";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import { createLocalStore, uploadSignature } from "./local";
export const localStorage = () => createLocalStore(env().LOCAL_STORAGE_PATH);
let client: S3Client | undefined;
export function storage() {
  const e = env();
  return (client ??= new S3Client({
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    },
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  }));
}
export const bucket = () => env().S3_BUCKET;
export async function uploadUrl(key: string, size: number) {
  if (env().STORAGE_DRIVER === "local") {
    const [id, , fileId] = key.split("/");
    const expires = Date.now() + 600000;
    const signature = uploadSignature(env().SESSION_SECRET, key, size, expires);
    return `${env().APP_URL}/api/sessions/${id}/files/${fileId}/upload?expires=${expires}&signature=${signature}`;
  }
  return getSignedUrl(
    storage(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: "application/octet-stream",
      ContentLength: size,
    }),
    { expiresIn: 600 },
  );
}
export async function objectSize(key: string) {
  if (env().STORAGE_DRIVER === "local") return localStorage().size(key);
  const result = await storage().send(
    new HeadObjectCommand({ Bucket: bucket(), Key: key }),
  );
  return result.ContentLength;
}
export async function sealObject(
  key: string,
  destination: string,
  size: number,
) {
  if (env().STORAGE_DRIVER === "local")
    return localStorage().seal(key, destination, size);
  const head = await storage().send(
    new HeadObjectCommand({ Bucket: bucket(), Key: key }),
  );
  if (head.ContentLength !== size)
    throw new Error("Upload size mismatch. Please re-upload this file.");
  await storage().send(
    new CopyObjectCommand({
      Bucket: bucket(),
      Key: destination,
      CopySource: `${bucket()}/${key.split("/").map(encodeURIComponent).join("/")}`,
      CopySourceIfMatch: head.ETag,
      MetadataDirective: "REPLACE",
      ContentType: "application/octet-stream",
    }),
  );
}
export async function readObject(
  key: string,
  expectedSize: number,
): Promise<Buffer> {
  if ((await objectSize(key)) !== expectedSize)
    throw new Error(
      "Stored file size differs from the selected file. Upload it again.",
    );
  const response = await openObject(key);
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
export async function openObject(
  key: string,
): Promise<{ Body: Readable; ContentLength: number | undefined }> {
  if (env().STORAGE_DRIVER === "local") return localStorage().open(key);
  const response = await storage().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  if (!response.Body) throw new Error("Uploaded file could not be read.");
  return {
    Body: response.Body as Readable,
    ContentLength: response.ContentLength,
  };
}
export function archiveWriter(key: string, body: Readable) {
  if (env().STORAGE_DRIVER === "local") {
    const controller = new AbortController();
    const done = localStorage().write(
      key,
      body,
      undefined,
      true,
      controller.signal,
    );
    return {
      done: () => done,
      abort: async () => {
        controller.abort();
        await done.catch(() => undefined);
      },
    };
  }
  return new Upload({
    client: storage(),
    params: {
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: "application/zip",
    },
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });
}
export async function downloadUrl(key: string) {
  if (env().STORAGE_DRIVER === "local")
    return `${env().APP_URL}/api/sessions/${key.split("/")[0]}/archive`;
  return getSignedUrl(
    storage(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition:
        'attachment; filename="StudyMaterial_Organized.zip"',
      ResponseContentType: "application/zip",
    }),
    { expiresIn: 120 },
  );
}
export async function deleteSessionObjects(id: string) {
  if (env().STORAGE_DRIVER === "local") return localStorage().removeSession(id);
  // Prefix contains a validated UUID, never a user-supplied filename.
  let token: string | undefined;
  do {
    const page = await storage().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: `${id}/`,
        ContinuationToken: token,
      }),
    );
    if (page.Contents?.length) {
      const result = await storage().send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: {
            Objects: page.Contents.map((o) => ({ Key: o.Key! })),
            Quiet: true,
          },
        }),
      );
      if (result.Errors?.length)
        throw new Error("Storage cleanup was incomplete; it will be retried.");
    }
    token = page.NextContinuationToken;
  } while (token);
}
