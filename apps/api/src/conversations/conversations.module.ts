import { Module } from "@nestjs/common";
import { ConversationsService } from "./conversations.service";

/**
 * Módulo de conversas (BE-1.2). Exporta o ConversationsService para o
 * futuro motor do chatbot (BE-1.6) e endpoints REST de conversas.
 */
@Module({
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
