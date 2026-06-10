import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { E2E_CLINIC_NAME, E2E_EMAIL, E2E_PASSWORD } from "./credentials";

/**
 * Garante o usuário e2e no Supabase (idempotente), sem env extra:
 * 1. Com `SUPABASE_SERVICE_ROLE_KEY` (apps/api/.env): cria/confirma via admin
 *    API — caminho 100% automático.
 * 2. Sem a service key: tenta o login com as credenciais e2e (anon key do
 *    apps/web/.env.local). Se o login funciona, segue; senão, falha com as
 *    instruções de desbloqueio (o projeto exige confirmação de e-mail).
 */

/** Parser mínimo de .env (KEY=VALUE) — o dotenv não injeta no contexto transpilado do Playwright. */
function readEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

const UNBLOCK_HELP = [
  `E2E: o usuário de teste (${E2E_EMAIL}) ainda não consegue autenticar — o projeto Supabase exige confirmação de e-mail.`,
  "Desbloqueie de UMA das formas (uma vez só):",
  "  a) Preencha SUPABASE_SERVICE_ROLE_KEY em apps/api/.env (Dashboard → Project Settings → API) — o setup cria/confirma o usuário sozinho; ou",
  `  b) No Dashboard → Authentication → Users, confirme o e-mail do usuário ${E2E_EMAIL} (criado pelos testes); ou`,
  "  c) Desative 'Confirm email' em Authentication → Sign In/Up (muda o fluxo real de signup).",
].join("\n");

export default async function globalSetup(): Promise<void> {
  // O cwd do `pnpm e2e` é apps/web (o __dirname do Playwright aponta p/ cache).
  const apiEnv = readEnvFile(path.resolve(process.cwd(), "../api/.env"));
  const webEnv = readEnvFile(path.resolve(process.cwd(), ".env.local"));

  const url = apiEnv.SUPABASE_URL || webEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = webEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRole = apiEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "E2E: SUPABASE_URL (apps/api/.env) e NEXT_PUBLIC_SUPABASE_ANON_KEY (apps/web/.env.local) são necessários.",
    );
  }

  // Caminho 1 — service key disponível: cria + confirma via admin (idempotente).
  if (serviceRole) {
    const admin = createClient(url, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.auth.admin.createUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      email_confirm: true,
      user_metadata: { clinic_name: E2E_CLINIC_NAME },
    });
    const alreadyExists =
      error && (error.code === "email_exists" || /already|registered/i.test(error.message));
    if (error && !alreadyExists) {
      throw new Error(`E2E: falha ao criar o usuário de teste via admin — ${error.message}`);
    }
    if (!alreadyExists) return; // criado agora, já confirmado.
    // Já existia (ex.: criado sem confirmação numa rodada anterior) → confirma.
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = data?.users.find((u) => u.email === E2E_EMAIL);
    if (user && !user.email_confirmed_at) {
      await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
    }
    return;
  }

  // Caminho 2 — sem service key: o usuário precisa existir e estar confirmado.
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await anon.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD });
  if (signIn.data.session) {
    await anon.auth.signOut();
    return;
  }
  // Garante que o usuário ao menos exista (1ª rodada) antes de pedir a confirmação.
  await anon.auth.signUp({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
    options: { data: { clinic_name: E2E_CLINIC_NAME } },
  });
  throw new Error(UNBLOCK_HELP);
}
