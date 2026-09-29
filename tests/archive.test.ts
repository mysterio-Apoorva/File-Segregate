import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import yauzl from "yauzl";
import type { FileRow } from "@/lib/schemas";
const state = vi.hoisted(() => ({
  originals: new Map<string, Buffer>(),
  archive: Buffer.alloc(0),
  cancelled: false,
  failUpload: false,
}));
vi.mock("@/lib/database", () => ({
  db: () => async () => [
    {
      status: state.cancelled ? "cancelled" : "archiving",
      expires_at: new Date(Date.now() + 60000).toISOString(),
    },
  ],
}));
vi.mock("@/lib/storage", () => ({
  openObject: async (key: string) => {
    const bytes = state.originals.get(key);
    if (!bytes) throw new Error("Missing original");
    return { Body: Readable.from([bytes]), ContentLength: bytes.length };
  },
  archiveWriter: (_key: string, body: Readable) => ({
    async done() {
      if (state.failUpload) throw new Error("Storage unavailable");
      const parts: Buffer[] = [];
      for await (const chunk of body) parts.push(Buffer.from(chunk));
      state.archive = Buffer.concat(parts);
    },
    async abort() {
      body.destroy();
    },
  }),
}));
import { createArchive } from "@/lib/zip";
export async function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const result = new Map<string, Buffer>();
      zip.on("error", reject);
      zip.on("end", () => resolve(result));
      zip.on("entry", (entry: yauzl.Entry) =>
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err);
          const chunks: Buffer[] = [];
          stream.on("error", reject);
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            result.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        }),
      );
      zip.readEntry();
    });
  });
}
function file(id: string, bytes: Buffer, path: string): FileRow {
  state.originals.set(id, bytes);
  return {
    id,
    session_id: "session",
    original_name: "original.txt",
    extension: "txt",
    size: bytes.length,
    mime_type: "text/plain",
    storage_key: id,
    status: "ready",
    error: null,
    sha256: null,
    content_fingerprint: null,
    semantic_fingerprint: null,
    analysis: null,
    duplicate_status: "unique",
    duplicate_of: null,
    duplicate_explanation: null,
    similarity: null,
    organized_path: path,
    extraction_metadata: null,
    created_at: new Date().toISOString(),
  };
}
describe("real ZIP stream with in-memory storage transport", () => {
  beforeEach(() => {
    state.originals.clear();
    state.archive = Buffer.alloc(0);
    state.cancelled = false;
    state.failUpload = false;
  });
  it("propagates an early multipart upload failure without hanging", async () => {
    state.failUpload = true;
    await expect(
      createArchive("session", [
        file("a", Buffer.from("original"), "Subject/a.txt"),
      ]),
    ).rejects.toThrow("Storage unavailable");
  });
  it("includes every original unchanged and a valid manifest, including duplicate bytes", async () => {
    const original = Buffer.from(
      "Educational material whose bytes must remain unchanged.",
    );
    const files = [
      file("a", original, "Subject/Chapter/original.txt"),
      file("b", original, "Subject/Chapter/original (2).txt"),
      file("c", Buffer.from([0, 1, 2, 255]), "Needs Review/corrupt.pdf"),
    ];
    const result = await createArchive("session", files);
    expect(result.size).toBe(state.archive.length);
    const entries = await unzip(state.archive);
    expect(entries.size).toBe(4);
    for (const f of files)
      expect(entries.get(f.organized_path!)).toEqual(state.originals.get(f.id));
    expect(
      JSON.parse(entries.get("organization_manifest.json")!.toString()).files,
    ).toHaveLength(3);
  });
  it("refuses to silently omit a missing original", async () => {
    const f = file("a", Buffer.from("original"), "Subject/a.txt");
    state.originals.clear();
    await expect(createArchive("session", [f])).rejects.toThrow(
      "Missing original",
    );
  });
  it("stops archive generation after cancellation", async () => {
    state.cancelled = true;
    await expect(
      createArchive("session", [
        file("a", Buffer.from("original"), "Subject/a.txt"),
      ]),
    ).rejects.toThrow("cancelled");
  });
});
