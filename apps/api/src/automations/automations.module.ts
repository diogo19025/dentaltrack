import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsappTransportModule } from '../whatsapp/whatsapp-transport.module';
import { AutomationPlannerService } from './automation-planner.service';
import { AutomationSettingsService } from './automation-settings.service';
import { AutomationsController } from './automations.controller';
import { HolidaysService } from './holidays.service';
import { OptOutModule } from './opt-out.module';
import { OutboundService } from './outbound.service';

/**
 * Automações de relacionamento (F9): planejamento (o que precisa ser enviado),
 * fila de saída (quando e como sai) e a configuração da empresa.
 *
 * Importa o transporte do WhatsApp (`EvolutionService`) e o
 * `ConversationsModule` para que a mensagem enviada entre na conversa do
 * contato — é o que faz a resposta do cliente cair no mesmo fio e o agente
 * assumir dali. PrismaService vem do PrismaModule global.
 */
@Module({
  imports: [ConversationsModule, WhatsappTransportModule, OptOutModule],
  controllers: [AutomationsController],
  providers: [
    AutomationSettingsService,
    HolidaysService,
    OutboundService,
    AutomationPlannerService,
  ],
  exports: [
    AutomationSettingsService,
    HolidaysService,
    OutboundService,
    AutomationPlannerService,
    OptOutModule,
  ],
})
export class AutomationsModule {}
