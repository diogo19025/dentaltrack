import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { HandoffService } from './handoff.service';

/**
 * Módulo de conversas (BE-1.2). Exporta o ConversationsService para o motor do
 * chatbot (BE-1.6) e expõe os endpoints REST de conversas (F3 · dashboard/chat)
 * e o handoff humano (P0.2).
 *
 * O `HandoffService` fica aqui e depende só do Prisma — de propósito. Fazê-lo
 * depender do `RemindersService` (o transporte da resposta do atendente) criaria
 * um ciclo, porque o `RemindersModule` já importa este; e quem lê o estado do
 * handoff (o motor do chat e a fila de saída) lê a coluna direto, sem passar
 * por aqui.
 */
@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, HandoffService],
  exports: [ConversationsService, HandoffService],
})
export class ConversationsModule {}
