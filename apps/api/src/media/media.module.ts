import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaStorageService } from './media-storage.service';

/**
 * Envio de arquivos (F13) — logo da empresa e mídia de saudação/oferta.
 *
 * O serviço é exportado porque a URL que ele devolve é gravada por outros
 * módulos (settings, procedures) e um dia a limpeza de arquivo órfão vai
 * precisar dele.
 */
@Module({
  controllers: [MediaController],
  providers: [MediaStorageService],
  exports: [MediaStorageService],
})
export class MediaModule {}
