import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // No watch (pnpm dev) NÃO limpar: o clean apaga os .d.ts por alguns segundos
  // e o tsc/nest --watch da api faz a checagem inicial nessa janela (TS7016).
  clean: !options.watch,
  sourcemap: true,
  treeshake: true,
}));
