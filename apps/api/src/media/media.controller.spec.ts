import type { MediaUploadResult } from '@dentaltrack/shared';
import { MediaController } from './media.controller';
import type { MediaStorageService } from './media-storage.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';

function file(over: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    originalname: 'promo.png',
    mimetype: 'image/png',
    buffer: Buffer.alloc(16, 1),
    ...over,
  } as Express.Multer.File;
}

describe('MediaController (POST /media/upload · F13)', () => {
  const result: MediaUploadResult = {
    url: 'https://projeto.supabase.co/storage/v1/object/public/media/x.png',
    type: 'image',
    fileName: 'promo.png',
    bytes: 16,
  };

  function setup() {
    // Objeto simples, não `jest.Mocked<MediaStorageService>`: tipar o dublê
    // como a classe faz o `unbound-method` reclamar de cada
    // `expect(storage.upload)` — um aviso correto para código de produção e
    // ruído para uma asserção de teste.
    const storage = { upload: jest.fn().mockResolvedValue(result) };
    const controller = new MediaController(
      storage as unknown as MediaStorageService,
    );
    return { storage, controller };
  }

  // As recusas de entrada são lançadas **antes** de qualquer await: o teste
  // precisa esperar uma exceção síncrona, não uma promise rejeitada.
  it('sem arquivo, diz qual campo faltou em vez de estourar', () => {
    const { controller } = setup();

    expect(() => controller.upload(CLINIC, undefined, 'logo')).toThrow(
      /campo "file"/,
    );
  });

  it('finalidade ausente cai em "oferta" — o caso mais comum', async () => {
    const { controller, storage } = setup();

    await controller.upload(CLINIC, file(), undefined);

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'oferta', clinicId: CLINIC }),
    );
  });

  it('finalidade inventada é recusada, não tratada como padrão', () => {
    const { controller, storage } = setup();

    expect(() => controller.upload(CLINIC, file(), 'qualquer')).toThrow(
      /Finalidade inválida/,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('o clinicId vem do guard, nunca do corpo da requisição', async () => {
    const { controller, storage } = setup();

    await controller.upload(CLINIC, file(), 'logo');

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC, purpose: 'logo' }),
    );
  });
});
