import { createZodDto } from 'nestjs-zod';
import { updateOptOutSchema } from '@dentaltrack/shared';

/** Corpo de PUT /leads/:id/opt-out (P1.5). */
export class UpdateOptOutDto extends createZodDto(updateOptOutSchema) {}
