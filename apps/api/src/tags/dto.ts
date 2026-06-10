import { createZodDto } from 'nestjs-zod';
import { createTagSchema, updateTagSchema } from '@dentaltrack/shared';

/** Corpo de POST /tags. */
export class CreateTagDto extends createZodDto(createTagSchema) {}

/** Corpo de PATCH /tags/:id. */
export class UpdateTagDto extends createZodDto(updateTagSchema) {}
