import { it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { visualInput } from "@/lib/extraction/visual";
import { sha256 } from "@/lib/extraction";
it("sends only sparse pages to vision and preserves the original document bytes", async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([612, 792]);
  const original = Buffer.from(await doc.save()); const before = sha256(original);
  const subset = await visualInput(original, "application/pdf", { visualPageNumbers: "1", pageCount: 3 });
  expect((await PDFDocument.load(subset)).getPageCount()).toBe(1);
  expect(sha256(original)).toBe(before);
  await expect(visualInput(original, "application/pdf", { visualPageNumbers: "99", pageCount: 3 })).rejects.toThrow("Invalid");
});
