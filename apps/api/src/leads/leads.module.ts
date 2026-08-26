import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadsExportService } from './leads-export.service';
import { LeadsImportService } from './leads-import.service';

/** Módulo de leads (F3 · GET /leads · F8 export/import). */
@Module({
  controllers: [LeadsController],
  providers: [LeadsService, LeadsExportService, LeadsImportService],
  exports: [LeadsService],
})
export class LeadsModule {}
