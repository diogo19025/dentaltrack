import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  answerWhatsappOnboardingSchema,
  whatsappLineQuerySchema,
  type WhatsappConnection,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { WhatsappConnectionService } from './connection.service';

/** Corpo de POST /whatsapp/connection/onboarding. */
export class AnswerOnboardingDto extends createZodDto(
  answerWhatsappOnboardingSchema,
) {}

/** `?numero=principal|avisos` (ausente = principal). */
export class LineQueryDto extends createZodDto(whatsappLineQuerySchema) {}

/**
 * Conexão dos números de WhatsApp da empresa (F10) — pareamento por QR na tela.
 * Dois números: `principal` (atende o cliente) e `avisos` (só lembretes e
 * automações), escolhidos por `?numero=`.
 *
 * Protegido por SupabaseJwtGuard (global) + TenantGuard: o `clinicId` vem do
 * token, e o nome da instância é derivado dele — nunca aceito do cliente. Isso
 * importa mais do que parece: o nome da instância é o que o webhook usa para
 * resolver o tenant, então aceitá-lo do corpo deixaria uma empresa sequestrar
 * as mensagens de outra.
 */
@Controller('whatsapp/connection')
@UseGuards(TenantGuard, RolesGuard)
@Roles('owner')
export class WhatsappConnectionController {
  constructor(private readonly connection: WhatsappConnectionService) {}

  @Get()
  status(
    @ClinicId() clinicId: string,
    @Query() { numero }: LineQueryDto,
  ): Promise<WhatsappConnection> {
    return this.connection.getStatus(clinicId, numero);
  }

  /** Cria a instância (se preciso) e devolve um QR novo para parear. */
  @Post()
  @HttpCode(200)
  connect(
    @ClinicId() clinicId: string,
    @Query() { numero }: LineQueryDto,
  ): Promise<WhatsappConnection> {
    return this.connection.connect(clinicId, numero);
  }

  /** Resposta à pergunta do 1º acesso ("já tem um número dedicado?"). */
  @Post('onboarding')
  @HttpCode(200)
  answerOnboarding(
    @ClinicId() clinicId: string,
    @Body() body: AnswerOnboardingDto,
  ): Promise<WhatsappConnection> {
    return this.connection.answerOnboarding(clinicId, body.answer);
  }

  /** Desconecta o número, mantendo a instância para reparear depois. */
  @Post('disconnect')
  @HttpCode(200)
  disconnect(
    @ClinicId() clinicId: string,
    @Query() { numero }: LineQueryDto,
  ): Promise<WhatsappConnection> {
    return this.connection.disconnect(clinicId, numero);
  }

  /** Remove a instância e desfaz o vínculo (troca de número). */
  @Delete()
  reset(
    @ClinicId() clinicId: string,
    @Query() { numero }: LineQueryDto,
  ): Promise<WhatsappConnection> {
    return this.connection.reset(clinicId, numero);
  }
}
