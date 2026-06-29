import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { ReminderContext, SendReminderResult } from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { SendReminderDto } from './dto';
import { RemindersService } from './reminders.service';

/**
 * Lembrete por WhatsApp a partir do CRM (pós-MVP). Sob `/conversations/:id` para
 * deixar claro que o lembrete é sempre no contexto de uma conversa.
 * `GET …/reminder` → rascunho + elegibilidade; `POST …/reminder` → envia.
 * Protegido: SupabaseJwtGuard (global) + TenantGuard (resolve o `clinicId`).
 */
@Controller('conversations')
@UseGuards(TenantGuard)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get(':id/reminder')
  context(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReminderContext> {
    return this.reminders.getContext(clinicId, id);
  }

  @Post(':id/reminder')
  send(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendReminderDto,
  ): Promise<SendReminderResult> {
    return this.reminders.send(clinicId, id, body.message);
  }
}
