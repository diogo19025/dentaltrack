import { z } from "zod";
import { appointmentStatusSchema } from "./agenda";

/**
 * Integração de agenda da empresa — **Clinicorp** (F9) ou **Google Agenda**
 * (F12), a empresa escolhe um; só um fica ativo por vez.
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

export const INTEGRATION_PROVIDERS = ["clinicorp", "google"] as const;
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_PROVIDER_LABELS: Record<IntegrationProvider, string> =
  {
    clinicorp: "Clinicorp",
    google: "Google Agenda",
  };

/**
 * `mock` — dados sintéticos determinísticos (desenvolvimento, testes e demo);
 * `live` — API real. `desligado` mantém a empresa no comportamento pré-F9
 * (disponibilidade declarada em `/settings`).
 */
export const INTEGRATION_MODES = ["desligado", "mock", "live"] as const;
export const integrationModeSchema = z.enum(INTEGRATION_MODES);
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

/**
 * **Por que a agenda falhou** (P0.1). Até aqui toda falha de provedor era uma
 * string, e "a credencial foi recusada" chegava à tela indistinguível de "o
 * Google não respondeu" — sendo que uma exige o operador e a outra exige
 * esperar. A categoria é o que separa as duas.
 *
 * É também o que decide o que se pode repetir: só `indisponivel` e `timeout`
 * são transitórios. Repetir um `auth` só multiplica a recusa, e repetir uma
 * escrita é como se criam duplicatas — por isso o retry olha para o motivo,
 * nunca para o verbo HTTP sozinho.
 *
 * `desconhecido` é o default deliberado: uma falha nova nunca deve virar um
 * palpite errado com cara de diagnóstico.
 */
export const AGENDA_ERROR_KINDS = [
  "auth",
  "config",
  "indisponivel",
  "timeout",
  "resposta_invalida",
  "conflito",
  "desconhecido",
] as const;
export const agendaErrorKindSchema = z.enum(AGENDA_ERROR_KINDS);
export type AgendaErrorKind = (typeof AGENDA_ERROR_KINDS)[number];

/** Rótulo curto da causa — prefixa o erro guardado em `lastError`. */
export const AGENDA_ERROR_LABELS: Record<AgendaErrorKind, string> = {
  auth: "Credencial recusada",
  config: "Configuração não confere",
  indisponivel: "Agenda indisponível",
  timeout: "Agenda não respondeu a tempo",
  resposta_invalida: "Resposta ilegível da agenda",
  conflito: "Horário já ocupado",
  desconhecido: "Falha não identificada",
};

/**
 * O que o operador precisa fazer a respeito — escrito para quem está na tela
 * às 9h da manhã com a agenda parada, não para quem lê o log.
 */
export const AGENDA_ERROR_MESSAGES: Record<AgendaErrorKind, string> = {
  auth: "A credencial foi recusada. Confira o que está salvo aqui e, no caso do Google, se a agenda continua compartilhada com a conta de serviço.",
  config:
    "A conexão respondeu, mas o que foi configurado não existe do outro lado — o ID da agenda ou a unidade escolhida. Revise os campos acima.",
  indisponivel:
    "A agenda não está respondendo agora. É do lado do provedor: nada precisa ser corrigido aqui, tente de novo em alguns minutos.",
  timeout:
    "A agenda demorou demais para responder. Costuma ser instabilidade passageira — tente de novo.",
  resposta_invalida:
    "A agenda respondeu algo que não dá para interpretar. Se persistir, o suporte precisa do código abaixo.",
  conflito:
    "O horário deixou de estar livre entre a consulta e a gravação. Escolha outro horário.",
  desconhecido:
    "A agenda falhou por um motivo que não reconhecemos. O suporte precisa do código abaixo.",
};

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

/** "HH:MM" 24h — janela de trabalho do Google Agenda. */
const hhMmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM (ex.: 08:00).");

/**
 * Configuração do **Google Agenda** (F12) — o provedor alternativo ao
 * Clinicorp, para a empresa que não tem sistema de gestão integrado.
 *
 * O modelo de acesso é **service account**: o servidor tem uma conta de
 * serviço do Google (e-mail + chave, só em variáveis de ambiente) e a empresa
 * compartilha a agenda dela com esse e-mail — nenhum OAuth por empresa, nenhum
 * token que expira no meio de um cron. O que a empresa informa é só o **ID da
 * agenda** e a janela de trabalho (o Google não sabe o horário de atendimento;
 * é daqui que saem os horários livres oferecidos pelo agente).
 */
export const googleAgendaConfigSchema = z.object({
  /** ID da agenda (ex.: "clinica@gmail.com" ou "...@group.calendar.google.com"). */
  calendarId: z.string().trim().min(1, "Informe o ID da agenda."),
  /** Início do expediente ("08:00"). */
  workStart: hhMmSchema.default("08:00"),
  /** Fim do expediente ("18:00") — último horário começa antes disso. */
  workEnd: hhMmSchema.default("18:00"),
  /** Dias de atendimento (0 = domingo … 6 = sábado). */
  workDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Escolha ao menos um dia de atendimento.")
    .max(7)
    .default([1, 2, 3, 4, 5]),
  /** Grade dos horários oferecidos, em minutos. */
  slotMinutes: z.number().int().min(10).max(240).default(30),
});
export type GoogleAgendaConfig = z.infer<typeof googleAgendaConfigSchema>;

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

/** PUT /integrations/:provider — configuração completa. */
export const updateIntegrationSchema = z
  .object({
    mode: integrationModeSchema,
    /** Omitido = mantém as credenciais já salvas (só Clinicorp). */
    credentials: clinicorpCredentialsSchema.nullish(),
    /** Configuração do Google Agenda (só provider google). */
    google: googleAgendaConfigSchema.nullish(),
    /** Unidade usada nas consultas de agenda. */
    unitId: z.string().trim().min(1).nullable(),
    /** Profissional padrão ao agendar (vazio = qualquer um). */
    professionalId: z.string().trim().min(1).nullable(),
    statusMappings: z.array(statusMappingSchema).max(200),
  })
  .partial()
  .strict();
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;

/** GET /integrations/:provider — estado atual, sem segredo algum. */
export const integrationStatusSchema = z.object({
  provider: integrationProviderSchema,
  mode: integrationModeSchema,
  /**
   * Provedor com modo ≠ desligado nesta empresa, se houver. Só **um** pode
   * estar ativo por vez — duas agendas simultâneas seriam duas fontes de
   * verdade em conflito (horário livre numa, ocupado na outra).
   */
  activeProvider: integrationProviderSchema.nullable(),
  /** Configuração do Google Agenda (não é segredo; null nos demais). */
  google: googleAgendaConfigSchema.nullable(),
  /**
   * E-mail da service account com quem a empresa compartilha a agenda —
   * exibido na tela para o passo "compartilhar". Null = servidor sem a
   * credencial do Google configurada.
   */
  serviceAccountEmail: z.string().nullable(),
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
  /**
   * Categoria da falha (P0.1) — `null` quando o passo passou. É o que permite à
   * tela dizer o que fazer a respeito em vez de repetir a mensagem técnica.
   */
  kind: agendaErrorKindSchema.nullable().default(null),
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
  /**
   * Id de correlação desta verificação (P0.3) — é o que a tela mostra como
   * "código para o suporte". Sem ele, uma falha vira "deu erro" e o log do
   * servidor não tem por onde ser procurado.
   */
  requestId: z.string().nullable().default(null),
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
