import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Each test file gets a fresh module registry — prevents state leaking
    // between test files that both import sportsCache.ts.
    isolate: true,
  },
});
