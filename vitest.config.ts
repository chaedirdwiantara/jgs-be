import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // scrypt at N=16384 is intentionally slow; the default 5s timeout is tight
    // once a few hashes run in one case.
    testTimeout: 20_000,
  },
});
