import { db } from "../lib/database";
import { readObject } from "../lib/storage";
import { extract, chunksOf } from "../lib/extraction";
import { analyzeText, analyzeVisual } from "../lib/gemini";
import { visualInput } from "../lib/extraction/visual";
const id = process.argv[2];
const [file] = await db()<{ storage_key: string; size: number; extension: string; original_name: string }[]>`SELECT storage_key, size, extension, original_name FROM files WHERE id = ${id}`;
if (!file) throw new Error("File not found");
const document = await extract(await readObject(file.storage_key, file.size), file.extension);
try {
  const result = process.argv.includes("--visual")
    ? await analyzeVisual(await visualInput(await readObject(file.storage_key, file.size), document.mimeType, document.metadata), document.mimeType, file.original_name)
    : await analyzeText(chunksOf(document.text)[0], file.original_name);
  console.log(JSON.stringify({ subject: result.subject, confidence: result.confidence, needsReview: result.needsReview }));
} catch (error) {
  console.error((error instanceof Error ? error.message : "Unknown error").replaceAll(process.env.GEMINI_API_KEY || "<unset>", "[redacted]").slice(0, 1500)); process.exitCode = 1;
}
