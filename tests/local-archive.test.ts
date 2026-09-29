import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import yauzl from "yauzl";
import type { SqlClient } from "@/lib/database/types";
import type { FileRow } from "@/lib/schemas";
const state = vi.hoisted(() => ({
  root: "",
  sql: undefined as SqlClient | undefined,
}));
vi.mock("@/lib/config", () => ({
  env: () => ({ STORAGE_DRIVER: "local", LOCAL_STORAGE_PATH: state.root }),
}));
vi.mock("@/lib/database", () => ({ db: () => state.sql }));
import { createSqliteClient } from "@/lib/database/sqlite";
import { createLocalStore } from "@/lib/storage/local";
import { readObject } from "@/lib/storage";
import { createArchive } from "@/lib/zip";

it("streams a real ZIP through real local storage with real SQLite session checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studysort-local-archive-"));
  state.root = join(directory, "objects");
  const database = createSqliteClient(join(directory, "test.sqlite"));
  state.sql = database.sql;
  try {
    const id = randomUUID(),
      fileId = randomUUID(),
      key = `${id}/originals/${fileId}`;
    await database.sql`INSERT INTO sessions (id, status) VALUES (${id}, 'archiving')`;
    const bytes = Buffer.from(
      "These original bytes must be preserved in the local ZIP.",
    );
    const store = createLocalStore(state.root);
    await store.write(key, Readable.from([bytes]), bytes.length);
    const file: FileRow = {
      id: fileId,
      session_id: id,
      original_name: "notes.txt",
      extension: "txt",
      size: bytes.length,
      mime_type: "text/plain",
      storage_key: key,
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
      organized_path: "Subject/notes.txt",
      extraction_metadata: null,
      created_at: new Date().toISOString(),
    };
    const archive = await createArchive(id, [file]);
    const buffer = await readObject(archive.key, archive.size);
    const entries = await new Promise<Map<string, Buffer>>(
      (resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
          if (error || !zip) return reject(error);
          const files = new Map<string, Buffer>();
          zip.on("error", reject);
          zip.on("end", () => resolve(files));
          zip.on("entry", (entry: yauzl.Entry) =>
            zip.openReadStream(entry, (err, stream) => {
              if (err || !stream) return reject(err);
              const chunks: Buffer[] = [];
              stream.on("error", reject);
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.on("end", () => {
                files.set(entry.fileName, Buffer.concat(chunks));
                zip.readEntry();
              });
            }),
          );
          zip.readEntry();
        });
      },
    );
    expect(entries.get("Subject/notes.txt")).toEqual(bytes);
    expect(
      JSON.parse(entries.get("organization_manifest.json")!.toString()).files[0]
        .id,
    ).toBe(fileId);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
