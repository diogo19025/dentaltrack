import { createZodDto } from 'nestjs-zod';
import {
  createHolidaySchema,
  updateAutomationSettingsSchema,
  updateOutboundMessageSchema,
} from '@dentaltrack/shared';

/** Corpo de PATCH /automations. */
export class UpdateAutomationSettingsDto extends createZodDto(
  updateAutomationSettingsSchema,
) {}

/** Corpo de POST /holidays. */
export class CreateHolidayDto extends createZodDto(createHolidaySchema) {}

/** Corpo de PATCH /automations/messages/:id. */
export class UpdateOutboundMessageDto extends createZodDto(
  updateOutboundMessageSchema,
) {}
