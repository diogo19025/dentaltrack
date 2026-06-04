import type { Request } from "express";
import type { JWTPayload } from "jose";

/** Usuário autenticado (extraído do JWT do Supabase pelo SupabaseJwtGuard). */
export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
  raw: JWTPayload;
}

/** Request do Express com o usuário e o clinicId resolvidos. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  clinicId?: string;
}
