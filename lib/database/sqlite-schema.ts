// Kept in a source module so Next.js bundles the local schema with its routes.
export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','queued','processing','archiving','complete','cancelled','failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours')),
  error TEXT, warning TEXT, dispatch_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL, extension TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 26214400),
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('queued','uploading','extracting','analyzing','classified','duplicate-check','ready','failed')),
  error TEXT, sha256 TEXT, content_fingerprint TEXT, semantic_fingerprint TEXT,
  analysis TEXT, extraction_metadata TEXT,
  duplicate_status TEXT NOT NULL DEFAULT 'unique' CHECK (duplicate_status IN ('unique','exact','likely')),
  duplicate_of TEXT REFERENCES files(id) ON DELETE SET NULL, duplicate_explanation TEXT, similarity REAL,
  organized_path TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS files_session ON files(session_id, created_at, id);
CREATE INDEX IF NOT EXISTS files_hash ON files(session_id, sha256);
CREATE TABLE IF NOT EXISTS extracted_documents (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  content TEXT NOT NULL, visual INTEGER NOT NULL DEFAULT 0, metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS document_chunks (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL, analysis TEXT NOT NULL,
  PRIMARY KEY(file_id, chunk_index)
);
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (gen_random_uuid()),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, UNIQUE(session_id, name)
);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (gen_random_uuid()),
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, UNIQUE(subject_id, name)
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (gen_random_uuid()),
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name TEXT NOT NULL, UNIQUE(chapter_id, name)
);
CREATE TABLE IF NOT EXISTS classifications (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) DEFERRABLE INITIALLY DEFERRED,
  chapter_id TEXT REFERENCES chapters(id) DEFERRABLE INITIALLY DEFERRED,
  topic_id TEXT REFERENCES topics(id) DEFERRABLE INITIALLY DEFERRED,
  result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS duplicate_groups (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  canonical_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('exact','likely')), metric REAL, explanation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS archives (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL, size INTEGER NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS request_budgets (
  key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires_at TEXT NOT NULL
);
PRAGMA user_version = 1;
`;
