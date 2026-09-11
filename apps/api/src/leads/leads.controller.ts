import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  leadExportFormatSchema,
  type LeadDetail,
  type LeadImportResult,
  type LeadsResponse,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LeadsService } from './leads.service';
import { LeadsExportService } from './leads-export.service';
import { LeadsImportService } from './leads-import.service';

/**
 * GET /leads (F3 · FE-3.6) — leads capturados + resumo. `GET /leads/:id` →
 * detalhe expandido (conversas + agendamentos) p/ o painel do dashboard.
 * F8: `GET /leads/export?format=csv|xlsx|pdf` (download) e `POST /leads/import`
 * (planilha .xlsx/.csv, multipart campo `file`). Rotas literais declaradas
 * antes de `:id` para não colidirem com o ParseUUIDPipe.
 * Protegido pelo SupabaseJwtGuard (global) + TenantGuard (resolve o `clinicId`).
 */
@Controller('leads')
@UseGuards(TenantGuard, RolesGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly exporter: LeadsExportService,
    private readonly importer: LeadsImportService,
  ) {}

  @Get()
  list(@ClinicId() clinicId: string): Promise<LeadsResponse> {
    return this.leads.list(clinicId);
  }

  @Get('export')
  async export(
    @ClinicId() clinicId: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const parsed = leadExportFormatSchema.safeParse(format ?? 'csv');
    if (!parsed.success) {
      throw new BadRequestException(
        'Formato inválido — use format=csv, xlsx ou pdf.',
      );
    }
    const { leads } = await this.leads.list(clinicId);
    const file = await this.exporter.export(
      leads,
      parsed.data,
      await this.leads.clinicName(clinicId),
    );
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    });
    return new StreamableFile(file.buffer);
  }

  @Post('import')
  @Roles('owner')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  import(
    @ClinicId() clinicId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<LeadImportResult> {
    if (!file?.buffer) {
      throw new BadRequestException(
        'Nenhum arquivo recebido — envie a planilha no campo "file".',
      );
    }
    return this.importer.import(clinicId, file);
  }

  @Get(':id')
  detail(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.detail(clinicId, id);
  }
}
