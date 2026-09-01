import { createZodDto } from 'nestjs-zod';
import {
  createHolidaySchema,
  updateAutomationSettingsSchema,
} from '@dentaltrack/shared';

/** Corpo de PATCH /automations. */
export class UpdateAutomationSettingsDto extends createZodDto(
  updateAutomationSettingsSchema,
) {}

/** Corpo de POST /holidays. */
export class CreateHolidayDto extends createZodDto(createHolidaySchema) {}
