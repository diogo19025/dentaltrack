import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import type { ConversationDetail, ConversationSummary } from "@dentaltrack/shared";
import { ClinicId } from "../auth/clinic-id.decorator";
import { TenantGuard } from "../auth/tenant.guard";
import { ConversationsService } from "./conversations.service";

/**
 * Conversas (F3). `GET /conversations` → tabela "recentes" do dashboard;
 * `GET /conversations/:id` → detalhe c/ tags p/ o rail do chat. Protegido pelo
 * SupabaseJwtGuard (global) + TenantGuard (resolve o `clinicId`).
 */
@Controller("conversations")
@UseGuards(TenantGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  listRecent(
    @ClinicId() clinicId: string,
    @Query("limit") limit?: string,
  ): Promise<ConversationSummary[]> {
    const n = Math.min(Math.max(Number(limit) || 8, 1), 50);
    return this.conversations.listRecent(clinicId, n);
  }

  @Get(":id")
  detail(
    @ClinicId() clinicId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ConversationDetail> {
    return this.conversations.getDetail(id, clinicId);
  }
}
