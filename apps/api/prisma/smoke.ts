import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { ConversationsService } from "../src/conversations/conversations.service";
import type { PrismaService } from "../src/prisma/prisma.service";

/**
 * Smoke da base mínima da F1 (critério de aceite):
 * cria uma conversa, salva mensagens e busca a conversa com as mensagens —
 * exercitando o ConversationsService real contra o banco.
 *
 * Rodar (após o seed): pnpm --filter @dentaltrack/api db:smoke
 */

const DEMO_CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
  const prisma = new PrismaClient({ adapter });
  // O service só usa métodos do PrismaClient; o cast é seguro para o smoke.
  const conversations = new ConversationsService(prisma as unknown as PrismaService);

  try {
    const conversation = await conversations.createConversation(DEMO_CLINIC_ID);
    console.log(`✔ Conversa criada: ${conversation.id} (status=${conversation.status})`);

    await conversations.appendMessage(conversation.id, "user", "Olá, quero saber sobre implante.");
    await conversations.appendMessage(
      conversation.id,
      "assistant",
      "Claro! O implante repõe o dente perdido. Quer agendar uma avaliação?",
    );
    await conversations.appendMessage(conversation.id, "user", "Sim, pode ser na quinta de manhã.");

    const full = await conversations.getConversation(conversation.id, DEMO_CLINIC_ID);
    console.log(`✔ Conversa recuperada com ${full.messages.length} mensagens:`);
    for (const m of full.messages) {
      console.log(`   [${m.role}] ${m.content}`);
    }

    if (full.messages.length !== 3) {
      throw new Error(`Esperava 3 mensagens, obtive ${full.messages.length}.`);
    }
    console.log("✔ Smoke OK.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Falha no smoke:", err);
  process.exit(1);
});
