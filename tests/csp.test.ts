import { it, expect, vi } from "vitest";
import config from "../next.config";
it("allows React development evaluation and HMR without weakening production CSP", async () => {
  try {
    vi.stubEnv("NODE_ENV", "development");
    const dev = (await config.headers!())[0].headers.find(h => h.key === "Content-Security-Policy")!.value;
    expect(dev).toContain("'unsafe-eval'"); expect(dev).toContain("ws:");
    vi.stubEnv("NODE_ENV", "production");
    const prod = (await config.headers!())[0].headers.find(h => h.key === "Content-Security-Policy")!.value;
    expect(prod).not.toContain("'unsafe-eval'"); expect(prod).not.toContain("ws:");
  } finally { vi.unstubAllEnvs(); }
});
