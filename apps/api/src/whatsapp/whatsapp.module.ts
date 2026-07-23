import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { EvolutionService } from './evolution.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

/**
 * Adapter do canal WhatsApp (WA-3) — Evolution API (Baileys, não-oficial). É só
 * a borda: recebe o webhook, resolve a empresa pela instância e chama o **mesmo**
 * ChatService (non-streaming). PrismaService vem do PrismaModule global.
 */
@Module({
  imports: [ChatModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, EvolutionService],
  // EvolutionService é reusado pelo RemindersModule (envio de lembretes do CRM).
  exports: [EvolutionService],
})
export class WhatsappModule {}
