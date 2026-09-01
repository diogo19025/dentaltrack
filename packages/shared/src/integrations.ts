import { z } from "zod";
import { appointmentStatusSchema } from "./agenda";

/**
 * Integração com o sistema de gestão da empresa (F9) — hoje só **Clinicorp**.
 *
 * O desenho antecipa um problema conhecido: o contrato real da API externa só
 * pode ser conferido com a credencial do cliente em mãos, e ela costuma demorar.
 * Por isso a integração roda em dois modos (`mock` | `live`) — o mesmo padrão do
 * `LLM_PROVIDER=mock` que já usamos no motor de IA. Contra o mock dá para
 * construir e testar **todas** as automações sem nenhuma credencial; no dia em
 * que ela chegar, muda-se o modo.
 *
 * Regras de segurança do contrato:
 * - **segredo nunca volta do servidor** (`GET` devolve só `hasCredentials`);
 * - nenhum identificador externo é fixo no código: unidade, profissional e —
 *   principalmente — os **IDs de status** são descobertos em tempo de execução
 *   e mapeados pelo operador, porque cada conta nomeia os seus.
 */

export const INTEGRATION_PROVIDERS = ["clinicorp"] as const;
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/**
 * `mock` — dados sintéticos determinísticos (desenvolvimento, testes e demo);
 * `live` — API real. `desligado` mantém a empresa no comportamento pré-F9
 * (disponibilidade declarada em `/settings`).
 */
export const INTEGRATION_MODES = ["desligado", "mock", "live"] as const;
export const integrationModeSchema = z.enum(INTEGRATION_MODES);
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

/** Credenciais da API (write-only — nunca retornam em nenhum GET). */
export const clinicorpCredentialsSchema = z.object({
  /** Usuário da API (HTTP Basic) — não é o login do painel web. */
  username: z.string().trim().min(1, "Informe o usuário da API."),
  /** Token da API (HTTP Basic). */
  token: z.string().trim().min(1, "Informe o token da API."),
  /**
   * Contexto de conta exigido pela maior parte das rotas. Não é o id da
   * unidade, do paciente nem o link público de agendamento.
   */
  subscriberId: z.string().trim().min(1).nullable(),
  /** Sobrescreve a base da API (homologação). Vazio = produção. */
  baseUrl: z.string().url("Informe uma URL válida.").nullable(),
});
export type ClinicorpCredentials = z.infer<typeof clinicorpCredentialsSchema>;

/** Unidade/consultório descoberto na conta externa. */
export const externalUnitSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type ExternalUnit = z.infer<typeof externalUnitSchema>;

/** Profissional descoberto na conta externa. */
export const externalProfessionalSchema = z.object({
  id: z.string(),
  name: z.string(),
  unitId: z.string().nullable(),
});
export type ExternalProfessional = z.infer<typeof externalProfessionalSchema>;

/** Status de agendamento como o sistema externo o nomeia. */
export const externalStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type ExternalStatus = z.infer<typeof externalStatusSchema>;

/**
 * Uma linha do mapeamento `status externo → status daqui`. `status: null`
 * significa "ignorar": o status existe na conta, mas não muda nada para as
 * automações (ex.: "orçamento enviado").
 */
export const statusMappingSchema = z.object({
  externalId: z.string().min(1),
  externalName: z.string(),
  status: appointmentStatusSchema.nullable(),
});
export type StatusMapping = z.infer<typeof statusMappingSchema>;

/**
 * Os três status sem os quais metade das automações não funciona. A tela avisa
 * quando algum deles ficou sem mapeamento em vez de falhar silenciosamente:
 * sem `compareceu` não há retorno de manutenção, sem `faltou` não há remarcação
 * e sem `confirmado`/`compareceu` o aviso de atraso dispara para quem já chegou.
 */
export const REQUIRED_STATUS_MAPPINGS = [
  "compareceu",
  "faltou",
  "cancelado",
] as const;

/** PUT /integrations/clinicorp — configuração completa. */
export const updateIntegrationSchema = z
  .object({
    mode: integrationModeSchema,
    /** Omitido = mantém as credenciais já salvas. */
    credentials: clinicorpCredentialsSchema.nullish(),
    /** Unidade usada nas consultas de agenda. */
    unitId: z.string().trim().min(1).nullable(),
    /** Profissional padrão ao agendar (vazio = qualquer um). */
    professionalId: z.string().trim().min(1).nullable(),
    statusMappings: z.array(statusMappingSchema).max(200),
  })
  .partial()
  .strict();
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;

/** GET /integrations/clinicorp — estado atual, sem segredo algum. */
export const integrationStatusSchema = z.object({
  provider: integrationProviderSchema,
  mode: integrationModeSchema,
  /** Há credenciais salvas? (o valor em si nunca sai do servidor) */
  hasCredentials: z.boolean(),
  /** Usuário da API mascarado (ex.: "api***rp") — só para reconhecimento. */
  usernameHint: z.string().nullable(),
  unitId: z.string().nullable(),
  professionalId: z.string().nullable(),
  statusMappings: z.array(statusMappingSchema),
  /** Última verificação de conexão bem-sucedida (ISO 8601). */
  lastCheckedAt: z.string().nullable(),
  /** Última sincronização de agenda concluída (ISO 8601). */
  lastSyncedAt: z.string().nullable(),
  /** Mensagem do último erro, para diagnóstico na tela. */
  lastError: z.string().nullable(),
});
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

/**
 * Um passo da verificação de conexão. A verificação é a tradução em tela do
 * `clinicorp:smoke`: roda a cadeia **só-leitura** e mostra, passo a passo, o que
 * respondeu e o que divergiu — é assim que se descobre a verdade sobre a API em
 * cinco minutos em vez de depurando em produção.
 */
export const connectionStepSchema = z.object({
  /** Identificador estável do passo (ex.: "unidades"). */
  key: z.string(),
  label: z.string(),
  ok: z.boolean(),
  /** Resumo do que voltou ("3 unidades") ou do erro. */
  detail: z.string(),
  /** Duração da chamada em ms (ajuda a flagrar rota lenta). */
  durationMs: z.number().int().nonnegative(),
});
export type ConnectionStep = z.infer<typeof connectionStepSchema>;

/** POST /integrations/clinicorp/check — resultado da verificação. */
export const connectionCheckSchema = z.object({
  ok: z.boolean(),
  mode: integrationModeSchema,
  checkedAt: z.string(),
  steps: z.array(connectionStepSchema),
  /** Descobertas do wizard, para o operador escolher unidade/profissional. */
  units: z.array(externalUnitSchema),
  professionals: z.array(externalProfessionalSchema),
  statuses: z.array(externalStatusSchema),
  /**
   * Mapeamento pré-preenchido para o operador **confirmar** — nunca aplicado
   * sozinho. Preserva o que ele já decidiu (inclusive a decisão de ignorar) e
   * deixa em branco o que a heurística não reconheceu.
   */
  suggestedMappings: z.array(statusMappingSchema),
});
export type ConnectionCheck = z.infer<typeof connectionCheckSchema>;
