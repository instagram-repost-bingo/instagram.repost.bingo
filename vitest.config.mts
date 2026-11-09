import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // Next.js handles `import "server-only"` itself; under Vitest it is a no-op.
      "server-only": path.join(root, "tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    // The first run downloads a MongoDB binary for the integration tests.
    hookTimeout: 180_000,
  },
});
