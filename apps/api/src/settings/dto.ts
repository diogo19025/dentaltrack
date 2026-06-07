import { createZodDto } from "nestjs-zod";
import { updateSettingsSchema } from "@dentaltrack/shared";

/** DTO do corpo de PATCH /settings (validado pelo ZodValidationPipe global). */
export class UpdateSettingsDto extends createZodDto(updateSettingsSchema) {}
