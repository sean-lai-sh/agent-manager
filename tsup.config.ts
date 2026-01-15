import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/orchestrator/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  outDir: "dist",
});
