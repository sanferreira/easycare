// ===== RBAC — Controle de Acesso por Papel =====
// Baseado na especificação de permissões do projeto EasyCare

export type AppRole =
  | "admin"
  | "enfermeiro"
  | "medico"
  | "tecnico_enfermagem"
  | "cuidador"
  | "fisioterapeuta"
  | "nutricionista"
  | "recepcionista"
  | "administrativo"
  | "staff";

// Rotas que cada papel pode acessar
const ROLE_ROUTES: Record<AppRole, string[]> = {
  admin: ["/", "/residents", "/prontuario", "/medications", "/staff", "/escalas", "/occurrences", "/financeiro"],
  enfermeiro: ["/", "/residents", "/prontuario", "/medications", "/escalas", "/occurrences"],
  medico: ["/", "/residents", "/prontuario", "/medications", "/occurrences"],
  tecnico_enfermagem: ["/", "/residents", "/prontuario", "/medications", "/escalas", "/occurrences"],
  cuidador: ["/", "/residents", "/escalas", "/occurrences"],
  fisioterapeuta: ["/", "/residents", "/prontuario", "/occurrences"],
  nutricionista: ["/", "/residents", "/prontuario", "/occurrences"],
  recepcionista: ["/", "/residents", "/escalas", "/occurrences", "/financeiro"],
  administrativo: ["/", "/residents", "/escalas", "/occurrences", "/financeiro"],
  staff: ["/", "/residents", "/occurrences"],
};

export function canAccessRoute(role: string | undefined, route: string): boolean {
  if (!role) return false;
  const allowed = ROLE_ROUTES[role as AppRole];
  if (!allowed) return false;
  if (route === "/") return allowed.includes("/");
  return allowed.some((r) => r !== "/" && route.startsWith(r));
}

export function getAllowedRoutes(role: string | undefined): string[] {
  if (!role) return [];
  return ROLE_ROUTES[role as AppRole] ?? [];
}

// Rótulos legíveis dos papéis
export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  enfermeiro: "Enfermeiro(a)",
  medico: "Médico(a)",
  tecnico_enfermagem: "Técnico(a) de Enfermagem",
  cuidador: "Cuidador(a)",
  fisioterapeuta: "Fisioterapeuta",
  nutricionista: "Nutricionista",
  recepcionista: "Recepcionista",
  administrativo: "Administrativo",
  staff: "Colaborador",
};
