import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.SQLITE_PATH || ".runtime/studysort.sqlite", { readOnly: true });
try {
  console.log(JSON.stringify({
    sessions: db.prepare("SELECT id, status, error, created_at FROM sessions ORDER BY created_at DESC LIMIT 8").all(),
    failures: db.prepare("SELECT status, error, count(*) AS count FROM files GROUP BY status,error").all(),
    pending: db.prepare("SELECT id, extension, size, status, extraction_metadata FROM files WHERE status NOT IN ('ready','failed','uploading')").all(),
    analyses: db.prepare("SELECT json_extract(analysis,'$.needsReview') AS needsReview, json_extract(analysis,'$.reviewReason') AS reviewReason, count(*) AS count FROM files WHERE analysis IS NOT NULL GROUP BY needsReview,reviewReason").all(),
  }, null, 2));
} finally { db.close(); }
