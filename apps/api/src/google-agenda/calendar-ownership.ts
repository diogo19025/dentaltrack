import { createHmac } from 'node:crypto';

/**
 * Prova de que a agenda do Google é da empresa que a configurou.
 *
 * Todas as empresas compartilham **a mesma service account**: é ela que lê e
 * grava as agendas. Sem prova de posse, qualquer conta recém-criada podia
 * informar o ID da agenda de outra empresa (costuma ser o gmail dela, que é
 * público) e a sincronização passava a importar os pacientes dessa outra
 * empresa, com nome e telefone. O compartilhamento com a service account não
 * prova nada, porque quem compartilhou foi a dona da agenda, não quem a
 * cadastrou aqui.
 *
 * A prova é um código por empresa colado na **descrição da agenda**, coisa que
 * só quem pode editar a agenda consegue fazer. O código é derivado da chave de
 * cifra das integrações (a mesma que já guarda a configuração do Google), então
 * não precisa de coluna nem de migration, e ninguém calcula o código de outra
 * empresa sem a chave do servidor.
 */
export function calendarVerificationCode(
  key: Buffer,
  clinicId: string,
): string {
  const digest = createHmac('sha256', key)
    .update(`google-calendar:${clinicId}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `DT-${digest.slice(0, 4)}-${digest.slice(4)}`;
}

/** A descrição da agenda contém o código? (sem diferenciar maiúsculas) */
export function descriptionHasCode(
  description: string | null | undefined,
  code: string,
): boolean {
  return (description ?? '').toUpperCase().includes(code.toUpperCase());
}

/**
 * O que o provedor precisa para exigir a prova de posse. O cache fica fora da
 * instância porque o provedor é recriado a cada `getProvider()`; sem ele, cada
 * consulta de horários custaria uma chamada a mais ao Google.
 */
export interface CalendarOwnership {
  /** Código desta empresa, que precisa estar na descrição da agenda. */
  code: string;
  /** A agenda foi verificada há pouco? */
  isFresh?: () => boolean;
  /** Registra uma verificação bem-sucedida. */
  markVerified?: () => void;
}

/** Mensagem para o dono quando a descrição não tem o código. */
export function ownershipMissingMessage(code: string): string {
  return `A agenda informada não tem o código de verificação desta empresa (${code}) na descrição. No Google Agenda, abra Configurações da agenda → Descrição, cole o código e verifique a conexão de novo.`;
}
