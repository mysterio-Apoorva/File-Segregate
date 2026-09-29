import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  createLocalStore,
  localObjectPath,
  uploadSignature,
  validUploadSignature,
} from "@/lib/storage/local";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studysort-storage-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("private local storage", () => {
  it("preserves bytes, seals originals and rejects replacement uploads", async () => {
    const store = createLocalStore(root),
      id = randomUUID(),
      fileId = randomUUID();
    const key = `${id}/incoming/${fileId}`,
      original = `${id}/originals/${fileId}`;
    const bytes = Buffer.from([0, 1, 127, 255, 24]);
    await store.write(key, Readable.from([bytes]), bytes.length);
    await store.seal(key, original, bytes.length);
    await store.seal(key, original, bytes.length); // idempotent retry
    await expect(
      store.write(key, Readable.from([Buffer.from("other")]), 5),
    ).rejects.toMatchObject({ code: "EEXIST" });
    const object = await store.open(original);
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(object.ContentLength).toBe(bytes.length);
  });
  it("rejects oversized and incomplete uploads without leaving partial files", async () => {
    const store = createLocalStore(root),
      id = randomUUID(),
      key = `${id}/incoming/${randomUUID()}`;
    await expect(
      store.write(key, Readable.from([Buffer.alloc(20)]), 10),
    ).rejects.toThrow("exceeds");
    await expect(
      store.write(key, Readable.from([Buffer.alloc(5)]), 10),
    ).rejects.toThrow("match");
    expect(await readdir(join(root, id, "incoming"))).toEqual([]);
  });
  it("binds expiring upload signatures to their key and size", () => {
    const secret = "local-test-secret",
      key = `${randomUUID()}/incoming/${randomUUID()}`,
      expires = Date.now() + 60000;
    const signature = uploadSignature(secret, key, 10, expires);
    expect(validUploadSignature(secret, key, 10, expires, signature)).toBe(
      true,
    );
    expect(validUploadSignature(secret, key, 11, expires, signature)).toBe(
      false,
    );
    expect(
      validUploadSignature(secret, key, 10, Date.now() - 1, signature),
    ).toBe(false);
    expect(
      validUploadSignature(secret, key + "/other", 10, expires, signature),
    ).toBe(false);
  });
  it("rejects traversal and restricts cleanup to exactly one session", async () => {
    const store = createLocalStore(root),
      first = randomUUID(),
      second = randomUUID();
    expect(() => localObjectPath(root, "../../secret")).toThrow("Invalid");
    expect(() =>
      localObjectPath(root, `${first}/originals/../../secret`),
    ).toThrow("Invalid");
    await expect(store.removeSession("..")).rejects.toThrow("Invalid");
    await store.write(
      `${first}/incoming/${randomUUID()}`,
      Readable.from(["a"]),
      1,
    );
    const secondKey = `${second}/incoming/${randomUUID()}`;
    await store.write(secondKey, Readable.from(["b"]), 1);
    await store.removeSession(first);
    expect(await store.size(secondKey)).toBe(1);
    expect(await readdir(root)).toEqual([second]);
  });
  it("atomically replaces completed archive outputs on a retry", async () => {
    const store = createLocalStore(root),
      key = `${randomUUID()}/archive/StudyMaterial_Organized.zip`;
    await store.write(key, Readable.from(["first"]), undefined, true);
    await store.write(key, Readable.from(["new archive"]), undefined, true);
    expect(await store.size(key)).toBe(11);
  });
});
