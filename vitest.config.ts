import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration project has no tests until M3.
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "shared/src/**/*.test.ts",
            "server/src/**/*.test.ts",
            "web/src/**/*.test.{ts,tsx}",
            "eval/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["server/test/**/*.test.ts", "web/test/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["shared/src/**", "server/src/**", "web/src/**"],
      exclude: ["**/*.test.{ts,tsx}", "server/src/index.ts"],
    },
  },
});
