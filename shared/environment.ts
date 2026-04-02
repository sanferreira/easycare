export const MODULE_ROUTE_VALUES = [
  "/",
  "/residents",
  "/prontuario",
  "/medications",
  "/staff",
  "/escalas",
  "/occurrences",
  "/financeiro",
  "/environment",
] as const;

export type ModuleRoute = (typeof MODULE_ROUTE_VALUES)[number];

export const SHIFT_ASSIGNMENT_TYPE_VALUES = ["12h_manha", "12h_noite", "24h", "avulso"] as const;
export type ShiftAssignmentType = (typeof SHIFT_ASSIGNMENT_TYPE_VALUES)[number];

export const APP_ROLE_VALUES = [
  "admin",
  "enfermeiro",
  "medico",
  "tecnico_enfermagem",
  "cuidador",
  "fisioterapeuta",
  "nutricionista",
  "recepcionista",
  "administrativo",
  "staff",
] as const;

export type AppRole = (typeof APP_ROLE_VALUES)[number];

export const DEFAULT_ROLE_ROUTES: Record<string, ModuleRoute[]> = {
  admin: ["/", "/residents", "/prontuario", "/medications", "/staff", "/escalas", "/occurrences", "/financeiro", "/environment"],
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

export const DEFAULT_ROLE_EDIT_ROUTES: Record<string, ModuleRoute[]> = Object.fromEntries(
  Object.entries(DEFAULT_ROLE_ROUTES).map(([role, routes]) => [role, [...routes] as ModuleRoute[]]),
);

export const DEFAULT_STAFF_ROLE_OPTIONS = [
  { value: "cuidador", label: "Cuidador" },
  { value: "enfermeiro", label: "Enfermeiro" },
  { value: "tecnico_enfermagem", label: "Tecnico de Enfermagem" },
  { value: "medico", label: "Medico" },
  { value: "fisioterapeuta", label: "Fisioterapeuta" },
  { value: "nutricionista", label: "Nutricionista" },
  { value: "recepcionista", label: "Recepcionista" },
  { value: "administrativo", label: "Administrativo" },
] as const;

export type StaffRoleOption = { value: string; label: string };

export type ShiftProfileRule = {
  enabled: boolean;
  exactShiftHours: number | null;
  minRestHours: number | null;
  allowedShiftTypes: ShiftAssignmentType[];
};

export type ModulePermissionAction = "view" | "edit";

type ShiftProfilesSettings = {
  available: string[];
  scheduleConfigurable: string[];
  rules: Record<string, ShiftProfileRule>;
};

export type EnvironmentSettings = {
  roleRoutes: Record<string, ModuleRoute[]>;
  roleEditRoutes: Record<string, ModuleRoute[]>;
  availableStaffRoles: StaffRoleOption[];
  shiftProfiles: ShiftProfilesSettings;
};

const allowedRouteSet = new Set<string>(MODULE_ROUTE_VALUES);
const allowedShiftTypeSet = new Set<string>(SHIFT_ASSIGNMENT_TYPE_VALUES);

function createEmptyShiftProfileRule(overrides?: Partial<ShiftProfileRule>): ShiftProfileRule {
  return {
    enabled: false,
    exactShiftHours: null,
    minRestHours: null,
    allowedShiftTypes: [],
    ...overrides,
  };
}

function toShiftProfileKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9x]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toRoleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeShiftProfileKey(value: string | null | undefined): string {
  if (!value) return "";
  return toShiftProfileKey(value);
}

const DEFAULT_SHIFT_PROFILE_RULES: Record<string, ShiftProfileRule> = {
  flexivel: createEmptyShiftProfileRule(),
  "12x36": createEmptyShiftProfileRule({
    enabled: true,
    exactShiftHours: 12,
    minRestHours: 36,
    allowedShiftTypes: ["12h_manha", "12h_noite"],
  }),
  comercial: createEmptyShiftProfileRule(),
};

function deriveShiftProfileRule(profile: string): ShiftProfileRule | null {
  const normalizedProfile = normalizeShiftProfileKey(profile);
  const match = normalizedProfile.match(/^(\d{1,3})x(\d{1,3})$/);
  if (!match) return null;

  const exactShiftHours = Number(match[1]);
  const minRestHours = Number(match[2]);
  if (!Number.isFinite(exactShiftHours) || exactShiftHours <= 0) return null;
  if (!Number.isFinite(minRestHours) || minRestHours <= 0) return null;

  let allowedShiftTypes: ShiftAssignmentType[] = ["avulso"];
  if (exactShiftHours === 12) {
    allowedShiftTypes = ["12h_manha", "12h_noite"];
  } else if (exactShiftHours === 24) {
    allowedShiftTypes = ["24h"];
  }

  return createEmptyShiftProfileRule({
    enabled: true,
    exactShiftHours,
    minRestHours,
    allowedShiftTypes,
  });
}

export const DEFAULT_SHIFT_PROFILES: ShiftProfilesSettings = {
  available: ["flexivel", "12x36", "comercial"],
  scheduleConfigurable: ["flexivel", "comercial"],
  rules: {
    flexivel: DEFAULT_SHIFT_PROFILE_RULES.flexivel,
    "12x36": DEFAULT_SHIFT_PROFILE_RULES["12x36"],
    comercial: DEFAULT_SHIFT_PROFILE_RULES.comercial,
  },
};

const normalizeRoutes = (value: unknown, fallback: ModuleRoute[]): ModuleRoute[] => {
  if (!Array.isArray(value)) return [...fallback];
  const deduped = value
    .filter((item): item is string => typeof item === "string" && allowedRouteSet.has(item))
    .filter((item, index, source) => source.indexOf(item) === index);
  return deduped.length > 0 ? (deduped as ModuleRoute[]) : [...fallback];
};

const normalizeRoleRoutesWithFallback = (
  value: unknown,
  fallbackRoleRoutes: Record<string, ModuleRoute[]>,
  options?: { includeFallbackRoles?: boolean },
): Record<string, ModuleRoute[]> => {
  const normalized: Record<string, ModuleRoute[]> = {};
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

  const candidateRoles = new Set(
    Object.keys(candidate)
      .map((role) => role.trim())
      .filter((role) => role.length > 0),
  );
  if (options?.includeFallbackRoles) {
    for (const fallbackRole of Object.keys(fallbackRoleRoutes)) {
      candidateRoles.add(fallbackRole);
    }
  }
  const allRoles = candidateRoles.size > 0
    ? Array.from(candidateRoles)
    : Object.keys(fallbackRoleRoutes);

  for (const role of allRoles) {
    normalized[role] = normalizeRoutes(candidate[role], fallbackRoleRoutes[role] ?? ["/"]);
  }
  return normalized;
};

const normalizeRoleRoutes = (value: unknown): Record<string, ModuleRoute[]> =>
  normalizeRoleRoutesWithFallback(value, DEFAULT_ROLE_ROUTES);

const syncRoleRoutesAndEditRoutes = (
  roleRoutes: Record<string, ModuleRoute[]>,
  roleEditRoutes: Record<string, ModuleRoute[]>,
): { roleRoutes: Record<string, ModuleRoute[]>; roleEditRoutes: Record<string, ModuleRoute[]> } => {
  const nextRoleRoutes: Record<string, ModuleRoute[]> = {};
  const nextRoleEditRoutes: Record<string, ModuleRoute[]> = {};
  const allRoles = Array.from(new Set([...Object.keys(roleRoutes), ...Object.keys(roleEditRoutes)]));

  for (const role of allRoles) {
    const editRoutes = Array.from(new Set(roleEditRoutes[role] ?? [])) as ModuleRoute[];
    const viewSet = new Set<ModuleRoute>(roleRoutes[role] ?? []);
    for (const route of editRoutes) {
      viewSet.add(route);
    }
    nextRoleRoutes[role] = Array.from(viewSet) as ModuleRoute[];
    nextRoleEditRoutes[role] = editRoutes;
  }

  return {
    roleRoutes: nextRoleRoutes,
    roleEditRoutes: nextRoleEditRoutes,
  };
};

const normalizeStaffRoleOptions = (value: unknown): StaffRoleOption[] => {
  if (!Array.isArray(value)) return [...DEFAULT_STAFF_ROLE_OPTIONS];
  const parsed = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as { value?: unknown; label?: unknown };
      if (typeof raw.value !== "string" || typeof raw.label !== "string") return null;
      const roleValue = toRoleKey(raw.value);
      const roleLabel = raw.label.trim();
      if (!roleValue || !roleLabel) return null;
      return { value: roleValue, label: roleLabel };
    })
    .filter((item): item is StaffRoleOption => !!item)
    .filter((item, index, source) =>
      source.findIndex((current) => current.value.toLowerCase() === item.value.toLowerCase()) === index,
    );

  return parsed.length > 0 ? parsed : [...DEFAULT_STAFF_ROLE_OPTIONS];
};

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function normalizeShiftProfileRule(
  value: unknown,
  fallback: ShiftProfileRule,
): ShiftProfileRule {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

  const allowedShiftTypes = Array.isArray(candidate.allowedShiftTypes)
    ? candidate.allowedShiftTypes
        .filter((item): item is string => typeof item === "string" && allowedShiftTypeSet.has(item))
        .filter((item, index, source) => source.indexOf(item) === index) as ShiftAssignmentType[]
    : fallback.allowedShiftTypes;

  return createEmptyShiftProfileRule({
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    exactShiftHours: parsePositiveNumber(candidate.exactShiftHours) ?? fallback.exactShiftHours,
    minRestHours: parsePositiveNumber(candidate.minRestHours) ?? fallback.minRestHours,
    allowedShiftTypes,
  });
}

const normalizeShiftProfiles = (value: unknown): EnvironmentSettings["shiftProfiles"] => {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

  const available = Array.isArray(candidate.available)
    ? candidate.available
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => normalizeShiftProfileKey(item))
        .filter((item, index, source) => item.length > 0 && source.indexOf(item) === index)
    : [...DEFAULT_SHIFT_PROFILES.available];

  const safeAvailable = available.length > 0 ? available : [...DEFAULT_SHIFT_PROFILES.available];

  const scheduleConfigurableRaw = Array.isArray(candidate.scheduleConfigurable)
    ? candidate.scheduleConfigurable
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => normalizeShiftProfileKey(item))
        .filter((item, index, source) => item.length > 0 && source.indexOf(item) === index)
    : [...DEFAULT_SHIFT_PROFILES.scheduleConfigurable];

  const scheduleConfigurable = scheduleConfigurableRaw.filter((profile) => safeAvailable.includes(profile));

  const rawRulesSource = candidate.rules && typeof candidate.rules === "object"
    ? (candidate.rules as Record<string, unknown>)
    : {};
  const normalizedRawRules: Record<string, unknown> = {};
  for (const [rawProfile, rawRule] of Object.entries(rawRulesSource)) {
    const profile = normalizeShiftProfileKey(rawProfile);
    if (!profile) continue;
    normalizedRawRules[profile] = rawRule;
  }

  const rules: Record<string, ShiftProfileRule> = {};
  for (const profile of safeAvailable) {
    const defaultRule =
      DEFAULT_SHIFT_PROFILE_RULES[profile]
      ?? deriveShiftProfileRule(profile)
      ?? createEmptyShiftProfileRule();
    rules[profile] = normalizeShiftProfileRule(normalizedRawRules[profile], defaultRule);
  }

  return {
    available: safeAvailable,
    scheduleConfigurable: scheduleConfigurable.length > 0
      ? scheduleConfigurable
      : safeAvailable.filter((profile) => profile !== "12x36"),
    rules,
  };
};

const syncStaffRolesWithRoleRoutes = (
  roleRoutes: Record<string, ModuleRoute[]>,
  staffRoles: StaffRoleOption[],
): Record<string, ModuleRoute[]> => {
  const next = { ...roleRoutes };
  for (const staffRole of staffRoles) {
    if (!next[staffRole.value]) {
      next[staffRole.value] = ["/"];
    }
  }
  return next;
};

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  roleRoutes: {},
  roleEditRoutes: {},
  availableStaffRoles: [],
  shiftProfiles: normalizeShiftProfiles(DEFAULT_SHIFT_PROFILES),
};

const defaultStaffRoles = normalizeStaffRoleOptions(DEFAULT_STAFF_ROLE_OPTIONS);
const defaultRoleRoutes = syncStaffRolesWithRoleRoutes(
  normalizeRoleRoutes(DEFAULT_ROLE_ROUTES),
  defaultStaffRoles,
);
const defaultRoleEditRoutes = syncStaffRolesWithRoleRoutes(
  normalizeRoleRoutesWithFallback(DEFAULT_ROLE_EDIT_ROUTES, defaultRoleRoutes, { includeFallbackRoles: true }),
  defaultStaffRoles,
);
const syncedDefaultRoutes = syncRoleRoutesAndEditRoutes(defaultRoleRoutes, defaultRoleEditRoutes);
DEFAULT_ENVIRONMENT_SETTINGS.roleRoutes = syncedDefaultRoutes.roleRoutes;
DEFAULT_ENVIRONMENT_SETTINGS.roleEditRoutes = syncedDefaultRoutes.roleEditRoutes;
DEFAULT_ENVIRONMENT_SETTINGS.availableStaffRoles = defaultStaffRoles;

export function normalizeEnvironmentSettings(value: unknown): EnvironmentSettings {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

  const availableStaffRoles = normalizeStaffRoleOptions(candidate.availableStaffRoles);
  const roleRoutes = syncStaffRolesWithRoleRoutes(
    normalizeRoleRoutes(candidate.roleRoutes),
    availableStaffRoles,
  );
  const roleEditRoutes = syncStaffRolesWithRoleRoutes(
    normalizeRoleRoutesWithFallback(candidate.roleEditRoutes, roleRoutes, { includeFallbackRoles: true }),
    availableStaffRoles,
  );
  const syncedRoutes = syncRoleRoutesAndEditRoutes(roleRoutes, roleEditRoutes);

  return {
    roleRoutes: syncedRoutes.roleRoutes,
    roleEditRoutes: syncedRoutes.roleEditRoutes,
    availableStaffRoles,
    shiftProfiles: normalizeShiftProfiles(candidate.shiftProfiles),
  };
}

export function getShiftProfileRule(
  profile: string | null | undefined,
  shiftProfiles?: EnvironmentSettings["shiftProfiles"],
): ShiftProfileRule {
  const normalizedProfile = normalizeShiftProfileKey(profile);
  const profileRules = shiftProfiles?.rules ?? DEFAULT_ENVIRONMENT_SETTINGS.shiftProfiles.rules;
  const configuredRule = normalizedProfile ? profileRules[normalizedProfile] : null;
  const fallbackRule =
    configuredRule
    ?? DEFAULT_SHIFT_PROFILE_RULES[normalizedProfile]
    ?? deriveShiftProfileRule(normalizedProfile)
    ?? createEmptyShiftProfileRule();
  return normalizeShiftProfileRule(configuredRule, fallbackRule);
}

export function routeIsAllowed(
  role: string | undefined,
  route: string,
  roleRoutes: Record<string, string[]>,
): boolean {
  if (!role) return false;
  const allowed = roleRoutes[role] ?? [];
  if (route === "/") return allowed.includes("/");
  return allowed.some((currentRoute) => currentRoute !== "/" && route.startsWith(currentRoute));
}

export function routeActionIsAllowed(
  role: string | undefined,
  route: string,
  action: ModulePermissionAction,
  roleRoutes: Record<string, string[]>,
  roleEditRoutes?: Record<string, string[]>,
): boolean {
  if (action === "edit") {
    return routeIsAllowed(role, route, roleEditRoutes ?? roleRoutes);
  }
  return routeIsAllowed(role, route, roleRoutes);
}
