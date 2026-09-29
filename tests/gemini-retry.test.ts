import { afterEach, it, expect, vi } from "vitest";
const generate = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: generate }; } }));
vi.mock("@/lib/config", () => ({ env: () => ({ GEMINI_API_KEY: "test-only", GEMINI_MODEL: "primary", GEMINI_FALLBACK_MODEL: "fallback" }) }));
import { analyzeText } from "@/lib/gemini";
const result = { subject: "Ecology", chapter: "", topic: "Populations", subtopic: "", documentType: "Notes", description: "Population dynamics", keywords: [], confidence: .9, reasoningSummary: "Covers population growth.", isEducationalMaterial: true, secondarySubjects: [], topicCoverage: [], spansMultipleChapters: false, needsReview: false, reviewReason: "" };
afterEach(() => { vi.useRealTimers(); generate.mockReset(); });
it("retries provider overload on the configured real-model fallback", async () => {
  vi.useFakeTimers();
  generate.mockRejectedValueOnce(new Error("503 UNAVAILABLE")).mockResolvedValueOnce({ text: JSON.stringify(result) });
  const pending = analyzeText("Population dynamics notes", "random.txt");
  await vi.runAllTimersAsync();
  expect(await pending).toEqual(result);
  expect(generate.mock.calls.map(call => call[0].model)).toEqual(["primary", "fallback"]);
});
it("does not retry invalid API credentials or fabricate an analysis", async () => {
  generate.mockRejectedValue(new Error("403 API key denied"));
  await expect(analyzeText("Population dynamics notes", "random.txt")).rejects.toThrow("403");
  expect(generate).toHaveBeenCalledTimes(1);
});
it("provides validation feedback when the model returns an oversized category", async () => {
  vi.useFakeTimers();
  generate.mockResolvedValueOnce({ text: JSON.stringify({ ...result, topic: "x".repeat(121) }) }).mockResolvedValueOnce({ text: JSON.stringify(result) });
  const pending = analyzeText("Population dynamics", "random.txt");
  await vi.runAllTimersAsync();
  expect(await pending).toEqual(result);
  expect(generate.mock.calls[1][0].config.systemInstruction).toContain("topic: Too big");
});
