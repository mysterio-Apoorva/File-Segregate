import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": path.resolve(root, "tests/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 30000,
    include: ["tests/*.test.ts"],
  },
});
