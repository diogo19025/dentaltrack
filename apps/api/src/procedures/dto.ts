import { createZodDto } from 'nestjs-zod';
import {
  createProcedureSchema,
  importProceduresSchema,
  updateProcedureSchema,
} from '@dentaltrack/shared';

/** Corpo de POST /procedures. */
export class CreateProcedureDto extends createZodDto(createProcedureSchema) {}

/** Corpo de PATCH /procedures/:id. */
export class UpdateProcedureDto extends createZodDto(updateProcedureSchema) {}

/** Corpo de POST /procedures/import. */
export class ImportProceduresDto extends createZodDto(importProceduresSchema) {}
