import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MEDIA_MAX_BYTES,
  type MediaUploadResult,
  mediaPurposeSchema,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { MediaStorageService } from './media-storage.service';

/** Teto do transporte: o maior limite de finalidade que existe. */
const TRANSPORT_LIMIT = Math.max(...Object.values(MEDIA_MAX_BYTES));

/**
 * `POST /media/upload?purpose=logo|oferta` — recebe o arquivo (multipart, campo
 * `file`) e devolve a URL pública.
 *
 * Só o dono envia: mídia da oferta e logo são identidade da empresa, e o
 * `RolesGuard` já é a fronteira das demais superfícies administrativas (PR 8).
 * O `TenantGuard` resolve o `clinicId` do JWT, então o caminho do arquivo no
 * storage nunca vem do cliente.
 *
 * O limite do multer é o **maior** dos limites por finalidade — o teto exato
 * (1 MB na logo) fica no serviço, que sabe a finalidade e consegue explicar o
 * que aconteceu. Deixar o transporte cortar em 1 MB devolveria um erro genérico
 * de rede no lugar de "sua logo tem 3,2 MB".
 */
@Controller('media')
@UseGuards(TenantGuard, RolesGuard)
export class MediaController {
  constructor(private readonly storage: MediaStorageService) {}

  @Post('upload')
  @Roles('owner')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: TRANSPORT_LIMIT } }),
  )
  upload(
    @ClinicId() clinicId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('purpose') purpose?: string,
  ): Promise<MediaUploadResult> {
    if (!file?.buffer) {
      throw new BadRequestException(
        'Nenhum arquivo recebido — envie o arquivo no campo "file".',
      );
    }

    const parsed = mediaPurposeSchema.safeParse(purpose ?? 'oferta');
    if (!parsed.success) {
      throw new BadRequestException(
        'Finalidade inválida — use "logo" ou "oferta".',
      );
    }

    return this.storage.upload({
      clinicId,
      purpose: parsed.data,
      originalName: file.originalname,
      mimetype: file.mimetype,
      buffer: file.buffer,
    });
  }
}
