import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

/**
 * Lembretes por WhatsApp a partir do CRM (pós-MVP). Importa o
 * ConversationsModule (persistir a mensagem) e o WhatsappModule (transporte de
 * saída via EvolutionService). PrismaService vem do PrismaModule global.
 */
@Module({
  imports: [ConversationsModule, WhatsappModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
