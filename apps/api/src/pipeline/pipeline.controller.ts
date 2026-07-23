import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  PipelineCardDto,
  PipelineResponse,
  PipelineStageDto,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import {
  CreatePipelineCardDto,
  CreatePipelineStageDto,
  MovePipelineCardDto,
  RenamePipelineStageDto,
} from './dto';
import { PipelineService } from './pipeline.service';

/**
 * Funil de atendimento (F7). Protegido: SupabaseJwtGuard (global) +
 * TenantGuard resolve o `clinicId`. Toda operação é escopada por empresa.
 */
@Controller('pipeline')
@UseGuards(TenantGuard)
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get()
  list(@ClinicId() clinicId: string): Promise<PipelineResponse> {
    return this.pipeline.list(clinicId);
  }

  @Post('cards')
  createCard(
    @ClinicId() clinicId: string,
    @Body() body: CreatePipelineCardDto,
  ): Promise<PipelineCardDto> {
    return this.pipeline.createManual(clinicId, body);
  }

  @Patch('cards/:id')
  moveCard(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MovePipelineCardDto,
  ): Promise<PipelineCardDto> {
    return this.pipeline.move(clinicId, id, body);
  }

  @Delete('cards/:id')
  removeCard(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.pipeline.remove(clinicId, id);
  }

  @Post('stages')
  createStage(
    @ClinicId() clinicId: string,
    @Body() body: CreatePipelineStageDto,
  ): Promise<PipelineStageDto> {
    return this.pipeline.createStage(clinicId, body);
  }

  @Patch('stages/:id')
  renameStage(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenamePipelineStageDto,
  ): Promise<PipelineStageDto> {
    return this.pipeline.renameStage(clinicId, id, body);
  }

  @Delete('stages/:id')
  removeStage(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.pipeline.removeStage(clinicId, id);
  }
}
