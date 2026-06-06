import { Body, Controller, Post } from "@nestjs/common";
import type { ChatResponse } from "@dentaltrack/shared";
import { Public } from "../auth/public.decorator";
import { ChatService } from "./chat.service";
import { ChatRequestDto } from "./dto";

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /**
   * POST /chat — um turno de conversa (mock, sem IA/streaming/tools).
   *
   * TEMPORÁRIO: @Public para permitir teste via curl/Postman sem login.
   * No BE-1.6 será protegido por SupabaseJwtGuard + TenantGuard (clinicId do JWT).
   */
  @Public()
  @Post()
  handle(@Body() body: ChatRequestDto): Promise<ChatResponse> {
    return this.chat.handleMessage(body);
  }
}
