import { Module } from '@nestjs/common';
import { OptOutModule } from '../automations/opt-out.module';
import { ChatModule } from '../chat/chat.module';
import { WhatsappConnectionController } from './connection.controller';
import { WhatsappConnectionService } from './connection.service';
import { EvolutionService } from './evolution.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

/**
 * Adapter do canal WhatsApp (WA-3) — Evolution API (Baileys, não-oficial). É só
 * a borda: recebe o webhook, resolve a empresa pela instância e chama o **mesmo**
 * ChatService (non-streaming). Inclui também a **conexão do número por QR code**
 * (F10), que automatiza o pareamento antes feito por terminal. PrismaService vem
 * do PrismaModule global.
 */
@Module({
  imports: [ChatModule, OptOutModule],
  controllers: [WhatsappController, WhatsappConnectionController],
  providers: [WhatsappService, EvolutionService, WhatsappConnectionService],
  // EvolutionService é reusado pelo RemindersModule (envio de lembretes do CRM).
  exports: [EvolutionService],
})
export class WhatsappModule {}
