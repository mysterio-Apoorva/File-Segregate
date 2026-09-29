import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, link, rename, unlink, rm } from "node:fs/promises";
import { dirname, resolve, sep, parse } from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const keyPattern = new RegExp(
  `^${uuid}/(?:(?:incoming|originals)/${uuid}|archive/StudyMaterial_Organized\\.zip)$`,
);
const sessionPattern = new RegExp(`^${uuid}$`);
export function localObjectPath(root: string, key: string) {
  if (!keyPattern.test(key)) throw new Error("Invalid local storage key.");
  const base = resolve(root),
    target = resolve(base, key);
  if (base === parse(base).root || !target.startsWith(base + sep))
    throw new Error("Unsafe local storage location.");
  return target;
}
export function uploadSignature(
  secret: string,
  key: string,
  size: number,
  expires: number,
) {
  return createHmac("sha256", secret)
    .update(`upload:${key}:${size}:${expires}`)
    .digest("hex");
}
export function validUploadSignature(
  secret: string,
  key: string,
  size: number,
  expires: number,
  signature: string,
) {
  if (
    !Number.isSafeInteger(expires) ||
    expires <= Date.now() ||
    expires > Date.now() + 601000
  )
    return false;
  const expected = Buffer.from(uploadSignature(secret, key, size, expires));
  const received = Buffer.from(signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
export function createLocalStore(root: string) {
  const path = (key: string) => localObjectPath(root, key);
  async function size(key: string) {
    const info = await stat(path(key));
    if (!info.isFile()) throw new Error("Stored object is not a file.");
    return info.size;
  }
  async function write(
    key: string,
    source: Readable,
    expectedSize?: number,
    overwrite = false,
    signal?: AbortSignal,
  ) {
    const target = path(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.partial`;
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (expectedSize !== undefined && bytes > expectedSize)
          callback(new Error("Upload exceeds its declared size."));
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(
        source,
        counter,
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      if (expectedSize !== undefined && bytes !== expectedSize)
        throw new Error("Upload size does not match the selected file.");
      // Originals/uploads are write-once. Publishing via a hard link is atomic,
      // so a reader can never see a partially written or replaced original.
      if (overwrite) await rename(temporary, target);
      else await link(temporary, target);
      return bytes;
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  async function open(key: string) {
    const length = await size(key);
    return { Body: createReadStream(path(key)), ContentLength: length };
  }
  async function seal(key: string, destination: string, expectedSize: number) {
    if ((await size(key)) !== expectedSize)
      throw new Error("Upload size mismatch.");
    try {
      await write(destination, createReadStream(path(key)), expectedSize);
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) ||
        (await size(destination)) !== expectedSize
      )
        throw error;
    }
  }
  async function removeSession(id: string) {
    if (!sessionPattern.test(id))
      throw new Error("Invalid session storage prefix.");
    // Resolve and verify the exact UUID directory before recursive cleanup.
    const base = resolve(root),
      target = resolve(base, id);
    if (
      base === parse(base).root ||
      !target.startsWith(base + sep) ||
      target === base
    )
      throw new Error("Unsafe cleanup target.");
    await rm(target, { recursive: true, force: true });
  }
  return { size, write, open, seal, removeSession };
}
