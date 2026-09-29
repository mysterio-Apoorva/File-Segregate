import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/config", () => ({
  env: () => ({
    APP_URL: "https://studysort.example",
    SESSION_SECRET: "unit-test-only-session-signing-key-32-characters",
  }),
}));
import { checkOrigin, equal, sign, parseBody, HttpError } from "@/lib/security";
describe("anonymous session boundaries", () => {
  it("binds signatures to a specific session", () => {
    expect(sign("one")).not.toBe(sign("two"));
    expect(equal(sign("one"), sign("one"))).toBe(true);
    expect(equal(sign("one"), "tampered")).toBe(false);
  });
  it("rejects cross-origin state-changing requests", () => {
    expect(() =>
      checkOrigin(
        new Request("https://studysort.example/api/sessions", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toThrow(HttpError);
    expect(() =>
      checkOrigin(
        new Request("https://studysort.example/api/sessions", {
          headers: { origin: "https://studysort.example" },
        }),
      ),
    ).not.toThrow();
  });
  it("bounds streamed JSON request bodies and validates syntax", async () => {
    await expect(
      parseBody(
        new Request("https://studysort.example", {
          method: "POST",
          body: "x".repeat(100001),
        }),
      ),
    ).rejects.toThrow("too large");
    await expect(
      parseBody(
        new Request("https://studysort.example", {
          method: "POST",
          body: "not json",
        }),
      ),
    ).rejects.toThrow("valid JSON");
  });
});
