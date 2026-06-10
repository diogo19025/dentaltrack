import { expect, test } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD } from "./credentials";

// Sem sessão salva: este spec testa o próprio fluxo de autenticação.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("login", () => {
  test("rota protegida sem sessão redireciona para /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
  });

  test("senha errada mostra erro e permanece no login", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(E2E_EMAIL);
    await page.locator("#password").fill("senha-incorreta-123");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page.locator("p.text-destructive")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("credenciais válidas entram no painel", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(E2E_EMAIL);
    await page.locator("#password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page).toHaveURL("/", { timeout: 30_000 });
    await expect(page.getByText("Leads totais")).toBeVisible();
  });
});
