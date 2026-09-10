import { Test } from '@nestjs/testing';
import { WhatsappConnectionService } from '../whatsapp/connection.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappJobs } from './whatsapp.jobs';

describe('WhatsappJobs (P0.4)', () => {
  let jobs: WhatsappJobs;
  const connectionsMock = {
    checkAllConnections: jest.fn(),
  };
  const whatsappMock = {
    cleanupInboundMessages: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    connectionsMock.checkAllConnections.mockResolvedValue({
      checked: 2,
      reconnectAttempts: 1,
    });
    whatsappMock.cleanupInboundMessages.mockResolvedValue(3);

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappJobs,
        {
          provide: WhatsappConnectionService,
          useValue: connectionsMock,
        },
        { provide: WhatsappService, useValue: whatsappMock },
      ],
    }).compile();
    jobs = moduleRef.get(WhatsappJobs);
  });

  it('verifica as conexões pelo servidor', async () => {
    await jobs.checkConnections();
    expect(connectionsMock.checkAllConnections).toHaveBeenCalledTimes(1);
  });

  it('limpa claims antigos do webhook', async () => {
    await jobs.cleanupInboundMessages();
    expect(whatsappMock.cleanupInboundMessages).toHaveBeenCalledTimes(1);
  });
});
