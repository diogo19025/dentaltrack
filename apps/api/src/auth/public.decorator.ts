import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Marca uma rota como pública (ignora o SupabaseJwtGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
