import type { ConfigService } from '@nestjs/config';
import {
  encryptSecret,
  loadEncryptionKey,
} from '../../clinicorp/credentials-crypto';
import type { Env } from '../../config/env.validation';
import type { EvolutionService } from '../evolution.service';
import { EvolutionTransport } from './evolution.transport';
import { MetaTransport } from './meta.transport';
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

const KEY = '0'.repeat(64);

function configMock(env: Record<string, string | undefined> = {}) {
  return {
    get: (key: string) => ({ INTEGRATION_ENCRYPTION_KEY: KEY, ...env })[key],
  } as unknown as ConfigService<Env, true>;
}

describe('WhatsappTransportResolver', () => {
  it('provedor meta: transporte amarrado ao número, com o token decifrado', () => {
    const resolver = new WhatsappTransportResolver(
      evolutionMock(false) as unknown as EvolutionService,
      configMock(),
    );
    const transport = resolver.forSettings({
      whatsappInstance: null,
      whatsappProvider: 'meta',
      metaPhoneNumberId: '1055',
      metaAccessTokenEnc: encryptSecret(
        'EAAtokenlongodemais1234567890',
        loadEncryptionKey(KEY),
      ),
    });
    expect(transport).toBeInstanceOf(MetaTransport);
    expect((transport as MetaTransport).phoneNumberId).toBe('1055');
  });

  it('provedor meta sem credencial ou com token ilegível: sem transporte, e não cai na Evolution', () => {
    const resolver = new WhatsappTransportResolver(
      evolutionMock() as unknown as EvolutionService,
      configMock(),
    );
    expect(
      resolver.forSettings({
        whatsappInstance: 'empresa-1',
        whatsappProvider: 'meta',
        metaPhoneNumberId: null,
        metaAccessTokenEnc: null,
      }),
    ).toBeNull();
    expect(
      resolver.forSettings({
        whatsappInstance: 'empresa-1',
        whatsappProvider: 'meta',
        metaPhoneNumberId: '1055',
        metaAccessTokenEnc: 'v1.lixo.lixo.lixo',
      }),
    ).toBeNull();
  });

  it('sem instância ou sem Evolution configurada, não há transporte', () => {
    const configured = new WhatsappTransportResolver(
      evolutionMock() as unknown as EvolutionService,
      configMock(),
    );
    expect(configured.forSettings(null)).toBeNull();
    expect(configured.forSettings({ whatsappInstance: null })).toBeNull();

    const unconfigured = new WhatsappTransportResolver(
      evolutionMock(false) as unknown as EvolutionService,
      configMock(),
    );
    expect(unconfigured.forSettings({ whatsappInstance: 'x' })).toBeNull();
  });

  it('com instância e Evolution configurada, devolve o transporte amarrado a ela', () => {
    const resolver = new WhatsappTransportResolver(
      evolutionMock() as unknown as EvolutionService,
      configMock(),
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
