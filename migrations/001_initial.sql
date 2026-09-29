CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','queued','processing','archiving','complete','cancelled','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  error text, warning text, dispatch_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  original_name text NOT NULL, extension text NOT NULL, size integer NOT NULL CHECK (size > 0 AND size <= 26214400),
  mime_type text NOT NULL DEFAULT 'application/octet-stream', storage_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('queued','uploading','extracting','analyzing','classified','duplicate-check','ready','failed')),
  error text, sha256 text, content_fingerprint text, semantic_fingerprint jsonb,
  analysis jsonb, extraction_metadata jsonb,
  duplicate_status text NOT NULL DEFAULT 'unique' CHECK (duplicate_status IN ('unique','exact','likely')),
  duplicate_of uuid REFERENCES files(id) ON DELETE SET NULL, duplicate_explanation text, similarity double precision,
  organized_path text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_session ON files(session_id, created_at, id);
CREATE INDEX IF NOT EXISTS files_hash ON files(session_id, sha256);
CREATE TABLE IF NOT EXISTS extracted_documents (
  file_id uuid PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  content text NOT NULL, visual boolean NOT NULL DEFAULT false, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS document_chunks (
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL, analysis jsonb NOT NULL,
  PRIMARY KEY(file_id, chunk_index)
);
CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE(session_id, name)
);
CREATE TABLE IF NOT EXISTS chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE(subject_id, name)
);
CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name text NOT NULL, UNIQUE(chapter_id, name)
);
CREATE TABLE IF NOT EXISTS classifications (
  file_id uuid PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id), chapter_id uuid REFERENCES chapters(id), topic_id uuid REFERENCES topics(id),
  result jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS duplicate_groups (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_id uuid PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  canonical_file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('exact','likely')), metric double precision, explanation text NOT NULL
);
CREATE TABLE IF NOT EXISTS archives (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  storage_key text NOT NULL, size bigint NOT NULL, generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS request_budgets (
  key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
-- No browser database access. PostgreSQL connection must be a trusted server role.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_budgets ENABLE ROW LEVEL SECURITY;
