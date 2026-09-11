import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AutomationSettings,
  type Holiday,
  type OutboundMessageSummary,
  automationHistoryQuerySchema,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AutomationSettingsService } from './automation-settings.service';
import {
  CreateHolidayDto,
  UpdateAutomationSettingsDto,
  UpdateOutboundMessageDto,
} from './dto';
import { HolidaysService } from './holidays.service';
import { OutboundService } from './outbound.service';

/**
 * Automações de relacionamento (F9). Configuração (`GET`/`PATCH`), histórico do
 * que saiu (e do que foi suprimido, com o motivo) e o calendário de feriados.
 * Protegido por SupabaseJwtGuard (global) + TenantGuard.
 */
@Controller()
@UseGuards(TenantGuard, RolesGuard)
@Roles('owner')
export class AutomationsController {
  constructor(
    private readonly settings: AutomationSettingsService,
    private readonly outbound: OutboundService,
    private readonly holidays: HolidaysService,
  ) {}

  @Get('automations')
  get(@ClinicId() clinicId: string): Promise<AutomationSettings> {
    return this.settings.get(clinicId);
  }

  @Patch('automations')
  update(
    @ClinicId() clinicId: string,
    @Body() body: UpdateAutomationSettingsDto,
  ): Promise<AutomationSettings> {
    return this.settings.update(clinicId, body);
  }

  /**
   * O histórico é o antídoto para a pergunta "o lembrete saiu?". Mostra também
   * o que **não** saiu e por quê — suprimido por descadastro é o sistema
   * acertando; falha de envio é problema a investigar.
   */
  @Get('automations/history')
  history(
    @ClinicId() clinicId: string,
    @Query() query: Record<string, string>,
  ): Promise<OutboundMessageSummary[]> {
    const parsed = automationHistoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('Filtros inválidos.');
    }
    return this.outbound.history(clinicId, parsed.data);
  }

  /** Edita e/ou adia uma mensagem programada (só `pendente`). */
  @Patch('automations/messages/:id')
  updateMessage(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOutboundMessageDto,
  ): Promise<OutboundMessageSummary> {
    return this.outbound.updatePending(clinicId, id, body);
  }

  /** Cancela uma mensagem programada — ela permanece no histórico. */
  @Post('automations/messages/:id/cancel')
  @HttpCode(200)
  cancelMessage(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OutboundMessageSummary> {
    return this.outbound.cancelPending(clinicId, id);
  }

  @Get('holidays')
  listHolidays(
    @ClinicId() clinicId: string,
    @Query('year') year: string | undefined,
  ): Promise<Holiday[]> {
    const parsed = Number(year);
    return this.holidays.list(
      clinicId,
      Number.isInteger(parsed) ? parsed : undefined,
    );
  }

  @Post('holidays')
  createHoliday(
    @ClinicId() clinicId: string,
    @Body() body: CreateHolidayDto,
  ): Promise<Holiday> {
    return this.holidays.create(clinicId, body);
  }

  /** Importa os feriados nacionais do ano (os locais seguem sendo manuais). */
  @Post('holidays/sync')
  @HttpCode(200)
  async syncHolidays(
    @ClinicId() clinicId: string,
    @Query('year') year: string | undefined,
  ): Promise<{ imported: number }> {
    const parsed = Number(year);
    const target = Number.isInteger(parsed)
      ? parsed
      : new Date().getUTCFullYear();
    return { imported: await this.holidays.syncNational(clinicId, target) };
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  async removeHoliday(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.holidays.remove(clinicId, id);
  }
}
