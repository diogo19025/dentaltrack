import { randomBytes } from 'node:crypto';
import {
  MissingEncryptionKeyError,
  decryptSecret,
  encryptSecret,
  loadEncryptionKey,
  maskUsername,
} from './credentials-crypto';

describe('credentials-crypto (credenciais da integração · F9)', () => {
  const key = randomBytes(32);

  describe('loadEncryptionKey', () => {
    it('aceita 64 hex e 44 base64', () => {
      expect(loadEncryptionKey(key.toString('hex'))).toEqual(key);
      expect(loadEncryptionKey(key.toString('base64'))).toEqual(key);
    });

    it('falha fechado quando a chave não existe', () => {
      // Sem chave, a alternativa seria gravar segredo em texto puro — que dá
      // acesso à agenda e ao prontuário de pacientes reais.
      expect(() => loadEncryptionKey(undefined)).toThrow(
        MissingEncryptionKeyError,
      );
      expect(() => loadEncryptionKey('   ')).toThrow(MissingEncryptionKeyError);
    });

    it('recusa chave de tamanho errado', () => {
      expect(() => loadEncryptionKey('abc123')).toThrow(/32 bytes/);
    });
  });

  it('cifra e decifra de volta ao original', () => {
    const secret = JSON.stringify({ username: 'api-user', token: 's3cr3t' });
    const encrypted = encryptSecret(secret, key);

    expect(encrypted).not.toContain('s3cr3t');
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(decryptSecret(encrypted, key)).toBe(secret);
  });

  it('cada cifragem usa um IV novo (mesma entrada, saídas diferentes)', () => {
    const a = encryptSecret('mesmo texto', key);
    const b = encryptSecret('mesmo texto', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe(decryptSecret(b, key));
  });

  it('texto cifrado adulterado falha em vez de decifrar em lixo', () => {
    const encrypted = encryptSecret('token real', key);
    const [version, iv, tag, data] = encrypted.split('.');
    const tampered = [
      version,
      iv,
      tag,
      Buffer.from('outro').toString('base64'),
    ].join('.');

    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(data, key)).toThrow(/formato desconhecido/);
  });

  it('chave errada não decifra', () => {
    const encrypted = encryptSecret('token real', key);
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow();
  });

  it('maskUsername ajuda a reconhecer sem revelar', () => {
    expect(maskUsername('api-clinicorp')).toBe('ap******rp');
    expect(maskUsername('abc')).toBe('***');
    expect(maskUsername('api-clinicorp')).not.toContain('clinicorp');
  });
});
