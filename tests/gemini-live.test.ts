import { describe, it, expect } from "vitest";
import { analyzeText, aiError } from "@/lib/gemini";
import { material } from "./fixtures";
describe.skipIf(process.env.RUN_GEMINI_LIVE !== "1")("real Gemini connection", () => {
  it("classifies content through the actual configured model", async () => {
    try {
      const result = await analyzeText(material.ecology, "meaningless-file-name.txt");
      expect(result.isEducationalMaterial).toBe(true);
      expect(result.subject.trim().length).toBeGreaterThan(0);
      expect(result.subject.toLowerCase()).not.toContain("meaningless");
    } catch (error) {
      // Do not include SDK request details or credentials in test output.
      const key = process.env.GEMINI_API_KEY || "";
      const detail = error instanceof Error ? error.message : "Unknown provider error";
      const safe = key ? detail.replaceAll(key, "[redacted]") : detail;
      throw new Error(`${aiError(error)} Provider detail: ${safe.slice(0, 1500)}`);
    }
  }, 300000);
});
