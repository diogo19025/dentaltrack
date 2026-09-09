import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AgendaResponse,
  type AppointmentSummary,
  type Availability,
  agendaQuerySchema,
  rescheduleAppointmentSchema,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { AgendaService } from './agenda.service';
import { AgendaSyncService } from './agenda-sync.service';

/**
 * Agenda da empresa (F9). `GET /agenda` lista a janela de agendamentos e
 * `GET /agenda/disponibilidade` devolve horários livres — o mesmo dado que o
 * agente usa, exposto para a tela poder mostrar o que o bot está oferecendo.
 * Protegido por SupabaseJwtGuard (global) + TenantGuard.
 */
@Controller('agenda')
@UseGuards(TenantGuard)
export class AgendaController {
  constructor(
    private readonly agenda: AgendaService,
    private readonly sync: AgendaSyncService,
  ) {}

  @Get()
  list(
    @ClinicId() clinicId: string,
    @Query() query: Record<string, string>,
  ): Promise<AgendaResponse> {
    const parsed = agendaQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(
        'Filtros inválidos — use from/to no formato AAAA-MM-DD.',
      );
    }
    return this.agenda.list(clinicId, parsed.data);
  }

  /**
   * Sincroniza a agenda agora, sem esperar a varredura de 10 minutos. Existe
   * para o momento em que o operador acaba de conectar a integração: a tela
   * precisa mostrar resultado na hora, não no próximo tique do cron.
   */
  @Post('sync')
  @HttpCode(200)
  syncNow(
    @ClinicId() clinicId: string,
  ): Promise<{ criados: number; atualizados: number; ignorados: number }> {
    return this.sync.syncClinic(clinicId);
  }

  @Get('disponibilidade')
  availability(
    @ClinicId() clinicId: string,
    @Query('dias') days: string | undefined,
  ): Promise<Availability> {
    const parsed = Number(days ?? 10);
    return this.agenda.getAvailability(clinicId, {
      days: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 60) : 10,
      limit: 20,
    });
  }

  /**
   * Cancela na agenda real e aqui (P0.5). Idempotente: repetir devolve o
   * agendamento já cancelado. Endpoint da equipe — **não** é tool do agente.
   */
  @Post(':id/cancelar')
  @HttpCode(200)
  cancel(
    @ClinicId() clinicId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AppointmentSummary> {
    return this.agenda.cancel(clinicId, id);
  }

  /** Move o agendamento para outro horário (P0.5). Mesmo horário = no-op. */
  @Post(':id/remarcar')
  @HttpCode(200)
  reschedule(
    @ClinicId() clinicId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<AppointmentSummary> {
    const parsed = rescheduleAppointmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Informe o novo horário (startsAt).');
    }
    return this.agenda.reschedule(clinicId, id, new Date(parsed.data.startsAt));
  }
}
