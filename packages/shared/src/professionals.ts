import { z } from "zod";

/**
 * Profissionais da empresa (F20) — o espelho local de quem atende.
 *
 * Existe porque a agenda do sistema de gestão é **por profissional** e a conta
 * real tem dez, enquanto o produto só conhecia o profissional padrão único da
 * integração. Sem uma tabela por trás, o nome do profissional era texto solto
 * gravado pela sincronização: não dava para filtrar a agenda por ele, nem
 * colorir, nem deixar o cliente escolher.
 */

/**
 * O que o agente faz quando a empresa tem vários profissionais e o cliente
 * **não** pediu nenhum.
 *
 * - `primeiro_livre`: oferece os primeiros horários livres, sempre dizendo com
 *   quem cada um é. Menos atrito, e o cliente ainda pode recusar.
 * - `perguntar`: pergunta a preferência antes de oferecer horário. Respeita
 *   quem já tem profissional de confiança, ao custo de um turno de conversa.
 *
 * É configuração e não regra fixa porque a escolha muda o tom do atendimento.
 * Só vale quando não há profissional padrão configurado e há mais de um ativo.
 */
export const PROFESSIONAL_POLICIES = ["primeiro_livre", "perguntar"] as const;
export const professionalPolicySchema = z.enum(PROFESSIONAL_POLICIES);
export type ProfessionalPolicy = z.infer<typeof professionalPolicySchema>;

export const DEFAULT_PROFESSIONAL_POLICY: ProfessionalPolicy = "primeiro_livre";

/** GET /professionals — um profissional da empresa. */
export const professionalSchema = z.object({
  id: z.string(),
  /**
   * Id no sistema de gestão. Vazio = cadastrado à mão (empresa sem integração
   * também tem equipe). É por ele que a sincronização reconhece a linha.
   */
  externalId: z.string(),
  name: z.string(),
  /**
   * Inativo continua existindo: quem some da conta do cliente é desativado, e
   * nunca apagado, porque os agendamentos passados apontam para ele.
   */
  active: z.boolean(),
  unitExternalId: z.string(),
  /**
   * Ordem de entrada (ISO 8601). A tela deriva dela a cor do profissional, que
   * por isso não muda quando alguém entra ou sai da equipe.
   */
  createdAt: z.string(),
});
export type ProfessionalDto = z.infer<typeof professionalSchema>;

export const professionalsResponseSchema = z.object({
  professionals: z.array(professionalSchema),
});
export type ProfessionalsResponse = z.infer<
  typeof professionalsResponseSchema
>;

/** POST /professionals — cadastro manual (owner). */
export const createProfessionalSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do profissional.").max(120),
});
export type CreateProfessionalInput = z.infer<typeof createProfessionalSchema>;

/**
 * PATCH /professionals/:id — o que o dono pode mudar.
 *
 * `externalId` não entra: ele é a identidade da linha perante o provedor, e
 * deixá-lo editável quebraria a sincronização em silêncio.
 */
export const updateProfessionalSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    active: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateProfessionalInput = z.infer<typeof updateProfessionalSchema>;
