import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    pool: "threads",
    // The room tests boot a real Colyseus server on a fixed port, so they must
    // not run concurrently with each other.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
