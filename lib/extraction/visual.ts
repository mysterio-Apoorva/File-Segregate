import { PDFDocument } from "pdf-lib";
/** Send just sparse pages to vision; readable pages take the text pipeline. */
export async function visualInput(buffer: Buffer, mimeType: string, metadata: Record<string, unknown>): Promise<Buffer> {
  if (mimeType !== "application/pdf" || typeof metadata.visualPageNumbers !== "string" || !metadata.visualPageNumbers) return buffer;
  const pages = metadata.visualPageNumbers.split(",").map(Number);
  if (pages.length === metadata.pageCount) return buffer;
  const source = await PDFDocument.load(buffer);
  if (pages.some(page => !Number.isInteger(page) || page < 0 || page >= source.getPageCount())) throw new Error("Invalid PDF page selection.");
  const subset = await PDFDocument.create();
  for (const page of await subset.copyPages(source, pages)) subset.addPage(page);
  return Buffer.from(await subset.save());
}
