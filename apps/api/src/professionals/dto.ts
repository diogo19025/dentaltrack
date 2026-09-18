import { createZodDto } from 'nestjs-zod';
import {
  createProfessionalSchema,
  updateProfessionalSchema,
} from '@dentaltrack/shared';

/** Corpo de POST /professionals. */
export class CreateProfessionalDto extends createZodDto(
  createProfessionalSchema,
) {}

/** Corpo de PATCH /professionals/:id. */
export class UpdateProfessionalDto extends createZodDto(
  updateProfessionalSchema,
) {}
