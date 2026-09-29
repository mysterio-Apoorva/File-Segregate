# Verification record

Verified locally on 2026-09-29.

| Check | Result |
| --- | --- |
| Production Next.js build | Passed; application and API routes compiled |
| TypeScript | Passed as part of the production build |
| ESLint | Passed, no errors or warnings |
| Offline tests | 44 passed, 2 live-provider suites skipped; includes SQLite, local filesystem/ZIP, CSP, model retry and sparse-page subset tests |
| Chromium browser tests | 7 passed; duplicate mobile HTTP-upload case skipped |
| Dependency audit | 0 known vulnerabilities at verification time |
| Real Gemini + hosted storage/database/job acceptance | Not run: cloud credentials were not configured |
| Direct live Gemini classification | Passed with gemini-3.5-flash-lite; latest six-file user batch recovered and its real ZIP regenerated |
| Public deployment | Not performed: requires the operator's cloud accounts and credentials |

The offline suite exercises real PDF/DOCX/PPTX extraction, sparse-PDF visual routing, Office whitespace and numeric preservation, corruption isolation, exact/content duplicate mechanics, unsafe XML rejection, schema validation, session security, cross-platform/Unicode folder paths, and actual ZIP generation with byte-for-byte extraction. ZIP tests substitute in-memory cloud transport. They also verify cancellation, missing originals and early upload failures.

Browser tests exercise the actual built frontend, including selection/removal, empty-file errors, desktop/mobile layout, results search and filtering, folder expansion/collapse, classification details and download interaction. Results tests use explicit API fixtures; they do not establish that external providers work.

The opt-in `tests/live.test.ts` performs the real 17-file upload-to-ZIP acceptance run, including all seven requested scenarios. It is intentionally reported as **skipped** in ordinary offline tests. Set up the services described in README.md, then run it before opening a public deployment.

No finite test suite guarantees a bug-free system. Local Gemini classification has been verified, but hosted production configuration and the full opt-in acceptance suite remain unverified.

Latest fixes: development CSP permits React's development-only eval and WebSocket connections; production CSP still excludes unsafe-eval. TypeScript and ESLint passed, and three desktop workspace browser tests passed against the running development server. Mixed PDFs now analyze all extracted text plus only sparse pages visually, preserving original bytes. Provider failures are labeled Processing failed rather than presented as AI uncertainty. No new production build was run during these fixes to avoid disrupting the active development server; the build result above is from the earlier verification.

SQLite follow-up: initialized the local database successfully; verified actual disk persistence across reopen, JSON round trips, parameter binding, rollback, transaction serialization, taxonomy UUIDs, cascading cleanup, expiration queries and atomic counters. Hosted PostgreSQL remains available for deployment.

Local storage follow-up: the private configuration now selects `STORAGE_DRIVER=local`. No S3 credentials are required. Tested actual disk uploads, size limits, write-once originals, sealing, signed-link tampering/expiration, targeted session cleanup, archive retries, and actual ZIP creation against real SQLite and filesystem storage. A browser API test verified session ownership, tampered-link rejection, wrong-size rejection, a successful upload, replay rejection and post-cancellation rejection. Its small test upload is in a cancelled session and follows normal expiration cleanup. The app and local job runner must remain running for scheduled cleanup to execute.
