import { createZodDto } from 'nestjs-zod';
import { chatRequestSchema } from '@dentaltrack/shared';

/** DTO do corpo de POST /chat (validado pelo ZodValidationPipe global). */
export class ChatRequestDto extends createZodDto(chatRequestSchema) {}
