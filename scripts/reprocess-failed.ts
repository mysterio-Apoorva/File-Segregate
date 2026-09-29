import { db } from "../lib/database";
import { filesFor, prepareFile, analyzeChunk, finishAnalysis, checkDuplicates, reconcile } from "../lib/jobs/pipeline";
import { createArchive } from "../lib/zip";
const sql = db();
// Only reopen unexpired, completed/failed sessions with provider-related failures.
// Originals and successful classifications are retained.
const sessions = await sql`SELECT DISTINCT s.id FROM sessions s JOIN files f ON f.session_id = s.id WHERE s.status IN ('complete','failed') AND s.expires_at > now() AND f.status = 'failed' AND (f.error LIKE 'Gemini%' OR f.error LIKE 'The configured Gemini model%')`;
for (const { id } of sessions) {
  await sql`UPDATE sessions SET status = 'processing', error = NULL WHERE id = ${id}`;
  await sql`UPDATE files SET status = 'queued', error = NULL, duplicate_status = 'unique', duplicate_of = NULL, duplicate_explanation = NULL, similarity = NULL WHERE session_id = ${id} AND status = 'failed' AND (error LIKE 'Gemini%' OR error LIKE 'The configured Gemini model%')`;
  try {
    const files = await filesFor(id);
    for (const file of files.filter(f => f.status === "queued")) {
      const prepared = await prepareFile(file.id);
      if (!prepared.skip) {
        for (let i = 0; i < prepared.chunks; i += 2) await Promise.all(Array.from({ length: Math.min(2, prepared.chunks - i) }, (_, offset) => analyzeChunk(file.id, i + offset, prepared.visual)));
        await finishAnalysis(file.id);
        await checkDuplicates(file.id);
      }
      const [result] = await sql`SELECT status, error FROM files WHERE id = ${file.id}`;
      console.log(JSON.stringify({ sessionId: id, fileId: file.id, ...result }));
    }
    await reconcile(id);
    await sql`UPDATE sessions SET status = 'archiving' WHERE id = ${id}`;
    const archive = await createArchive(id, await filesFor(id));
    await sql.begin(async tx => {
      await tx`INSERT INTO archives (session_id, storage_key, size) VALUES (${id}, ${archive.key}, ${archive.size}) ON CONFLICT (session_id) DO UPDATE SET storage_key = excluded.storage_key, size = excluded.size, generated_at = now()`;
      await tx`UPDATE sessions SET status = 'complete' WHERE id = ${id}`;
      await tx`DELETE FROM extracted_documents WHERE file_id IN (SELECT id FROM files WHERE session_id = ${id})`;
      await tx`DELETE FROM document_chunks WHERE file_id IN (SELECT id FROM files WHERE session_id = ${id})`;
    });
    const result = await sql`SELECT status, count(*) AS count FROM files WHERE session_id = ${id} GROUP BY status`;
    console.log(JSON.stringify({ sessionId: id, results: result, archive: "regenerated" }));
  } catch {
    await sql`UPDATE sessions SET status = 'failed', error = 'Recovery could not finish. Originals are preserved.' WHERE id = ${id}`;
    console.error(`Recovery interrupted for session ${id}.`);
    process.exitCode = 1;
  }
}
console.log("Recovery finished.");
