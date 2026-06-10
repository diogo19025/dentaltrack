import {
  Body,
  Controller,
  HttpException,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto';

/**
 * POST /chat — turno de conversa com **streaming** (BE-1.6).
 * Protegido: o SupabaseJwtGuard (global) valida o JWT e o TenantGuard resolve o
 * `clinicId` do usuário (via Membership). A resposta é um UI message stream do
 * AI SDK (consumível pelo `useChat`); o `conversationId` volta no header
 * `X-Conversation-Id`.
 */
@Controller('chat')
@UseGuards(TenantGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  async handle(
    @Body() body: ChatRequestDto,
    @ClinicId() clinicId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.chat.streamMessage(body, clinicId, res);
    } catch (err) {
      // Erros pré-stream (conversa inválida) ainda não tocaram a resposta.
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const payload =
        err instanceof HttpException
          ? err.getResponse()
          : { statusCode: 500, message: 'Erro interno.' };
      res.status(status).json(payload);
    }
  }
}
