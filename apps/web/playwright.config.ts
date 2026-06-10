import { defineConfig } from "@playwright/test";

/**
 * E2E (QA-4.2) — Playwright sobe a API NestJS em modo **mock** (LLM_PROVIDER=mock,
 * determinístico/offline) e o Next dev em portas dedicadas (3100/3101), para não
 * colidir com o `pnpm dev` (3000/3001). Auth/banco são os reais (Supabase) com um
 * usuário e2e dedicado (criado no global-setup; clínica própria via onboarding).
 *
 * Rodar: `pnpm --filter @dentaltrack/web e2e` (requer apps/api/.env preenchido).
 */

const WEB_PORT = 3100;
const API_PORT = 3101;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  globalSetup: "./e2e/global-setup.ts",
  // Specs compartilham o mesmo usuário/clínica e2e → execução serial determinística.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "pt-BR",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { browserName: "chromium", storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
      testMatch: /.*\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "pnpm exec nest start",
      cwd: "../api",
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: String(API_PORT),
        LLM_PROVIDER: "mock",
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `pnpm exec next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      },
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
