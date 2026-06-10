import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest (QA-4.1) — unit tests do web. Ambiente jsdom + Testing Library;
 * alias `@/` espelha o tsconfig. E2E (Playwright) fica fora deste runner.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["{app,components,hooks,lib}/**/*.test.{ts,tsx}"],
  },
});
