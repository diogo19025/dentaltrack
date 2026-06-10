/**
 * Usuário e2e dedicado (QA-4.2). Vive no Supabase real do projeto, com clínica
 * própria criada pelo onboarding no 1º login — os dados de teste ficam isolados
 * da clínica demo. Criado/garantido pelo `global-setup.ts`. (Domínio gmail.com
 * porque o Supabase bloqueia signup com domínios de teste como example.com.)
 */
export const E2E_EMAIL = "dentaltrack.e2e.tests@gmail.com";
export const E2E_PASSWORD = "Dentaltrack!E2E-2026";
export const E2E_CLINIC_NAME = "Clínica E2E";

/** Sessão autenticada salva pelo auth.setup e reusada pelos specs. */
export const AUTH_FILE = "e2e/.auth/user.json";
