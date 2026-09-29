# StudySort AI

## Local mode: only a Gemini API key is needed

SQLite is now supported for local development. In `.env.local`, set:

```env
DATABASE_DRIVER=sqlite
SQLITE_PATH=.runtime/studysort.sqlite
DATABASE_URL=
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=.runtime/storage
INNGEST_DEV=1
```

Run `npm run db:migrate` to initialize the local database (the application also initializes its schema on first connection). SQLite requires no database account, URL, username or password. Its database, WAL and shared-memory files are ignored by Git. Use one local application instance; transactions are serialized and foreign keys are enforced. The PostgreSQL instructions below remain available for hosted deployment: set `DATABASE_DRIVER=postgres` and provide `DATABASE_URL` when deploying to Vercel. SQLite mode is explicitly blocked on Vercel because local database files would not persist there.

With `STORAGE_DRIVER=local`, uploads, sealed originals and generated ZIPs stay in `.runtime/storage` on your computer. S3 is optional: you do not need an AWS or Supabase account, and all `S3_*` values can be empty. Content is still sent to Google Gemini for analysis, so this is not an offline AI system. Local uploads are streamed with size limits, signed upload capabilities and session authorization; downloads require the same private session cookie. Originals cannot be overwritten by replaying an upload URL.

For local Inngest, leave `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` empty and run `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` in another terminal. This is a local job runner, not a required cloud account. Scheduled cleanup works while that runner and the app are running; after shutdown, expired local files remain on disk until maintenance next runs.

Required local settings are `APP_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `DATABASE_DRIVER=sqlite`, `SQLITE_PATH`, `STORAGE_DRIVER=local`, `LOCAL_STORAGE_PATH`, `SESSION_SECRET`, `INNGEST_DEV=1`, and `TRUST_PROXY=0`. The only external credential is `GEMINI_API_KEY`; `SESSION_SECRET` is generated locally. Keep real keys in `.env.local`, never in `.env.example`.

A complete Next.js application that turns uploaded educational documents into a downloadable folder hierarchy. Google Gemini analyzes **actual content**, discovers subjects and topics dynamically, and provides structured, validated classifications. There is no login, chatbot, filename classifier, demo classifier, or simulated progress.

## What is implemented

- File/folder selection and recursive folder drag-and-drop; up to **200 files, 25 MiB each, 500 MiB per batch**.
- Private local file storage, or direct signed uploads to optional S3-compatible storage for Vercel.
- Uploads are sealed into server-only original-object keys before processing. A still-valid upload URL cannot change an original after sealing.
- Local SQLite or hosted PostgreSQL persistence and browser-bound anonymous session capability cookies.
- Durable Inngest jobs, bounded concurrency, per-file isolation, real progress polling, cancellation checkpoints, and dispatch recovery.
- Actual PDF page-text extraction; PDFs with sparse pages and image files use Gemini's native visual document understanding.
- DOCX text/tables, PPTX slide text/speaker notes, legacy DOC/PPT text extraction, UTF-8/UTF-16LE text, Markdown and CSV.
- Chunked analysis of **all extracted text**, followed by document-level aggregation. No silent truncation to the first pages.
- Google GenAI SDK, JSON Schema outputs, Zod validation, bounded retries and understandable failures.
- SHA-256 exact duplicates, normalized text fingerprints, computed shingle similarity, and conservative Gemini duplicate comparison.
- Subject synonym reconciliation, natural folder depth, multi-topic placement, secondary-subject metadata, and collision-safe paths.
- Search, expandable folders, classification details, confidence estimates and review flags.
- Streaming ZIP64 archives with the original bytes of **every uploaded file**, including duplicates, unsupported and corrupted files, plus `organization_manifest.json`.
- Scheduled expiration and cloud cleanup. Extracted text is deleted immediately after successful archive generation.

## Architecture

```text
Browser → Next.js API → PostgreSQL session + signed object uploads
Browser → private object storage (original file bytes)
Start → seal originals → durable Inngest event
  per-file extraction → persisted chunks → Gemini → classification
  SHA-256 / content similarity / Gemini comparison → duplicate metadata
  subject reconciliation → safe hierarchy → streaming ZIP → private storage
Browser polls database-backed progress → signed ZIP download
Inngest maintenance → expired object removal → expired database rows
```

Next.js 16 / React 19 / strict TypeScript; custom responsive CSS and Lucide icons; Google `@google/genai`; PostgreSQL via `postgres`; private storage via AWS S3 SDK (Supabase Storage compatible); Inngest; PDF.js; bounded Office XML parsing; `word-extractor`; CFB; Archiver; Vitest; Playwright for browser acceptance and scanned fixtures.

In hosted PostgreSQL + S3 mode, no persistent local filesystem is used. SQLite + local storage keeps the database and files on your computer. Background work is not attached to a browser request. Extraction is held briefly in memory and stored temporarily in the selected database. ZIP source files are streamed one at a time to local disk or multipart cloud upload, bounding memory.

## Requirements

1. **Node.js 22.13 or later** (Node 22 LTS recommended).
2. Local SQLite for development, or hosted PostgreSQL (preferably Supabase) for Vercel deployment.
3. Available local disk space, or a private S3-compatible bucket for Vercel. Supabase Storage is one optional provider; Amazon is not required.
4. Google AI Studio Gemini API key with suitable quotas/billing.
5. The local Inngest dev server, or Inngest Cloud for production jobs and scheduled cleanup.
6. Vercel **Pro with Fluid Compute**, or a hosting plan allowing 800-second background function steps. This project is not configured for Hobby's shorter maximum duration.

Provider credentials and accounts must be supplied by the operator. Merely deploying the UI does not configure these services. The UI explicitly reports incomplete environment configuration.

## Local development

```powershell
npm ci
Copy-Item .env.example .env.local
# Set GEMINI_API_KEY and generate SESSION_SECRET. Local mode needs no S3/database credentials.
npm run db:migrate
npm run storage:setup
npm run dev
```

In a second terminal:

```sh
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Use `APP_URL=http://localhost:3000`, `INNGEST_DEV=1`, and `TRUST_PROXY=0` locally. Inngest's local development server coordinates jobs; `DATABASE_DRIVER=sqlite` and `STORAGE_DRIVER=local` keep data on your disk. The local Node development dependency ensures npm scripts use Node 22 on the Windows development machine; production should select Node 22 in hosting settings.

Open `http://localhost:3000`. Upload files, choose **Organize with Gemini**, inspect real progress and download the generated ZIP. The session ID is remembered locally; its authorization is a scoped, HttpOnly cookie. A reload can resume progress/results, but a partially completed browser upload must be started again.

## Environment variables

All values are server-only. Nothing needs a `NEXT_PUBLIC_` prefix.

| Variable               | Purpose                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `APP_URL`              | Exact public origin, e.g. `https://studysort.example`; used for mutation origin checks                     |
| `GEMINI_API_KEY`       | Gemini API key from Google AI Studio                                                                       |
| `GEMINI_MODEL`         | Default `gemini-3.5-flash-lite`; verified with live document classification |
| `GEMINI_FALLBACK_MODEL` | Default `gemini-2.5-flash`; bounded fallback for model availability/rate-limit failures |
| `DATABASE_URL`         | Hosted PostgreSQL connection string; Supabase transaction pooler recommended                               |
| `S3_ENDPOINT`          | Supabase S3 endpoint or equivalent provider endpoint                                                       |
| `S3_REGION`            | Actual storage region                                                                                      |
| `S3_ACCESS_KEY_ID`     | Server-only S3 access key, **not** the Supabase anon key                                                   |
| `S3_SECRET_ACCESS_KEY` | Server-only S3 secret, **not** the Supabase service-role JWT                                               |
| `S3_BUCKET`            | Private bucket name, e.g. `studysort`                                                                      |
| `SESSION_SECRET`       | At least 32 random characters; used for session HMACs and IP budget hashing                                |
| `INNGEST_EVENT_KEY`    | Inngest Cloud event key (required in production)                                                           |
| `INNGEST_SIGNING_KEY`  | Verifies background function requests (required in production)                                             |
| `INNGEST_DEV`          | `1` locally; **remove in production**                                                                      |
| `TRUST_PROXY`          | `1` on Vercel only; `0` locally or behind an untrusted proxy                                               |

Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never commit `.env.local` or place keys in frontend code.

## Database setup

1. Create a Supabase project (or another hosted PostgreSQL database).
2. Copy its transaction-pooler connection URI. URL-encode special characters in the password. Use TLS. `postgres` is configured with `prepare:false`, a small connection pool, and production TLS.
3. Set `DATABASE_URL`, then run `npm run db:migrate`. Alternatively execute `migrations/001_initial.sql` using the provider SQL editor.
4. The migration creates sessions, files, extracted documents, chunk analyses, subjects, chapters, topics, classifications, duplicate groups, archives and request-budget tables, including indexes and constraints.
5. RLS is enabled with **no browser policies**. Use a trusted server database role that can access these tables (the Supabase server postgres role works). Never give a browser this connection URI.

The migration is idempotent for a fresh installation. Future schema changes should be new numbered migrations rather than modifications to a deployed migration. Database selection is explicit through `DATABASE_DRIVER`; a PostgreSQL connection failure never silently falls back to SQLite.

## Storage setup

### Supabase Storage

1. Create a bucket named `studysort` and leave **Public bucket disabled**.
2. Create S3 access credentials in Storage settings. Fill the S3 endpoint, region and keys from the dashboard. A typical endpoint is `https://PROJECT.storage.supabase.co/storage/v1/s3`.
3. Do not add public read/write object policies. Browser access is exclusively via short-lived signed URLs.
4. Do not apply a 25 MiB bucket-wide limit: archives may reach 500 MiB plus ZIP overhead. Allow at least **600 MiB** object size, including the project's global storage setting. Original-file limits are enforced by the application.
5. Run `npm run storage:setup`. It verifies bucket access and tries to configure CORS. Supabase manages CORS; its S3 API may reject bucket-CORS configuration. In that case the script explains the result, and you must verify a browser upload as part of acceptance testing.

### Other S3-compatible storage

Create a private bucket. Allow the exact `APP_URL` origin, methods `PUT`, `GET`, `HEAD`, request headers `*`, and expose `ETag`. `storage:setup` applies these settings where supported. Credentials need object read/write/list/delete, copy and multipart upload access. Set lifecycle rules to abort incomplete multipart uploads after one day as defense against terminated processes; if the provider lacks that feature, monitor unfinished multipart uploads.

Upload URLs expire after 10 minutes. ZIP download URLs expire after two minutes. Session access expires after 24 hours. The storage prefix is always a generated UUID; filenames never determine object keys.

## Gemini configuration and behavior

Create a Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey), enable appropriate billing/quota, and set `GEMINI_API_KEY`.

The default model is `gemini-3.5-flash-lite`, verified with live classification against the configured account. Model availability varies by account and can change; use `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` to configure supported multimodal models. The official SDK calls `models.generateContent` with `responseMimeType` and `responseJsonSchema`. Responses are validated again with Zod.

Dedicated prompts live in `lib/gemini/prompts.ts`. Document content is untrusted data, and the model receives no tools. Filenames are hints only. All extracted text is analyzed in 100,000-character chunks; chunks are aggregated without losing minority-topic coverage. Documents above one million text characters or 1,000 PDF pages are marked for review with an explanation, not silently truncated.

PDFs with sparse pages use native Gemini visual document understanding through the Files API. Mixed PDFs analyze extracted text plus a temporary PDF containing only sparse pages, avoiding resending an entire readable textbook for a few visual pages. Originals are never modified. Temporary provider files are deleted in a `finally` block; if deletion fails, Google's provider retention/expiration applies. The application does **not** promise control over Google's internal data retention. Review [Gemini API terms](https://ai.google.dev/gemini-api/terms) before uploading confidential educational documents.

The returned confidence is labeled **AI confidence estimate**, not a calibrated probability. Confidence below 0.6, unreadability or model uncertainty produces **Needs Review**. Classification failure never triggers a filename-only fallback. No chain of thought is requested, stored or shown.

## Duplicates and folder behavior

- Exact SHA-256 matches reuse the earlier file's result without another Gemini call, including earlier failures.
- Normalized extracted-text equality and bottom-256 five-word shingle sketches detect reformatted copies. Displayed text similarity is an actual computed lexical Jaccard estimate, not a semantic probability.
- A lexically plausible candidate, or a same-subject/same-topic candidate, can be compared with Gemini using beginning/middle/end excerpts and full classification summaries. Shared subject alone is insufficient to mark a duplicate.
- Candidate comparison is bounded to one earlier candidate per file for cost control. **Semantic detection is heuristic, not exhaustive**, especially for paraphrased, visual-only, translated or heavily reformatted files. “No duplicate detected” is not proof of uniqueness. Both originals are always included.
- Subject synonyms receive a batch reconciliation pass. Chapters/topics are inferred per document; there is no manufactured syllabus or chapter numbering. Minor naming differences can remain. Reconciliation failure retains the original classifications and displays a warning.
- Multi-chapter material is placed under `Subject / Document type`; secondary subject and topic coverage are recorded in the manifest. A file is never copied into multiple conceptual locations.
- Original names are preserved except unsafe characters, cross-platform length limits and deterministic case-insensitive collisions. Unsupported/corrupt originals go into `Needs Review` with errors in the manifest.

## Deployment to Vercel

1. Push this source, including `package-lock.json`, to your Git repository.
2. Import it into Vercel as a Next.js project. Select **Node.js 22** and enable Fluid Compute on a plan supporting an **800-second** function duration. Use `npm ci` and `npm run build`.
3. Create/configure the hosted database and private bucket as above. Apply the migration once.
4. Configure every required environment variable for the target environment. Select `DATABASE_DRIVER=postgres` and `STORAGE_DRIVER=s3`; local disk modes are not supported on Vercel. Set `APP_URL` to the exact production origin, set `TRUST_PROXY=1`, and **remove `INNGEST_DEV`**. Do not reuse production data for untrusted preview deployments.
5. Create an Inngest Cloud app, configure event and signing keys in Vercel, and deploy. Connect the Vercel integration or sync `https://YOUR_DOMAIN/api/inngest` in the Inngest dashboard.
6. Confirm all three registered functions: `organize-session`, `process-document`, and `maintenance`. Per-document child workflows keep large batches below the checkpoint limit. Maintenance runs every 15 minutes and handles cleanup plus undelivered queued sessions.
7. Verify `/api/health` returns `configured:true`. This checks environment presence, **not** provider connectivity. Then run the live acceptance suite against the deployment to verify storage/database/Gemini/jobs/download end to end.
8. Set provider spending limits and Vercel firewall/bot controls appropriate to public traffic. Inspect failed jobs in Inngest and configure failure alerts.

No Vercel Cron is required: the Inngest maintenance function is the scheduler. No persistent local files or external conversion binaries are needed. `maxDuration` is exported in the job route. Inngest persists checkpoints between requests; a hundreds-file batch can span many function invocations.

## Tests and validation

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:browser
npm audit
```

Offline tests generate actual PDF/DOCX/PPTX containers, test ten PDFs from three content areas, exact and reformatted duplicates, sparse-page routing, mixed extraction, corrupt-file isolation, malicious XML rejection, safe paths, collisions, schema validation, session-signature boundaries, and **real ZIP creation and byte-for-byte extraction** with an in-memory storage transport. That archive test replaces only cloud I/O. No production AI behavior is mocked.

Browser checks cover desktop/mobile selection, removal, input errors, responsive layout, results search, filters, folder expansion, file details and download behavior. The results-interaction tests intercept the API using test fixtures; they do not count as live Gemini or cloud verification. Install Chromium once with `npx playwright install chromium`. Browser tests use the production build, so run `npm run build` first.

Temporary storage can reach approximately three times the original batch size while incoming uploads, sealed originals and the ZIP coexist. Provision storage quotas accordingly.

### Full live acceptance (incurs real API usage)

Start the app and Inngest with configured hosted credentials, then:

```powershell
npx playwright install chromium
$env:RUN_LIVE = '1'
$env:LIVE_BASE_URL = 'http://localhost:3000'
npm run test:live
```

For a deployed app, use its exact origin as `LIVE_BASE_URL`. On POSIX shells: `RUN_LIVE=1 LIVE_BASE_URL=https://your-domain npm run test:live`.

`tests/live.test.ts` uploads 17 real fixtures including 10 PDFs from three subjects, an exact copy, a metadata-rewritten copy, DOCX, PPTX, TXT, a genuinely rasterized scanned PDF, and a corrupted PDF. It deliberately gives legal and music documents misleading filenames. It checks dynamic content-based subjects, duplicate flags, scanned-content understanding, per-file failure isolation, unauthorized-session rejection and every original hash after the ZIP download. The test waits up to 20 minutes for durable jobs. Without `RUN_LIVE=1`, it is explicitly **skipped**, never reported as a live pass.

## Privacy, retention and cancellation

No user account is created. A session UUID alone is insufficient: its signed HttpOnly cookie is required. The ID is stored in localStorage only to resume this browser's session. Clearing cookies loses session access; there is no account recovery.

Sessions expire at 24 hours. Maintenance selects records at least 15 minutes past expiration, allowing in-flight steps to stop, and runs every 15 minutes. Normal deletion is therefore approximately **24h15m–24h30m** after creation, with later retries during outages/backlogs. Objects are removed first; database records are deleted only after confirmed storage cleanup. Until the scheduler succeeds, expired data may still exist but cannot be accessed through the application. Monitor maintenance failures: disabling Inngest also disables automatic deletion.

Cancellation is cooperative: it stops new analysis at the next checkpoint and archive generation between files. It cannot recall an already-sent Gemini request. Cancelled files remain private until scheduled cleanup. Starting a new session does not instantly delete the old one.

## Security considerations

- Secrets stay server-side; scoped SameSite Strict cookies authorize anonymous sessions; same-origin checks protect mutation routes.
- Requests have bounded body/file/batch sizes. Five new sessions per IP per hour and 100 globally per hour are enforced with PostgreSQL atomic counters. Local deployments share a single budget; only enable trusted IP headers behind Vercel.
- Storage is private. Upload requests sign the expected content length and expire quickly. Content signatures are validated before extraction, and immutable originals are sealed before analysis.
- Office archive entry/decompression limits, record nesting limits, XML declaration rejection, and patched PDF.js mitigate malicious input. Encrypted/malformed documents fail closed. User files are never executed.
- Generated folder segments reject traversal, platform-reserved names and invalid characters. ZIP paths are checked again before archiving. Original files are delivered only in an attachment archive, never rendered as executable HTML.
- Use isolated cloud credentials and quota limits. Anonymous public AI services can be abused despite rate limits; production firewall controls and provider billing alerts are still required.
- A dependency lockfile is included. Keep dependencies patched and run the audit regularly.

## Troubleshooting and practical limits

| Symptom                                | Check                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| “Cloud services are not configured”    | Required `.env.local` / Vercel variables, then restart/redeploy                                     |
| Session creation returns unavailable   | Database URI, password encoding, TLS, migration and role access                                     |
| Upload cannot reach storage            | Endpoint/region/S3 keys, bucket privacy, CORS and object size settings                              |
| Queue never advances                   | Inngest dev server or Cloud sync, event/signing keys, remove production `INNGEST_DEV`               |
| Gemini access denied                   | API key permissions, billing, project restrictions                                                  |
| Model unavailable                      | Choose an accessible multimodal JSON-output model in `GEMINI_MODEL`                                 |
| Quota/rate limit                       | Lower batch size or increase Gemini quota; bounded retries do not hide exhausted quota              |
| Needs Review on Office files           | Corruption/encryption, too little text; export image-only Office material as PDF                    |
| ZIP fails                              | Object read permissions, multipart support, missing originals, function duration or provider outage |
| Files persist past expiration          | Verify maintenance job is enabled and storage deletes succeed                                       |
| Session unavailable in another browser | Expected: no-login access is bound to the creating browser cookie                                   |

Legacy DOC/PPT extraction does not render every diagram, equation, embedded object, language codepage or image. DOCX/PPTX extraction preserves text content but not visual formatting; export visually dense presentations to PDF for visual understanding. PDFs with embedded text but important image-only diagrams can still need manual review. Password-protected files are not decrypted. No OCR quality or Gemini classification accuracy can be guaranteed for illegible scans. Semantic duplicate discovery is approximate; no originals are deleted to resolve duplicates. Users cannot manually reassign folders in this version; they can inspect and download all material.

## Reference documentation

- [Google GenAI JavaScript SDK](https://googleapis.github.io/js-genai/)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini document understanding](https://ai.google.dev/gemini-api/docs/document-processing)
- [Supabase S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)
- [Inngest with Next.js](https://www.inngest.com/docs/getting-started/nextjs-quick-start)
- [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration)
