import { Module } from '@nestjs/common';
import { OptOutModule } from '../automations/opt-out.module';
import { LeadPrivacyService } from './lead-privacy.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadsExportService } from './leads-export.service';
import { LeadsImportService } from './leads-import.service';

/**
 * Módulo de leads (F3 · GET /leads · F8 export/import · P1.5 LGPD).
 *
 * Importa o `OptOutModule` porque o descadastro do contato é o mesmo registro
 * que a fila de saída consulta — duplicar a regra aqui criaria duas verdades
 * sobre quem pode receber mensagem automática.
 */
@Module({
  imports: [OptOutModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    LeadsExportService,
    LeadsImportService,
    LeadPrivacyService,
  ],
  exports: [LeadsService],
})
export class LeadsModule {}
