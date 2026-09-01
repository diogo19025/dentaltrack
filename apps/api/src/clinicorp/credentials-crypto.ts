import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra das credenciais de integração (F9) — AES-256-GCM.
 *
 * As credenciais ficam no banco porque são **por empresa**: é isso que permite
 * ligar a segunda clínica sem deploy. Mas credencial de API dá acesso ao
 * prontuário e à agenda de pacientes reais — dado sensível de saúde sob a LGPD.
 * Guardá-la em texto puro transformaria um vazamento de leitura do banco em
 * acesso direto ao sistema de gestão do cliente.
 *
 * GCM (e não CBC) porque autentica: texto cifrado adulterado falha em vez de
 * decifrar em lixo silencioso. IV aleatório por operação, e o formato guardado
 * é `v1.<iv>.<tag>.<cifra>` — versionado para permitir trocar o algoritmo
 * depois sem adivinhar o que cada linha antiga é.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      'INTEGRATION_ENCRYPTION_KEY não configurada — sem ela as credenciais da integração não podem ser guardadas com segurança.',
    );
    this.name = 'MissingEncryptionKeyError';
  }
}

/**
 * Lê a chave do ambiente. Aceita 64 caracteres hex ou 44 base64 (32 bytes).
 * Ausente ou com tamanho errado é erro — falhar fechado é o comportamento certo
 * quando a alternativa é gravar segredo em texto puro.
 */
export function loadEncryptionKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) throw new MissingEncryptionKeyError();

  const key = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY inválida: são esperados 32 bytes (64 caracteres hex ou 44 em base64).',
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('Credencial cifrada em formato desconhecido.');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Versão curta e não reversível do usuário, só para o dono reconhecer qual
 * credencial está salva ("ainda é a antiga?"). Nunca revela o token.
 */
export function maskUsername(username: string): string {
  const value = username.trim();
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 6))}${value.slice(-2)}`;
}
