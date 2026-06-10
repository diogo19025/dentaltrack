import { expect, test } from "@playwright/test";

/**
 * /settings (QA-4.2): edita a identidade, salva (PATCH /settings) e confere a
 * persistência após reload. Usa um sufixo único para o form ficar dirty mesmo
 * em rodadas repetidas.
 */
test("configurações: editar, salvar e persistir", async ({ page }) => {
  await page.goto("/settings");

  const clinicName = `Clínica E2E ${Date.now() % 100_000}`;
  const nameInput = page.getByPlaceholder("Nome da sua clínica");
  await expect(nameInput).toBeVisible();

  const save = page.getByRole("button", { name: "Salvar alterações" });
  await expect(save).toBeDisabled(); // sem alterações → desabilitado

  await nameInput.fill(clinicName);
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.getByText("Alterações salvas.")).toBeVisible();
  await expect(save).toBeDisabled(); // reset(saved) limpa o isDirty

  await page.reload();
  await expect(page.getByPlaceholder("Nome da sua clínica")).toHaveValue(clinicName);

  // As 4 abas do segmented existem (Identidade/Ofertas + catálogo da F2).
  for (const tab of ["Identidade & Persona", "Ofertas & Instruções", "Procedimentos", "Tags"]) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible();
  }
});
