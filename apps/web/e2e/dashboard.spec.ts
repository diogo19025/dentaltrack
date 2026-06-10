import { expect, test } from "@playwright/test";

const KPI_LABELS = [
  "Leads totais",
  "Mensagens do bot (50d)",
  "Taxa de resposta",
  "Taxa de conversão",
  "Em andamento",
  "Não completadas",
];

test("dashboard renderiza os 6 KPIs, gráficos e troca de período", async ({ page }) => {
  await page.goto("/");

  for (const label of KPI_LABELS) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Conversas recentes")).toBeVisible();
  await expect(page.getByText(/últimos 50 dias/)).toBeVisible();

  // Filtro de período: segmented refaz o fetch e atualiza o subtítulo da linha.
  await page.getByRole("tab", { name: "7 dias", exact: true }).click();
  await expect(page.getByText(/últimos 7 dias/)).toBeVisible();

  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible();
});
