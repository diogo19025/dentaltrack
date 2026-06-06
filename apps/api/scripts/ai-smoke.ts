import "dotenv/config";
import { generateAssistantReply } from "../src/ai/generate-reply";

/**
 * Smoke da IA isolada (sem banco): valida o provider + a chave de API.
 * Rodar: pnpm --filter @dentaltrack/api ai:smoke "sua mensagem aqui"
 * Requer LLM_PROVIDER + a chave (ex.: GOOGLE_GENERATIVE_AI_API_KEY).
 */
async function main(): Promise<void> {
  const message = process.argv.slice(2).join(" ") || "Olá! O que é um implante dentário?";
  console.log(`> ${message}`);
  const res = await generateAssistantReply([{ role: "user", content: message }]);
  console.log(`< ${res.text}`);
  console.log(`(provider: ${process.env.LLM_PROVIDER ?? "google"} · tokens: ${res.tokens ?? "?"})`);
}

main().catch((err) => {
  console.error("Falha no ai:smoke:", err);
  process.exit(1);
});
