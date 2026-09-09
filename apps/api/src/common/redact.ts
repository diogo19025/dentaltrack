/**
 * Redação de dado pessoal em log (P0.3 / P1.5).
 *
 * A regra do produto é simples e vale para todo o backend:
 *
 * - **telefone e e-mail** são mascarados automaticamente aqui, porque eles
 *   aparecem interpolados em dezenas de mensagens de log já escritas e reescrever
 *   todas seria mais arriscado do que filtrar na saída;
 * - **conteúdo de mensagem do paciente nunca é logado**, em nenhuma hipótese.
 *   Isso não tem como ser garantido por regex — é regra de quem escreve o log.
 *
 * O mascaramento roda no `StructuredLogger`, então qualquer `this.logger.*` do
 * projeto já sai redigido sem que o serviço precise saber disso.
 */

/**
 * Sequência de 10 a 15 dígitos — a faixa de um telefone com DDD, com ou sem DDI.
 * Pega o telefone já normalizado (`5511987654321`), que é a forma que circula
 * no código; números formatados são cobertos pelo mascaramento por partes.
 */
const PHONE_RE = /\b\d{10,15}\b/g;

const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;

/**
 * `5511987654321` → `5511*****4321`. Preserva DDI+DDD e os quatro últimos
 * dígitos: o suficiente para reconhecer o contato numa investigação sem que o
 * log carregue um número discável.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '*'.repeat(digits.length);
  const middle = digits.length - 8;
  return `${digits.slice(0, 4)}${'*'.repeat(middle)}${digits.slice(-4)}`;
}

/** `ana.silva@clinica.com` → `an***@clinica.com`. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const head = user.slice(0, 2);
  return `${head}***@${domain}`;
}

/**
 * Redige uma string de log. A ordem importa: e-mail primeiro, senão a parte
 * numérica de um e-mail com dígitos seria mascarada como telefone.
 *
 * Efeito colateral aceito: um inteiro de 10–15 dígitos que não seja telefone
 * (um timestamp em ms, por exemplo) também é mascarado. Preferimos o falso
 * positivo — um log menos legível — ao falso negativo, que é um vazamento.
 */
export function redactText(text: string): string {
  return text.replace(EMAIL_RE, maskEmail).replace(PHONE_RE, maskPhone);
}

/**
 * Redige recursivamente qualquer valor que vá para o log (string, objeto, array).
 * Chaves reconhecidamente sensíveis são mascaradas pelo nome, mesmo que o valor
 * não case com os padrões acima — é o caso de `token`, `apikey` e afins, onde
 * revelar qualquer parte já é demais.
 */
const SECRET_KEYS =
  /^(authorization|apikey|api_key|token|secret|password|senha|credentials)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? '[redigido]' : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}
