import { Module } from "@nestjs/common";
import { ProceduresController } from "./procedures.controller";
import { ProceduresService } from "./procedures.service";

/** Módulo do catálogo de procedimentos (BE-2.2 — F2). */
@Module({
  controllers: [ProceduresController],
  providers: [ProceduresService],
  exports: [ProceduresService],
})
export class ProceduresModule {}
