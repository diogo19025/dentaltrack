import { Body, Controller, HttpException, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { ChatService } from "./chat.service";
import { ChatRequestDto } from "./dto";

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /**
   * POST /chat — um turno de conversa com **streaming** (BE-1.6).
   * A resposta é um UI message stream do AI SDK (consumível pelo `useChat`);
   * o `conversationId` volta no header `X-Conversation-Id`.
   *
   * TEMPORÁRIO: @Public para teste sem login. A proteção real
   * (SupabaseJwtGuard + TenantGuard, clinicId do JWT) entra na Etapa 2.
   */
  @Public()
  @Post()
  async handle(@Body() body: ChatRequestDto, @Res() res: Response): Promise<void> {
    try {
      await this.chat.streamMessage(body, res);
    } catch (err) {
      // Erros pré-stream (conversa/clínica inválida) ainda não tocaram a resposta.
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const payload =
        err instanceof HttpException
          ? err.getResponse()
          : { statusCode: 500, message: "Erro interno." };
      res.status(status).json(payload);
    }
  }
}
