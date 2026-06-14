import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * Módulo de chat (BE-1.6 — versão mockada). Reusa o ConversationsService
 * para abrir conversas e persistir mensagens (channel-agnostic).
 */
@Module({
  imports: [ConversationsModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
