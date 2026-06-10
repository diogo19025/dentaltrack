import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  Post,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { TranscriptionResponse } from '@dentaltrack/shared';
import { AiUnavailableError } from '../ai/generate-reply';
import { transcribeAudio } from '../ai/transcribe';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto';

/** Tamanho máximo do áudio (10 MB ≈ vários minutos de opus/aac). */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** MIMEs aceitos: qualquer `audio/*` + `video/webm` (alguns navegadores rotulam assim a gravação do MediaRecorder). */
const AUDIO_MIME = /^(audio\/|video\/webm$)/;

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

  /**
   * POST /chat/transcribe — speech-to-text do áudio do paciente.
   * Recebe multipart/form-data (campo `audio`, sem storage em disco — buffer em
   * memória) e devolve `{ text }`. O front coloca o texto no input do chat para
   * o paciente revisar e enviar — o turno segue o fluxo normal do `POST /chat`.
   * Mesma auth dos demais endpoints (JWT + tenant).
   */
  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
    }),
  )
  async transcribe(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<TranscriptionResponse> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        "Envie o áudio no campo 'audio' (multipart/form-data).",
      );
    }
    // Normaliza "audio/webm;codecs=opus" → "audio/webm".
    const mediaType = (file.mimetype ?? '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_MIME.test(mediaType)) {
      throw new BadRequestException(
        `Tipo de arquivo não suportado: ${file.mimetype || 'desconhecido'}. Envie um áudio.`,
      );
    }

    try {
      const text = await transcribeAudio(file.buffer, mediaType);
      if (!text) {
        throw new UnprocessableEntityException(
          'Não foi possível entender o áudio. Tente gravar novamente.',
        );
      }
      return { text };
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        throw new ServiceUnavailableException(
          'A transcrição está temporariamente indisponível. Tente novamente em instantes.',
        );
      }
      throw err;
    }
  }
}
