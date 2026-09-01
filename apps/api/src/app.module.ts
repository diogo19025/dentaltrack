import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgendaModule } from './agenda/agenda.module';
import { AuthModule } from './auth/auth.module';
import { AutomationsModule } from './automations/automations.module';
import { ChatModule } from './chat/chat.module';
import { ClinicorpModule } from './clinicorp/clinicorp.module';
import { validateEnv } from './config/env.validation';
import { ConversationsModule } from './conversations/conversations.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { LeadsModule } from './leads/leads.module';
import { MetricsModule } from './metrics/metrics.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProceduresModule } from './procedures/procedures.module';
import { RemindersModule } from './reminders/reminders.module';
import { SettingsModule } from './settings/settings.module';
import { TagsModule } from './tags/tags.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    HealthModule,
    ConversationsModule,
    ChatModule,
    OnboardingModule,
    SettingsModule,
    ProceduresModule,
    TagsModule,
    MetricsModule,
    LeadsModule,
    PipelineModule,
    JobsModule,
    WhatsappModule,
    RemindersModule,
    ClinicorpModule,
    AgendaModule,
    AutomationsModule,
  ],
})
export class AppModule {}
