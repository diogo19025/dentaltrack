import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * Módulo de conversas (BE-1.2). Exporta o ConversationsService para o motor do
 * chatbot (BE-1.6) e expõe os endpoints REST de conversas (F3 · dashboard/chat).
 */
@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
