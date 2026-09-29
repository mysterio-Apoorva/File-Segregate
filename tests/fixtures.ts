import { PDFDocument, StandardFonts } from "pdf-lib";
import archiver from "archiver";
export const material = {
  ecology:
    "Ecology: Population Dynamics. Population growth depends on birth rates, mortality, immigration and emigration. Exponential growth assumes unlimited resources. Logistic growth slows as a population approaches carrying capacity. Density-dependent competition, predation and disease regulate population size. Field ecologists estimate abundance using quadrats, transects and mark-recapture surveys.",
  law: "Contract Law: Offer and Acceptance. A binding contract requires offer, acceptance, consideration and intention to create legal relations. An invitation to treat is not an offer. Acceptance must correspond to the offer and be communicated. Counteroffers reject the initial proposal. Postal acceptance rules and electronic communication create different timing questions. Revocation must occur before effective acceptance.",
  music:
    "Music Theory: Harmony and Cadences. A major triad consists of a root, major third and perfect fifth. In tonal harmony, the dominant chord creates tension resolved by the tonic. An authentic cadence moves from dominant to tonic. A plagal cadence moves from subdominant to tonic. Inversions place a chord member other than the root in the bass. Voice leading connects chords while avoiding parallel perfect fifths.",
};
export async function pdf(text: string, title = "Untitled") {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreationDate(new Date("2026-01-01"));
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const words = text.split(" ");
  let line = "",
    y = 750;
  for (const word of words) {
    if ((line + word).length > 85) {
      page.drawText(line, { x: 40, y, font, size: 11 });
      y -= 17;
      line = "";
    }
    line += `${word} `;
  }
  if (line) page.drawText(line, { x: 40, y, font, size: 11 });
  return Buffer.from(await doc.save());
}
export async function zip(entries: Record<string, string | Buffer>) {
  const archive = archiver("zip");
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  for (const [name, value] of Object.entries(entries))
    archive.append(value, { name });
  await archive.finalize();
  return done;
}
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
export function docx(text: string) {
  return zip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table content is preserved.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  });
}
export function pptx(text: string) {
  return zip({
    "ppt/slides/slide1.xml": `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:p><a:r><a:t>${escape(text)}</a:t></a:r></a:p></p:cSld></p:sld>`,
    "ppt/notesSlides/notesSlide1.xml":
      '<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Speaker notes: compare the two approaches.</a:t></a:r></a:p>',
  });
}
