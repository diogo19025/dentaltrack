/** Papéis de acesso de uma membership dentro da empresa. */
export const ROLES = ["owner", "staff"] as const;

export type Role = (typeof ROLES)[number];

/** Resposta do bootstrap que provisiona/resgata a empresa do usuário. */
export interface OnboardingBootstrap {
  clinicId: string;
  created: boolean;
  role: Role;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role);
}
