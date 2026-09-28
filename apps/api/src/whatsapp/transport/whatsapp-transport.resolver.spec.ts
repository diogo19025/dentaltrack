import type { EvolutionService } from '../evolution.service';
import { EvolutionTransport } from './evolution.transport';
import { WhatsappTransportResolver } from './whatsapp-transport.resolver';

function evolutionMock(configured = true) {
  return {
    isConfigured: jest.fn().mockReturnValue(configured),
    sendText: jest.fn().mockResolvedValue(undefined),
    sendMedia: jest.fn().mockResolvedValue(undefined),
    getMediaBase64: jest.fn(),
    resolveLidJid: jest.fn(),
  };
}

describe('WhatsappTransportResolver', () => {
  it('sem instância ou sem Evolution configurada, não há transporte', () => {
    const configured = new WhatsappTransportResolver(
      evolutionMock() as unknown as EvolutionService,
    );
    expect(configured.forSettings(null)).toBeNull();
    expect(configured.forSettings({ whatsappInstance: null })).toBeNull();

    const unconfigured = new WhatsappTransportResolver(
      evolutionMock(false) as unknown as EvolutionService,
    );
    expect(unconfigured.forSettings({ whatsappInstance: 'x' })).toBeNull();
  });

  it('com instância e Evolution configurada, devolve o transporte amarrado a ela', () => {
    const resolver = new WhatsappTransportResolver(
      evolutionMock() as unknown as EvolutionService,
    );
    const transport = resolver.forSettings({ whatsappInstance: 'empresa-1' });
    expect(transport).toBeInstanceOf(EvolutionTransport);
    expect((transport as EvolutionTransport).instance).toBe('empresa-1');
  });
});

describe('EvolutionTransport', () => {
  const PHONE = '5511999998888';
  const JID = `${PHONE}@s.whatsapp.net`;

  it('envio proativo: tenta o LID pelo telefone e cai no telefone sem ele', async () => {
    const evolution = evolutionMock();
    const transport = new EvolutionTransport(
      evolution as unknown as EvolutionService,
      'inst',
    );

    evolution.resolveLidJid.mockResolvedValueOnce('123@lid');
    await expect(transport.resolveAddress({ phone: PHONE })).resolves.toBe(
      '123@lid',
    );
    expect(evolution.resolveLidJid).toHaveBeenCalledWith('inst', JID);

    evolution.resolveLidJid.mockResolvedValueOnce(null);
    await expect(transport.resolveAddress({ phone: PHONE })).resolves.toBe(
      PHONE,
    );
  });

  it('resposta: só busca LID quando o webhook sinalizou addressingMode lid', async () => {
    const evolution = evolutionMock();
    const transport = new EvolutionTransport(
      evolution as unknown as EvolutionService,
      'inst',
    );

    await expect(
      transport.resolveAddress({
        phone: PHONE,
        inReplyTo: { remoteJid: JID, messageId: 'M1' },
      }),
    ).resolves.toBe(PHONE);
    expect(evolution.resolveLidJid).not.toHaveBeenCalled();

    evolution.resolveLidJid.mockResolvedValueOnce('123@lid');
    await expect(
      transport.resolveAddress({
        phone: PHONE,
        inReplyTo: { remoteJid: JID, messageId: 'M2', addressingMode: 'lid' },
      }),
    ).resolves.toBe('123@lid');
    expect(evolution.resolveLidJid).toHaveBeenCalledWith('inst', JID, 'M2');
  });

  it('delega envio à instância e usa o base64 do webhook antes de buscar', async () => {
    const evolution = evolutionMock();
    const transport = new EvolutionTransport(
      evolution as unknown as EvolutionService,
      'inst',
    );

    await transport.sendText(PHONE, 'oi');
    expect(evolution.sendText).toHaveBeenCalledWith('inst', PHONE, 'oi');

    await expect(
      transport.fetchInboundAudio({ base64: 'AAA', ref: { id: 'k' } }),
    ).resolves.toBe('AAA');
    expect(evolution.getMediaBase64).not.toHaveBeenCalled();

    evolution.getMediaBase64.mockResolvedValueOnce('BBB');
    await expect(
      transport.fetchInboundAudio({ ref: { id: 'k' } }),
    ).resolves.toBe('BBB');
    expect(evolution.getMediaBase64).toHaveBeenCalledWith('inst', { id: 'k' });
  });
});
