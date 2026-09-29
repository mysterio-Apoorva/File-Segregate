import { createHash } from "node:crypto";
import WordExtractor from "word-extractor";
import { extractLegacyPpt, extractOpenXml } from "./office";
import { MAX_TEXT, CHUNK_SIZE } from "@/lib/limits";
export interface Extraction {
  text: string;
  visual: boolean;
  mimeType: string;
  pageCount: number | null;
  metadata: Record<string, string | number | boolean | null>;
}
export const sha256 = (buffer: Buffer | string) =>
  createHash("sha256").update(buffer).digest("hex");
export function cleanText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}
export function contentFingerprint(text: string) {
  return sha256(
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim(),
  );
}
export function chunksOf(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE)
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  return chunks.length ? chunks : [""];
}
export async function extract(
  buffer: Buffer,
  extension: string,
): Promise<Extraction> {
  let text = "",
    visual = false,
    mimeType = "text/plain",
    pageCount: number | null = null;
  const metadata: Record<string, string | number | boolean | null> = {};
  const ole = buffer
    .subarray(0, 8)
    .equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  if (extension === "pdf") {
    if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("This file does not contain a valid PDF header.");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      useWorkerFetch: false,
    });
    try {
      const doc = await task.promise;
      pageCount = doc.numPages;
      if (pageCount > 1000)
        throw new Error(
          "PDF exceeds 1,000 pages. Split it into smaller volumes.",
        );
      const pages: string[] = [];
      const visualPages: number[] = [];
      let sparse = 0,
        characters = 0;
      for (let i = 1; i <= pageCount; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const value = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("");
        if (value.replace(/\s/g, "").length < 80) { sparse++; visualPages.push(i - 1); }
        characters += value.length;
        if (characters > MAX_TEXT)
          throw new Error(
            "PDF contains more than one million text characters. Split it into smaller volumes.",
          );
        pages.push(`[Page ${i}]\n${value}`);
        page.cleanup();
      }
      text = pages.join("\n\n");
      visual = sparse > 0;
      metadata.sparsePages = sparse;
      metadata.visualPageNumbers = visualPages.join(",");
      metadata.extractionMethod = visual
        ? "pdf-text-and-gemini-vision"
        : "pdf-text";
      mimeType = "application/pdf";
    } finally {
      await task.destroy();
    }
  } else if (extension === "docx" || extension === "pptx") {
    if (buffer.readUInt16LE(0) !== 0x4b50)
      throw new Error("This Office file is not a valid document container.");
    ({ text, pageCount } = await extractOpenXml(buffer, extension));
    mimeType =
      extension === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    metadata.extractionMethod = "office-xml";
  } else if (extension === "doc") {
    if (!ole)
      throw new Error(
        "This DOC file is not a valid legacy Word document. Export it as DOCX or PDF.",
      );
    const doc = await new WordExtractor().extract(buffer);
    text = [
      doc.getBody(),
      doc.getFootnotes(),
      doc.getEndnotes(),
      doc.getHeaders(),
      doc.getFooters(),
    ].join("\n");
    mimeType = "application/msword";
    metadata.extractionMethod = "legacy-word";
  } else if (extension === "ppt") {
    if (!ole)
      throw new Error(
        "This PPT file is not a valid legacy presentation. Export it as PPTX or PDF.",
      );
    text = extractLegacyPpt(buffer);
    mimeType = "application/vnd.ms-powerpoint";
    metadata.extractionMethod = "legacy-powerpoint";
  } else if (["txt", "md", "csv"].includes(extension)) {
    const utf16 = buffer[0] === 0xff && buffer[1] === 0xfe;
    text = utf16
      ? buffer.subarray(2).toString("utf16le")
      : new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (text.includes("\0"))
      throw new Error(
        "The text file contains binary data or an unsupported encoding. Save as UTF-8.",
      );
    metadata.extractionMethod = "plain-text";
  } else {
    const png = buffer
      .subarray(0, 8)
      .equals(Buffer.from("89504e470d0a1a0a", "hex"));
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const webp =
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP";
    if (extension === "png" && png) mimeType = "image/png";
    else if (["jpg", "jpeg"].includes(extension) && jpeg)
      mimeType = "image/jpeg";
    else if (extension === "webp" && webp) mimeType = "image/webp";
    else
      throw new Error(
        "Unsupported format or file content does not match its extension.",
      );
    visual = true;
    metadata.extractionMethod = "gemini-vision";
  }
  text = cleanText(text);
  if (text.length > MAX_TEXT)
    throw new Error(
      "Document exceeds one million text characters. Split it into smaller files.",
    );
  if (!visual && text.replace(/\[.*?\]/g, "").trim().length < 30)
    throw new Error(
      "Too little readable content. For image-only Office documents, export as PDF so Gemini can inspect the pages.",
    );
  return {
    text,
    visual,
    mimeType,
    pageCount,
    metadata: { ...metadata, pageCount, characters: text.length },
  };
}
