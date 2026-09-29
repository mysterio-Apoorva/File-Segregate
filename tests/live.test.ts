import { describe, it, expect } from "vitest";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import yauzl from "yauzl";
import { material, pdf, docx, pptx } from "./fixtures";
import type { SessionView } from "@/lib/schemas";
import { sha256 } from "@/lib/extraction";
// This suite calls the REAL deployed/local API and REAL Gemini. It is opt-in,
// incurs provider charges, and does not substitute a fake classifier.
describe.skipIf(process.env.RUN_LIVE !== "1")(
  "live upload-to-ZIP acceptance",
  () => {
    it("handles all seven requested scenarios in one real anonymous batch", async () => {
      const base = process.env.LIVE_BASE_URL || "http://localhost:3000";
      const originals: { name: string; bytes: Buffer }[] = [];
      for (let i = 0; i < 10; i++)
        originals.push({
          name: `random_${i}.pdf`,
          bytes: await pdf(Object.values(material)[i % 3], `r${i}`),
        });
      originals.push({ name: "exact_copy.pdf", bytes: originals[0].bytes });
      originals.push({
        name: "changed_metadata.pdf",
        bytes: await pdf(material.ecology, "Different metadata"),
      });
      originals.push({ name: "Physics.docx", bytes: await docx(material.law) });
      originals.push({ name: "Math.pptx", bytes: await pptx(material.music) });
      originals.push({
        name: "random.txt",
        bytes: Buffer.from(material.ecology),
      });
      originals.push({
        name: "broken.pdf",
        bytes: Buffer.from("%PDF-1.7 corrupted and unreadable"),
      });
      const browser = await chromium.launch({ headless: true });
      let png: Buffer;
      try {
        const page = await browser.newPage({
          viewport: { width: 900, height: 600 },
        });
        await page.setContent(
          `<main style="padding:45px;font:24px/1.6 Arial;background:white;color:black">${material.music}</main>`,
        );
        png = await page.screenshot({ type: "png" });
      } finally {
        await browser.close();
      }
      const scan = await PDFDocument.create();
      const image = await scan.embedPng(png!);
      scan
        .addPage([900, 600])
        .drawImage(image, { x: 0, y: 0, width: 900, height: 600 });
      originals.push({
        name: "scan.pdf",
        bytes: Buffer.from(await scan.save()),
      });
      const created = await fetch(`${base}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify({
          files: originals.map((f) => ({ name: f.name, size: f.bytes.length })),
        }),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const cookie = created.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const session = (await created.json()) as {
        id: string;
        uploads: { id: string; url: string }[];
      };
      for (let i = 0; i < originals.length; i++) {
        const result = await fetch(session.uploads[i].url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            ...(new URL(session.uploads[i].url).origin === new URL(base).origin
              ? { Cookie: cookie, Origin: base }
              : {}),
          },
          body: new Uint8Array(originals[i].bytes),
        });
        expect(result.ok, await result.text()).toBe(true);
      }
      const start = await fetch(`${base}/api/sessions/${session.id}/start`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: base },
      });
      expect(start.status, await start.text()).toBe(202);
      expect((await fetch(`${base}/api/sessions/${session.id}`)).status).toBe(
        403,
      );
      let view: SessionView | undefined;
      for (let poll = 0; poll < 240; poll++) {
        const response = await fetch(`${base}/api/sessions/${session.id}`, {
          headers: { Cookie: cookie },
        });
        expect(response.ok).toBe(true);
        view = await response.json();
        if (["complete", "failed", "cancelled"].includes(view!.session.status))
          break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      expect(
        view?.session.status,
        view?.session.error || "Processing did not finish",
      ).toBe("complete");
      const files = view!.files;
      expect(
        new Set(files.filter((f) => f.analysis).map((f) => f.analysis!.subject))
          .size,
      ).toBeGreaterThanOrEqual(3);
      expect(files.some((f) => f.duplicate_status === "exact")).toBe(true);
      expect(files.some((f) => f.duplicate_status === "likely")).toBe(true);
      expect(files.find((f) => f.original_name === "broken.pdf")?.status).toBe(
        "failed",
      );
      expect(
        files.find((f) => f.original_name === "scan.pdf")?.analysis?.subject,
      ).toMatch(/music|harmony/i);
      expect(
        files.find((f) => f.original_name === "Physics.docx")?.analysis
          ?.subject,
      ).toMatch(/law|legal|contract/i);
      for (const name of ["Math.pptx", "random.txt", "scan.pdf"])
        expect(files.find((f) => f.original_name === name)?.status).toBe(
          "ready",
        );
      const download = await fetch(
        `${base}/api/sessions/${session.id}/download`,
        { headers: { Cookie: cookie } },
      );
      const { url } = (await download.json()) as { url: string };
      const archive = Buffer.from(await (await fetch(url)).arrayBuffer());
      const entries = await new Promise<Map<string, Buffer>>(
        (resolve, reject) => {
          yauzl.fromBuffer(archive, { lazyEntries: true }, (err, zip) => {
            if (err || !zip) return reject(err);
            const result = new Map<string, Buffer>();
            zip.on("error", reject);
            zip.on("end", () => resolve(result));
            zip.on("entry", (entry: yauzl.Entry) =>
              zip.openReadStream(entry, (error, stream) => {
                if (error || !stream) return reject(error);
                const buffers: Buffer[] = [];
                stream.on("error", reject);
                stream.on("data", (b: Buffer) => buffers.push(b));
                stream.on("end", () => {
                  result.set(entry.fileName, Buffer.concat(buffers));
                  zip.readEntry();
                });
              }),
            );
            zip.readEntry();
          });
        },
      );
      const manifest = JSON.parse(
        entries.get("organization_manifest.json")!.toString(),
      );
      expect(manifest.files).toHaveLength(originals.length);
      for (const original of originals) {
        const row = files.find((f) => f.original_name === original.name)!;
        expect(sha256(entries.get(row.organized_path!)!)).toBe(
          sha256(original.bytes),
        );
      }
    }, 1_300_000);
  },
);
