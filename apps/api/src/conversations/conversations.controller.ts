import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ConversationDetail,
  ConversationSummary,
  HandoffState,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/types';
import { TenantGuard } from '../auth/tenant.guard';
import { ConversationsService } from './conversations.service';
import { StartHandoffDto } from './dto';
import { HandoffService } from './handoff.service';

/**
 * Conversas (F3). `GET /conversations` → tabela "recentes" do dashboard;
 * `GET /conversations/:id` → detalhe c/ tags p/ o rail do chat. Protegido pelo
 * SupabaseJwtGuard (global) + TenantGuard (resolve o `clinicId`).
 *
 * `POST`/`DELETE /conversations/:id/handoff` (P0.2) pausam e retomam a IA numa
 * conversa. A **resposta** do atendente durante o handoff não tem rota nova:
 * `POST /conversations/:id/reminder` (RemindersController) já envia texto pelo
 * WhatsApp, persiste na conversa e reabre a conversa abandonada — duas rotas
 * idênticas com nomes diferentes seriam dívida, não clareza.
 */
@Controller('conversations')
@UseGuards(TenantGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly handoff: HandoffService,
  ) {}

  @Get()
  listRecent(
    @ClinicId() clinicId: string,
    @Query('limit') limit?: string,
  ): Promise<ConversationSummary[]> {
    const n = Math.min(Math.max(Number(limit) || 8, 1), 50);
    return this.conversations.listRecent(clinicId, n);
  }

  @Get(':id')
  detail(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDetail> {
    return this.conversations.getDetail(id, clinicId);
  }

  /** Assumir o atendimento: a IA para de responder nesta conversa. */
  @Post(':id/handoff')
  assume(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StartHandoffDto,
    @CurrentUser() user?: AuthUser,
  ): Promise<HandoffState> {
    return this.handoff.assume(clinicId, id, user?.id ?? null, body.reason);
  }

  /** Devolver para a IA. */
  @Delete(':id/handoff')
  release(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HandoffState> {
    return this.handoff.release(clinicId, id);
  }
}
