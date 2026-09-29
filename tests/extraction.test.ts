import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  extract,
  chunksOf,
  contentFingerprint,
  sha256,
} from "@/lib/extraction";
import { fingerprint, similarity } from "@/lib/duplicates";
import { pdf, docx, pptx, material, zip } from "./fixtures";
describe("content ingestion", () => {
  it("preserves whitespace across Office text runs and leading zeroes", async () => {
    const input = await zip({
      "word/document.xml":
        '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Reference code </w:t></w:r><w:r><w:t>007</w:t></w:r><w:r><w:t xml:space="preserve"> is significant in this educational example.</w:t></w:r></w:p></w:body></w:document>',
    });
    expect((await extract(input, "docx")).text).toContain(
      "Reference code 007 is significant",
    );
  });
  it("reads ten PDFs with meaningless names across three actual content areas", async () => {
    const subjects = Object.values(material);
    for (let i = 0; i < 10; i++) {
      const input = await pdf(subjects[i % 3], `random-${i}`);
      const result = await extract(input, "pdf");
      expect(result.text).toContain(subjects[i % 3].split(":")[0]);
      expect(result.pageCount).toBe(1);
      expect(result.visual).toBe(false);
    }
  });
  it("extracts PDF, DOCX paragraphs and tables, PPTX slides and notes, and TXT", async () => {
    const results = await Promise.all([
      extract(await pdf(material.law), "pdf"),
      extract(await docx(material.ecology), "docx"),
      extract(await pptx(material.music), "pptx"),
      extract(Buffer.from(material.ecology), "txt"),
    ]);
    expect(results.every((r) => r.text.length > 100)).toBe(true);
    expect(results[1].text).toContain("Table content is preserved");
    expect(results[2].text).toContain("Speaker notes");
    expect(results[2].pageCount).toBe(1);
  });
  it("routes a PDF with no readable text to visual document understanding", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawRectangle({ x: 30, y: 30, width: 100, height: 100 });
    const result = await extract(Buffer.from(await doc.save()), "pdf");
    expect(result.visual).toBe(true);
    expect(result.metadata.sparsePages).toBe(1);
  });
  it("isolates corrupt documents from other files", async () => {
    const results = await Promise.allSettled([
      extract(Buffer.from("%PDF-broken"), "pdf"),
      extract(Buffer.from(material.law), "txt"),
      extract(Buffer.from("bad"), "docx"),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      "rejected",
      "fulfilled",
      "rejected",
    ]);
  });
  it("rejects extension spoofing, binary text and unsupported formats", async () => {
    await expect(extract(Buffer.from("not-a-png"), "png")).rejects.toThrow();
    await expect(
      extract(Buffer.from("hello\0binary"), "txt"),
    ).rejects.toThrow();
    await expect(extract(Buffer.from("MZ"), "exe")).rejects.toThrow();
    await expect(
      extract(Buffer.from("invalid legacy format"), "ppt"),
    ).rejects.toThrow();
    await expect(
      extract(Buffer.from("invalid legacy format"), "doc"),
    ).rejects.toThrow();
  });
  it("rejects Office XML entities rather than expanding them", async () => {
    const unsafe = await zip({
      "word/document.xml":
        '<!DOCTYPE x [<!ENTITY x "expanded">]><w:p>&x;</w:p>',
    });
    await expect(extract(unsafe, "docx")).rejects.toThrow("unsafe");
  });
  it("chunks every character, including the final pages", () => {
    const text = "a".repeat(300001) + "final subject";
    expect(chunksOf(text).join("")).toBe(text);
    expect(chunksOf(text)).toHaveLength(4);
  });
});
describe("duplicates", () => {
  it("recognizes byte identity without a model call", async () => {
    const a = await pdf(material.ecology);
    expect(sha256(a)).toBe(sha256(Buffer.from(a)));
  });
  it("detects the same text in PDFs with different metadata", async () => {
    const a = await pdf(material.ecology, "one"),
      b = await pdf(material.ecology, "two");
    expect(sha256(a)).not.toBe(sha256(b));
    const first = await extract(a, "pdf"),
      second = await extract(b, "pdf");
    expect(contentFingerprint(first.text)).toBe(
      contentFingerprint(second.text),
    );
    expect(similarity(fingerprint(first.text), fingerprint(second.text))).toBe(
      1,
    );
  });
  it("does not equate unrelated content", () => {
    expect(
      similarity(fingerprint(material.music), fingerprint(material.law)),
    ).toBeLessThan(0.1);
    expect(similarity([], [])).toBe(0);
  });
});
