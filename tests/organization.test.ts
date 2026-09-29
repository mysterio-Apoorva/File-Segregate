import { describe, it, expect } from "vitest";
import { allocatePaths, safeSegment, folderFor } from "@/lib/paths";
import { analysisSchema, type Analysis } from "@/lib/schemas";
import { manifest } from "@/lib/zip";
import { aiError } from "@/lib/gemini";
// Fixtures validate mechanics only; no production classifier is replaced.
const analysis: Analysis = {
  subject: "Ethnomusicology",
  chapter: "Oral traditions",
  topic: "Transmission",
  subtopic: "",
  documentType: "Lecture Notes",
  description: "A test fixture",
  keywords: [],
  confidence: 0.8,
  reasoningSummary: "Content discusses transmission.",
  isEducationalMaterial: true,
  secondarySubjects: [],
  topicCoverage: [],
  spansMultipleChapters: false,
  needsReview: false,
  reviewReason: "",
};
describe("safe dynamic hierarchy", () => {
  it("explains temporary Gemini overload without exposing provider request details", () => {
    expect(aiError(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'))).toContain("temporarily busy");
  });
  it("bounds multilingual path bytes without splitting Unicode characters", () => {
    const paths = allocatePaths([
      {
        id: "unicode",
        original_name: `${"📚".repeat(100)}.pdf`,
        analysis: {
          ...analysis,
          subject: "क".repeat(100),
          chapter: "章".repeat(100),
          topic: "😀".repeat(100),
        },
        status: "ready",
      },
    ]);
    const path = paths.get("unicode")!;
    expect(Buffer.byteLength(path)).toBeLessThan(220);
    expect(path).not.toContain("�");
  });
  it("uses supplied dynamic classifications without a category list", () => {
    expect(folderFor(analysis)).toEqual([
      "Ethnomusicology",
      "Oral traditions",
      "Transmission",
    ]);
  });
  it("omits absent and repeated levels", () => {
    expect(
      folderFor({ ...analysis, chapter: "", topic: "Ethnomusicology" }),
    ).toEqual(["Ethnomusicology"]);
  });
  it("puts broad material under its document type, without duplicate copies", () => {
    expect(
      folderFor({
        ...analysis,
        spansMultipleChapters: true,
        documentType: "Question Banks",
      }),
    ).toEqual(["Ethnomusicology", "Question Banks"]);
  });
  it("places unreadable and uncertain content under Needs Review", () => {
    expect(folderFor(null)).toEqual(["Needs Review"]);
    expect(folderFor({ ...analysis, confidence: 0.3 })).toEqual([
      "Needs Review",
    ]);
  });
  it("removes traversal, Windows reserved names and forbidden characters", () => {
    expect(safeSegment("../../CON:<a>\\b")).not.toMatch(/[\\/:<>]/);
    expect(safeSegment("CON")).toBe("_CON");
    expect(safeSegment("...")).toBe("Untitled");
  });
  it("allocates deterministic case-insensitive collision-safe filenames", () => {
    const files = ["Notes.pdf", "notes.PDF", "../../Notes.pdf"].map(
      (original_name, i) => ({
        id: `${i}`,
        original_name,
        analysis,
        status: "ready",
      }),
    );
    const a = allocatePaths(files),
      b = allocatePaths([...files].reverse());
    expect([...a.values()]).toEqual([...b.values()]);
    expect(new Set([...a.values()].map((v) => v.toLowerCase())).size).toBe(3);
    expect([...a.values()].some((v) => v.includes(".."))).toBe(false);
  });
  it("validates structured AI results and rejects out-of-range confidence", () => {
    expect(analysisSchema.safeParse(analysis).success).toBe(true);
    expect(
      analysisSchema.safeParse({ ...analysis, confidence: 8 }).success,
    ).toBe(false);
    expect(
      analysisSchema.safeParse({ subject: "missing fields" }).success,
    ).toBe(false);
  });
  it("includes transparent confidence and preservation semantics in the manifest", () => {
    const output = manifest([], "2026-01-01T00:00:00Z");
    expect(output.generatedAt).toBe("2026-01-01T00:00:00Z");
    expect(output.confidenceNote).toContain("not calibrated");
  });
});
