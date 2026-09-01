import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * Módulo de chat (BE-1.6). Reusa o ConversationsService para abrir conversas e
 * persistir mensagens, e o AgendaModule para que as tools ofereçam horários
 * reais e gravem o agendamento na agenda da empresa (F9) — tudo
 * channel-agnostic.
 */
@Module({
  imports: [ConversationsModule, AgendaModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
