import { createZodDto } from 'nestjs-zod';
import { startHandoffSchema } from '@dentaltrack/shared';

/** Corpo de POST /conversations/:id/handoff (P0.2). */
export class StartHandoffDto extends createZodDto(startHandoffSchema) {}
