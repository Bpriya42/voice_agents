import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  outDir: "dist",
  clean: true,
  // @ava/shared is TypeScript source, so it has to be bundled rather than left external.
  noExternal: ["@ava/shared"],
});
