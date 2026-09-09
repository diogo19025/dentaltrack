import { maskEmail, maskPhone, redact, redactText } from './redact';

describe('redact', () => {
  describe('maskPhone', () => {
    it('preserva DDI+DDD e os quatro últimos dígitos', () => {
      expect(maskPhone('5511987654321')).toBe('5511*****4321');
    });

    it('aceita telefone formatado', () => {
      expect(maskPhone('+55 (11) 98765-4321')).toBe('5511*****4321');
    });

    it('mascara por inteiro o que é curto demais para ser telefone', () => {
      expect(maskPhone('1234')).toBe('****');
    });
  });

  it('mascara o usuário do e-mail e preserva o domínio', () => {
    expect(maskEmail('ana.silva@clinica.com.br')).toBe('an***@clinica.com.br');
  });

  describe('redactText', () => {
    // O caso que motiva tudo: o log de erro do WhatsApp interpola o telefone.
    it('redige telefone interpolado numa mensagem de log', () => {
      expect(
        redactText('Falha ao enviar mensagem ao 5511987654321: timeout'),
      ).toBe('Falha ao enviar mensagem ao 5511*****4321: timeout');
    });

    it('redige e-mail sem confundir a parte numérica com telefone', () => {
      expect(redactText('lead 5599887766554@exemplo.com capturado')).toBe(
        'lead 55***@exemplo.com capturado',
      );
    });

    it('não toca em id de conversa nem em número curto', () => {
      const msg =
        'Conversa 8f14e45f-ceea-467a-9b8a-1e2f3d4c5b6a com 3 mensagens';
      expect(redactText(msg)).toBe(msg);
    });
  });

  describe('redact', () => {
    it('percorre objetos e arrays', () => {
      expect(redact({ contatos: ['5511987654321'], total: 1 })).toEqual({
        contatos: ['5511*****4321'],
        total: 1,
      });
    });

    it('mascara segredo pelo nome da chave, qualquer que seja o valor', () => {
      expect(redact({ token: 'abc', apikey: 'xyz', nome: 'Ana' })).toEqual({
        token: '[redigido]',
        apikey: '[redigido]',
        nome: 'Ana',
      });
    });

    it('para na profundidade máxima sem estourar em objeto circular', () => {
      const node: Record<string, unknown> = { nome: 'raiz' };
      node.self = node;
      expect(() => redact(node)).not.toThrow();
    });
  });
});
