import fs from "node:fs";
import path from "node:path";

/** Parser mínimo de .env (KEY=VALUE) — o dotenv não injeta no contexto transpilado do Playwright. */
export function readEnvFile(filePath: string): Record<string, string> {
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

// O cwd do `pnpm e2e` é apps/web (o __dirname do Playwright aponta p/ cache).
const webEnv = readEnvFile(path.resolve(process.cwd(), ".env.local"));

function fromEnv(key: string): string | undefined {
  return process.env[key]?.trim() || webEnv[key]?.trim() || undefined;
}

/**
 * Usuário e2e dedicado (QA-4.2). Vive no Supabase real do projeto, com clínica
 * própria criada pelo onboarding no 1º login — os dados de teste ficam isolados
 * da clínica demo. Criado/garantido pelo `global-setup.ts`. (Domínio gmail.com
 * porque o Supabase bloqueia signup com domínios de teste como example.com.)
 *
 * **A senha não mora no repositório.** Ela é de uma conta real no Supabase
 * compartilhado com a produção, e o repositório é público. Vem de `E2E_PASSWORD`
 * no ambiente (CI) ou em `apps/web/.env.local`.
 */
export const E2E_EMAIL = fromEnv("E2E_EMAIL") ?? "dentaltrack.e2e.tests@gmail.com";

const password = fromEnv("E2E_PASSWORD");
if (!password) {
  throw new Error(
    "E2E: defina E2E_PASSWORD (senha do usuário de teste) no ambiente ou em apps/web/.env.local. " +
      "Ela não fica no repositório; com a SUPABASE_SERVICE_ROLE_KEY em apps/api/.env o setup cria o usuário com a senha informada.",
  );
}
export const E2E_PASSWORD: string = password;

export const E2E_CLINIC_NAME = "Clínica E2E";

/** Sessão autenticada salva pelo auth.setup e reusada pelos specs. */
export const AUTH_FILE = "e2e/.auth/user.json";
