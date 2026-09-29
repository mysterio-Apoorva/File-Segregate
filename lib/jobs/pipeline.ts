import "server-only";
import { db } from "@/lib/database";
import { readObject } from "@/lib/storage";
import {
  extract,
  sha256,
  contentFingerprint,
  chunksOf,
} from "@/lib/extraction";
import { fingerprint, similarity } from "@/lib/duplicates";
import {
  analyzeText,
  analyzeVisual,
  aggregate,
  aiError,
  compare,
  reconcileSubjects,
} from "@/lib/gemini";
import { allocatePaths } from "@/lib/paths";
import { visualInput } from "@/lib/extraction/visual";
import type { Analysis, FileRow } from "@/lib/schemas";
export async function active(id: string) {
  const [session] =
    await db()`SELECT status, expires_at FROM sessions WHERE id = ${id}`;
  return Boolean(
    session &&
    !["cancelled", "failed", "complete"].includes(session.status) &&
    new Date(session.expires_at).getTime() > Date.now(),
  );
}
export async function filesFor(id: string): Promise<FileRow[]> {
  return await db()<
    FileRow[]
  >`SELECT * FROM files WHERE session_id = ${id} ORDER BY created_at, id`;
}
export async function failFile(id: string, message: string) {
  await db()`UPDATE files SET status = 'failed', error = ${message.slice(0, 500)} WHERE id = ${id}`;
}
export async function prepareFile(id: string) {
  const sql = db();
  const [file] = await sql<FileRow[]>`SELECT * FROM files WHERE id = ${id}`;
  if (!file || !(await active(file.session_id)))
    return { skip: true, chunks: 0, visual: false };
  if (file.status === "failed" || file.status === "ready")
    return { skip: true, chunks: 0, visual: false };
  await sql`UPDATE files SET status = 'extracting' WHERE id = ${id}`;
  try {
    const buffer = await readObject(file.storage_key, file.size);
    const hash = sha256(buffer);
    await sql`UPDATE files SET sha256 = ${hash} WHERE id = ${id}`;
    const [same] = await sql<
      FileRow[]
    >`SELECT * FROM files WHERE session_id = ${file.session_id} AND sha256 = ${hash} AND id != ${id} AND status IN ('ready','failed') ORDER BY created_at, id LIMIT 1`;
    if (same) {
      await sql`UPDATE files SET status = ${same.status}, error = ${same.error}, analysis = ${same.analysis ? sql.json(same.analysis) : null}, mime_type = ${same.mime_type}, extraction_metadata = ${sql.json(same.extraction_metadata || {})}, content_fingerprint = ${same.content_fingerprint}, semantic_fingerprint = ${sql.json(same.semantic_fingerprint || [])}, duplicate_status = 'exact', duplicate_of = ${same.id}, duplicate_explanation = 'Identical SHA-256 bytes; analysis result reused without another Gemini call.' WHERE id = ${id}`;
      return { skip: true, chunks: 0, visual: false };
    }
    const result = await extract(buffer, file.extension);
    const hasText = result.text.replace(/\[Page \d+\]/g, "").replace(/\s/g, "").length >= 80;
    const textChunks = !result.visual || hasText ? chunksOf(result.text).length : 0;
    result.metadata.textChunkCount = textChunks;
    await sql`INSERT INTO extracted_documents (file_id, content, visual, metadata) VALUES (${id}, ${result.text}, ${result.visual}, ${sql.json(result.metadata)}) ON CONFLICT (file_id) DO UPDATE SET content = excluded.content, visual = excluded.visual, metadata = excluded.metadata`;
    await sql`UPDATE files SET status = 'analyzing', mime_type = ${result.mimeType}, content_fingerprint = ${result.text ? contentFingerprint(result.text) : null}, semantic_fingerprint = ${sql.json(result.text ? fingerprint(result.text) : [])}, extraction_metadata = ${sql.json(result.metadata)} WHERE id = ${id}`;
    return {
      skip: false,
      chunks: textChunks + (result.visual ? 1 : 0),
      visual: result.visual,
    };
  } catch (error) {
    await failFile(
      id,
      error instanceof Error
        ? error.message
        : "The document is corrupted or unreadable.",
    );
    return { skip: true, chunks: 0, visual: false };
  }
}
export async function analyzeChunk(id: string, index: number, visual: boolean) {
  const sql = db();
  const [file] = await sql<FileRow[]>`SELECT * FROM files WHERE id = ${id}`;
  if (!file || file.status === "failed" || !(await active(file.session_id)))
    return;
  const exists =
    await sql`SELECT 1 FROM document_chunks WHERE file_id = ${id} AND chunk_index = ${index}`;
  if (exists.length) return;
  try {
    const [document] =
      await sql<{ content: string; metadata: Record<string, unknown> }[]>`SELECT content, metadata FROM extracted_documents WHERE file_id = ${id}`;
    const visualChunk = visual && index >= Number(document.metadata.textChunkCount ?? 0);
    const result = visualChunk
      ? await analyzeVisual(
          await visualInput(await readObject(file.storage_key, file.size), file.mime_type, document.metadata),
          file.mime_type,
          file.original_name,
        )
      : await analyzeText(
          chunksOf(document.content)[index],
          file.original_name,
        );
    await sql`INSERT INTO document_chunks (file_id, chunk_index, analysis) VALUES (${id}, ${index}, ${sql.json(result)}) ON CONFLICT (file_id, chunk_index) DO UPDATE SET analysis = excluded.analysis`;
  } catch (error) {
    await failFile(id, aiError(error));
  }
}
export async function finishAnalysis(id: string) {
  const sql = db();
  const [file] = await sql<FileRow[]>`SELECT * FROM files WHERE id = ${id}`;
  if (!file || file.status === "failed" || !(await active(file.session_id)))
    return;
  try {
    const chunks = await sql<
      { analysis: Analysis }[]
    >`SELECT analysis FROM document_chunks WHERE file_id = ${id} ORDER BY chunk_index`;
    if (!chunks.length) throw new Error("No analysis was produced.");
    const analysis =
      chunks.length === 1
        ? chunks[0].analysis
        : await aggregate(chunks.map((c) => c.analysis));
    if (analysis.confidence < 0.6) {
      analysis.needsReview = true;
      analysis.reviewReason ||=
        "The AI confidence estimate is low. Please inspect the material.";
    }
    await sql`UPDATE files SET status = 'classified', analysis = ${sql.json(analysis)} WHERE id = ${id}`;
  } catch (error) {
    await failFile(id, aiError(error));
  }
}
function excerpt(text: string) {
  if (text.length <= 16000) return text;
  const middle = Math.floor(text.length / 2);
  return `${text.slice(0, 6000)}\n[Middle excerpt]\n${text.slice(middle - 2000, middle + 2000)}\n[End excerpt]\n${text.slice(-6000)}`;
}
export async function checkDuplicates(id: string) {
  const sql = db();
  const [file] = await sql<FileRow[]>`SELECT * FROM files WHERE id = ${id}`;
  if (
    !file ||
    !file.analysis ||
    file.status === "failed" ||
    file.duplicate_status === "exact" ||
    !(await active(file.session_id))
  )
    return;
  await sql`UPDATE files SET status = 'duplicate-check' WHERE id = ${id}`;
  const previous = await sql<
    FileRow[]
  >`SELECT * FROM files WHERE session_id = ${file.session_id} AND id != ${id} AND status = 'ready' AND analysis IS NOT NULL AND duplicate_status != 'exact'`;
  const ranked = previous
    .map((other) => ({
      other,
      score: similarity(
        file.semantic_fingerprint || [],
        other.semantic_fingerprint || [],
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const candidate =
    ranked.find((c) => c.score >= 0.3) ||
    ranked.find(
      (c) =>
        c.other.analysis!.subject.toLowerCase() ===
          file.analysis!.subject.toLowerCase() &&
        c.other.analysis!.topic.toLowerCase() ===
          file.analysis!.topic.toLowerCase(),
    );
  if (candidate) {
    const [left] =
      await sql`SELECT content FROM extracted_documents WHERE file_id = ${id}`;
    const [right] =
      await sql`SELECT content FROM extracted_documents WHERE file_id = ${candidate.other.id}`;
    const identicalContent = Boolean(
      file.content_fingerprint &&
      file.content_fingerprint === candidate.other.content_fingerprint,
    );
    if (identicalContent || candidate.score >= 0.88) {
      await sql`UPDATE files SET duplicate_status = 'likely', duplicate_of = ${candidate.other.id}, similarity = ${candidate.score}, duplicate_explanation = ${identicalContent ? "Normalized extracted text is identical; original file bytes differ. Both originals are preserved." : "Strong computed overlap of normalized five-word text shingles. Both originals are preserved."} WHERE id = ${id}`;
    } else if (left?.content && right?.content) {
      try {
        const result = await compare(
          { analysis: file.analysis, content: excerpt(left.content) },
          {
            analysis: candidate.other.analysis!,
            content: excerpt(right.content),
          },
        );
        if (result.likelyDuplicate && result.overlap === "high")
          await sql`UPDATE files SET duplicate_status = 'likely', duplicate_of = ${candidate.other.id}, similarity = ${candidate.score}, duplicate_explanation = ${result.explanation} WHERE id = ${id}`;
      } catch {
        await sql`UPDATE files SET error = 'Classification succeeded, but semantic duplicate comparison was unavailable. No duplicate conclusion was made.' WHERE id = ${id}`;
      }
    }
  }
  await sql`UPDATE files SET status = 'ready' WHERE id = ${id}`;
}
export async function reconcile(id: string) {
  const sql = db();
  const files = await filesFor(id);
  const analyses = files.flatMap((f) => (f.analysis ? [f.analysis] : []));
  if (new Set(analyses.map((a) => a.subject)).size > 1) {
    try {
      const result = await reconcileSubjects(analyses);
      const sourceNames = new Set(analyses.map((a) => a.subject));
      const mapping = new Map(
        result.subjects
          .filter(
            (s) =>
              sourceNames.has(s.source) &&
              s.canonical.trim().length > 0 &&
              s.canonical.length <= 120,
          )
          .map((s) => [s.source, s.canonical]),
      );
      for (const file of files)
        if (file.analysis && mapping.has(file.analysis.subject)) {
          file.analysis.subject = mapping.get(file.analysis.subject)!;
          await sql`UPDATE files SET analysis = ${sql.json(file.analysis)} WHERE id = ${file.id}`;
        }
    } catch {
      await sql`UPDATE sessions SET warning = 'Subject-name reconciliation was unavailable. Original content-based classifications were preserved.' WHERE id = ${id}`;
    }
  }
  const paths = allocatePaths(files);
  await sql.begin(async (tx) => {
    for (const file of files) {
      await tx`UPDATE files SET organized_path = ${paths.get(file.id)!} WHERE id = ${file.id}`;
      const a = file.analysis;
      if (a) {
        const [subject] =
          await tx`INSERT INTO subjects (session_id, name) VALUES (${id}, ${a.subject || "Needs Review"}) ON CONFLICT (session_id, name) DO UPDATE SET name = excluded.name RETURNING id`;
        let chapterId: string | null = null,
          topicId: string | null = null;
        if (a.chapter) {
          const [chapter] =
            await tx`INSERT INTO chapters (subject_id, name) VALUES (${subject.id}, ${a.chapter}) ON CONFLICT (subject_id, name) DO UPDATE SET name = excluded.name RETURNING id`;
          chapterId = chapter.id;
          if (a.topic) {
            const [topic] =
              await tx`INSERT INTO topics (chapter_id, name) VALUES (${chapter.id}, ${a.topic}) ON CONFLICT (chapter_id, name) DO UPDATE SET name = excluded.name RETURNING id`;
            topicId = topic.id;
          }
        }
        await tx`INSERT INTO classifications (file_id, subject_id, chapter_id, topic_id, result) VALUES (${file.id}, ${subject.id}, ${chapterId}, ${topicId}, ${tx.json(a)}) ON CONFLICT (file_id) DO UPDATE SET subject_id = excluded.subject_id, chapter_id = excluded.chapter_id, topic_id = excluded.topic_id, result = excluded.result`;
      }
      if (file.duplicate_of)
        await tx`INSERT INTO duplicate_groups (session_id, file_id, canonical_file_id, kind, metric, explanation) VALUES (${id}, ${file.id}, ${file.duplicate_of}, ${file.duplicate_status}, ${file.similarity}, ${file.duplicate_explanation || "Duplicate detected"}) ON CONFLICT (file_id) DO UPDATE SET canonical_file_id = excluded.canonical_file_id, kind = excluded.kind, metric = excluded.metric, explanation = excluded.explanation`;
    }
  });
}
