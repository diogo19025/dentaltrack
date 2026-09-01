import { createZodDto } from 'nestjs-zod';
import { updateIntegrationSchema } from '@dentaltrack/shared';

/** Corpo de PUT /integrations/clinicorp. */
export class UpdateIntegrationDto extends createZodDto(
  updateIntegrationSchema,
) {}
