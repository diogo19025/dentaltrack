import { expect, test } from "@playwright/test";

/**
 * /leads (QA-4.2). Roda depois do chat.spec (workers=1, ordem alfabética), então
 * o lead "Paciente E2E" capturado pelas tools já existe na clínica e2e.
 */
test("leads: cards-resumo, tabela e busca", async ({ page }) => {
  await page.goto("/leads");

  for (const label of ["Total de leads", "Agendados", "Em andamento", "Não completados"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // Lead capturado no fluxo conversar→agendar.
  await expect(page.getByText("Paciente E2E").first()).toBeVisible();

  // Busca: termo inexistente → estado vazio filtrado; termo válido → volta.
  const search = page.getByPlaceholder("Buscar por nome, telefone ou tag…");
  await search.fill("zzz-inexistente");
  await expect(page.getByText("Nenhum lead corresponde aos filtros.")).toBeVisible();
  await search.fill("Paciente E2E");
  await expect(page.getByText("Paciente E2E").first()).toBeVisible();

  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeVisible();
});
