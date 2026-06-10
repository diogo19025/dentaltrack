import { expect, test as setup } from "@playwright/test";
import { AUTH_FILE, E2E_EMAIL, E2E_PASSWORD } from "./credentials";

/**
 * Autentica o usuário e2e pela UI (cobre o caminho feliz do login) e salva a
 * sessão (cookies do @supabase/ssr) para os demais specs reusarem.
 */
setup("autentica e salva a sessão do usuário e2e", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill(E2E_EMAIL);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  // Login → "/" (dashboard); o onboarding cria a clínica e2e no 1º acesso.
  await expect(page).toHaveURL("/", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
