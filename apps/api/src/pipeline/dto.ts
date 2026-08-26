import { createZodDto } from 'nestjs-zod';
import {
  createPipelineCardSchema,
  createPipelineStageSchema,
  movePipelineCardSchema,
  renamePipelineStageSchema,
} from '@dentaltrack/shared';

/** Corpo de POST /pipeline/cards. */
export class CreatePipelineCardDto extends createZodDto(
  createPipelineCardSchema,
) {}

/** Corpo de PATCH /pipeline/cards/:id. */
export class MovePipelineCardDto extends createZodDto(movePipelineCardSchema) {}

/** Corpo de POST /pipeline/stages. */
export class CreatePipelineStageDto extends createZodDto(
  createPipelineStageSchema,
) {}

/** Corpo de PATCH /pipeline/stages/:id. */
export class RenamePipelineStageDto extends createZodDto(
  renamePipelineStageSchema,
) {}
