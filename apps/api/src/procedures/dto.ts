import { createZodDto } from 'nestjs-zod';
import {
  createProcedureSchema,
  updateProcedureSchema,
} from '@dentaltrack/shared';

/** Corpo de POST /procedures. */
export class CreateProcedureDto extends createZodDto(createProcedureSchema) {}

/** Corpo de PATCH /procedures/:id. */
export class UpdateProcedureDto extends createZodDto(updateProcedureSchema) {}
