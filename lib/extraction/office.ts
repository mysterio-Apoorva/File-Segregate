import yauzl from "yauzl";
import { XMLParser } from "fast-xml-parser";
import * as CFB from "cfb";
const xml = new XMLParser({
  ignoreAttributes: true,
  preserveOrder: true,
  processEntities: true,
  trimValues: false,
  parseTagValue: false,
});
function collect(value: unknown): string {
  if (Array.isArray(value)) return value.map(collect).join("");
  if (typeof value !== "object" || value === null) return "";
  return Object.entries(value)
    .map(([key, child]) => {
      if (key === "#text") return String(child);
      const text = collect(child);
      return text + (/:(p|tr|br|tab)$/.test(key) ? "\n" : "");
    })
    .join("");
}
export async function extractOpenXml(buffer: Buffer, extension: string) {
  const parts: { name: string; text: string }[] = [];
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip)
          return reject(
            new Error("The Office document is not a valid ZIP container."),
          );
        let entries = 0,
          total = 0;
        const fail = (err: Error) => {
          zip.close();
          reject(err);
        };
        zip.on("error", fail);
        zip.on("end", resolve);
        zip.on("entry", (entry: yauzl.Entry) => {
          if (
            ++entries > 10000 ||
            entry.uncompressedSize > 50_000_000 ||
            (total += entry.uncompressedSize) > 150_000_000
          )
            return fail(
              new Error("Office document exceeds safe decompression limits."),
            );
          const wanted =
            extension === "docx"
              ? /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/
              : /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/;
          if (!wanted.test(entry.fileName)) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream)
              return fail(
                new Error("Office content could not be decompressed."),
              );
            const chunks: Buffer[] = [];
            let bytes = 0;
            stream.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 20_000_000) {
                stream.destroy(new Error("Office XML is too large."));
                return;
              }
              chunks.push(chunk);
            });
            stream.on("error", fail);
            stream.on("end", () => {
              try {
                const source = Buffer.concat(chunks).toString("utf8");
                if (/<!DOCTYPE|<!ENTITY/i.test(source))
                  throw new Error(
                    "Office document contains unsupported XML declarations.",
                  );
                parts.push({
                  name: entry.fileName,
                  text: collect(xml.parse(source)),
                });
                zip.readEntry();
              } catch {
                fail(new Error("Office XML is corrupted or unsafe."));
              }
            });
          });
        });
        zip.readEntry();
      },
    );
  });
  parts.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  if (!parts.length)
    throw new Error("No readable document or slide content was found.");
  return {
    text: parts.map((p) => `[${p.name}]\n${p.text}`).join("\n\n"),
    pageCount:
      extension === "pptx"
        ? parts.filter((p) => p.name.startsWith("ppt/slides/")).length
        : null,
  };
}
export function extractLegacyPpt(buffer: Buffer): string {
  const compound = CFB.read(buffer, { type: "buffer" });
  const entry = CFB.find(compound, "PowerPoint Document");
  if (!entry?.content)
    throw new Error(
      "The legacy presentation is encrypted or corrupted. Export it as PPTX or PDF.",
    );
  const data = Buffer.from(entry.content);
  const output: string[] = [];
  let records = 0;
  function walk(start: number, end: number, depth: number) {
    if (depth > 40)
      throw new Error("Legacy presentation nesting exceeds safe limits.");
    for (let offset = start; offset + 8 <= end;) {
      if (++records > 200000)
        throw new Error("Legacy presentation exceeds safe record limits.");
      const flags = data.readUInt16LE(offset),
        type = data.readUInt16LE(offset + 2),
        size = data.readUInt32LE(offset + 4);
      const next = offset + 8 + size;
      if (next > end)
        throw new Error("Legacy presentation contains a damaged record.");
      if ((flags & 15) === 15) walk(offset + 8, next, depth + 1);
      else if (type === 4000 || type === 4008 || type === 4026)
        output.push(
          data
            .subarray(offset + 8, next)
            .toString(type === 4008 ? "latin1" : "utf16le"),
        );
      offset = next;
    }
  }
  walk(0, data.length, 0);
  return output.join("\n");
}
