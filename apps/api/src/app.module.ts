import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { ChatModule } from "./chat/chat.module";
import { validateEnv } from "./config/env.validation";
import { ConversationsModule } from "./conversations/conversations.module";
import { HealthModule } from "./health/health.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProceduresModule } from "./procedures/procedures.module";
import { SettingsModule } from "./settings/settings.module";
import { TagsModule } from "./tags/tags.module";

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
  ],
})
export class AppModule {}
