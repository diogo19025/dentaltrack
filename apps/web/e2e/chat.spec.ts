import { expect, test } from "@playwright/test";

/**
 * Fluxo conversar→agendar (QA-4.2). O provider mock responde determinístico:
 * 1ª mensagem → texto em streaming; mensagem com "agendar" → tools reais
 * (captureLead + bookAppointment no banco ⇒ conversão) + confirmação.
 */
test("conversa com streaming e registra agendamento (conversão)", async ({ page }) => {
  await page.goto("/chat");

  // Estado inicial: saudação + quick replies.
  await expect(page.getByText("Sou a assistente virtual da clínica")).toBeVisible();
  await expect(page.getByRole("button", { name: "Quero agendar uma consulta" })).toBeVisible();

  const input = page.getByPlaceholder("Escreva sua mensagem…");
  const send = page.getByRole("button", { name: "Enviar" });

  // Turno 1 — dúvida comum → resposta mock em streaming.
  await input.fill("Olá! O que vocês oferecem?");
  await send.click();
  await expect(page.getByText("procedimentos do catálogo")).toBeVisible({ timeout: 20_000 });

  // Quick replies somem após a 1ª troca.
  await expect(page.getByRole("button", { name: "Quero agendar uma consulta" })).toHaveCount(0);

  // Turno 2 — pedido de agendamento → tools (lead + appointment) + confirmação.
  await input.fill(
    "Quero agendar uma avaliação. Meu nome é Paciente E2E, telefone (11) 91234-5678, pode ser terça de manhã.",
  );
  await send.click();
  await expect(page.getByText("pedido de agendamento")).toBeVisible({ timeout: 20_000 });

  // Conversão de verdade: o rail reflete o status `agendada` vindo do banco.
  await expect(page.getByText("Agendada", { exact: true })).toBeVisible({ timeout: 20_000 });
});
