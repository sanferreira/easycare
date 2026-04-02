import { DEFAULT_ROLE_EDIT_ROUTES, DEFAULT_ROLE_ROUTES, routeActionIsAllowed, routeIsAllowed } from "@shared/environment";

export type RoleRoutesMap = Record<string, string[]>;

export function canAccessRoute(
  role: string | undefined,
  route: string,
  roleRoutes: RoleRoutesMap = DEFAULT_ROLE_ROUTES,
): boolean {
  return routeIsAllowed(role, route, roleRoutes);
}

export function getAllowedRoutes(
  role: string | undefined,
  roleRoutes: RoleRoutesMap = DEFAULT_ROLE_ROUTES,
): string[] {
  if (!role) return [];
  return roleRoutes[role] ?? [];
}

export function canEditRoute(
  role: string | undefined,
  route: string,
  roleRoutes: RoleRoutesMap = DEFAULT_ROLE_ROUTES,
  roleEditRoutes: RoleRoutesMap = DEFAULT_ROLE_EDIT_ROUTES,
): boolean {
  return routeActionIsAllowed(role, route, "edit", roleRoutes, roleEditRoutes);
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  enfermeiro: "Enfermeiro(a)",
  medico: "Medico(a)",
  tecnico_enfermagem: "Tecnico(a) de Enfermagem",
  cuidador: "Cuidador(a)",
  fisioterapeuta: "Fisioterapeuta",
  nutricionista: "Nutricionista",
  recepcionista: "Recepcionista",
  administrativo: "Administrativo",
  staff: "Colaborador",
};
