import { createZodDto } from 'nestjs-zod';
import { sendReminderSchema } from '@dentaltrack/shared';

/** Corpo de POST /conversations/:id/reminder. */
export class SendReminderDto extends createZodDto(sendReminderSchema) {}
