export const MODULE_ROUTE_VALUES = [
  "/",
  "/residents",
  "/prontuario",
  "/staff",
  "/escalas",
  "/ponto-eletronico",
  "/occurrences",
  "/financeiro",
  "/crm",
  "/environment",
  "/audit",
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
  admin: ["/", "/residents", "/prontuario", "/staff", "/escalas", "/ponto-eletronico", "/occurrences", "/financeiro", "/crm", "/environment", "/audit"],
  enfermeiro: ["/", "/residents", "/prontuario", "/escalas", "/ponto-eletronico", "/occurrences"],
  medico: ["/", "/residents", "/prontuario", "/ponto-eletronico", "/occurrences"],
  tecnico_enfermagem: ["/", "/residents", "/prontuario", "/escalas", "/ponto-eletronico", "/occurrences"],
  cuidador: ["/", "/residents", "/escalas", "/ponto-eletronico", "/occurrences"],
  fisioterapeuta: ["/", "/residents", "/prontuario", "/ponto-eletronico", "/occurrences"],
  nutricionista: ["/", "/residents", "/prontuario", "/ponto-eletronico", "/occurrences"],
  recepcionista: ["/", "/residents", "/escalas", "/ponto-eletronico", "/occurrences", "/financeiro"],
  administrativo: ["/", "/residents", "/escalas", "/ponto-eletronico", "/occurrences", "/financeiro", "/audit"],
  staff: ["/", "/residents", "/ponto-eletronico", "/occurrences"],
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

export type CrmKanbanStage = {
  value: string;
  label: string;
  color: string;
};

export type CrmKanbanSettings = {
  stages: CrmKanbanStage[];
};

export type TimeClockSettings = {
  lateToleranceMinutes: number;
  overtimeToleranceMinutes: number;
  breakDurationMinutes: number;
  breakReminderBeforeMinutes: number;
  nightStartTime: string;
  nightEndTime: string;
  blockCloseWithIncompleteDays: boolean;
  blockCloseWithAbsences: boolean;
  blockCloseWithOutOfRangeAttempts: boolean;
};

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
  crmKanban: CrmKanbanSettings;
  timeClock: TimeClockSettings;
};

const allowedRouteSet = new Set<string>(MODULE_ROUTE_VALUES);
const allowedShiftTypeSet = new Set<string>(SHIFT_ASSIGNMENT_TYPE_VALUES);
const ROUTE_ALIASES: Record<string, ModuleRoute> = {
  "/app": "/",
  "/medications": "/prontuario",
};

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

function toCrmStageKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized === "lost") return "no_interest";
  return normalized;
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
  scheduleConfigurable: ["flexivel", "12x36", "comercial"],
  rules: {
    flexivel: DEFAULT_SHIFT_PROFILE_RULES.flexivel,
    "12x36": DEFAULT_SHIFT_PROFILE_RULES["12x36"],
    comercial: DEFAULT_SHIFT_PROFILE_RULES.comercial,
  },
};

const DEFAULT_CRM_STAGES: CrmKanbanStage[] = [
  { value: "lead", label: "Lead", color: "#64748B" },
  { value: "qualified", label: "Qualificado", color: "#0EA5E9" },
  { value: "proposal", label: "Proposta", color: "#F59E0B" },
  { value: "negotiation", label: "Negociacao", color: "#8B5CF6" },
  { value: "won", label: "Ganho", color: "#10B981" },
  { value: "no_interest", label: "Não tem interesse", color: "#F97316" },
];
export const DEFAULT_TIME_CLOCK_SETTINGS: TimeClockSettings = {
  lateToleranceMinutes: 10,
  overtimeToleranceMinutes: 0,
  breakDurationMinutes: 60,
  breakReminderBeforeMinutes: 10,
  nightStartTime: "22:00",
  nightEndTime: "05:00",
  blockCloseWithIncompleteDays: false,
  blockCloseWithAbsences: false,
  blockCloseWithOutOfRangeAttempts: false,
};
const CRM_STAGE_FALLBACK_COLORS = [
  "#64748B",
  "#0EA5E9",
  "#F59E0B",
  "#8B5CF6",
  "#10B981",
  "#F97316",
  "#6366F1",
  "#14B8A6",
  "#D946EF",
  "#EF4444",
] as const;
const CRM_STAGE_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const resolveDefaultCrmStageColor = (stageValue: string, index: number): string => {
  const normalizedStage = toCrmStageKey(stageValue);
  const exact = DEFAULT_CRM_STAGES.find((stage) => stage.value === normalizedStage);
  if (exact) return exact.color;
  return CRM_STAGE_FALLBACK_COLORS[index % CRM_STAGE_FALLBACK_COLORS.length];
};

const normalizeCrmStageColor = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!CRM_STAGE_COLOR_REGEX.test(normalized)) return fallback;
  return normalized.toUpperCase();
};

const normalizeRoutes = (value: unknown, fallback: ModuleRoute[]): ModuleRoute[] => {
  if (!Array.isArray(value)) return [...fallback];
  const mappedRoutes = value
    .map((item) => {
      if (typeof item !== "string") return null;
      const normalized = item.trim();
      if (!normalized) return null;
      return ROUTE_ALIASES[normalized] ?? normalized;
    })
    .filter((item): item is ModuleRoute => typeof item === "string" && allowedRouteSet.has(item));
  const deduped = mappedRoutes.filter((item, index, source) => source.indexOf(item) === index);
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

  const fixedRuleProfiles = safeAvailable.filter((profile) => {
    const rule = rules[profile];
    return Boolean(rule?.enabled && rule.exactShiftHours && rule.exactShiftHours > 0);
  });
  const scheduleConfigurable = Array.from(
    new Set([
      ...scheduleConfigurableRaw.filter((profile) => safeAvailable.includes(profile)),
      ...fixedRuleProfiles,
    ]),
  );

  return {
    available: safeAvailable,
    scheduleConfigurable: scheduleConfigurable.length > 0
      ? scheduleConfigurable
      : safeAvailable,
    rules,
  };
};

const normalizeCrmKanban = (value: unknown): CrmKanbanSettings => {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  const inputStages = Array.isArray(candidate.stages)
    ? candidate.stages
    : value && Array.isArray(value)
      ? value
      : [];

  const parsedStages: CrmKanbanStage[] = inputStages
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const valueKey = toCrmStageKey(typeof raw.value === "string" ? raw.value : "");
      const label = typeof raw.label === "string" ? raw.label.trim() : "";
      if (!valueKey || !label) return null;
      const fallbackColor = resolveDefaultCrmStageColor(valueKey, index);
      return {
        value: valueKey.slice(0, 40),
        label: label.slice(0, 80),
        color: normalizeCrmStageColor(raw.color, fallbackColor),
      };
    })
    .filter((item): item is CrmKanbanStage => !!item)
    .filter((item, index, source) =>
      source.findIndex((current) => current.value.toLowerCase() === item.value.toLowerCase()) === index,
    );

  return {
    stages: parsedStages.length > 0 ? parsedStages : [...DEFAULT_CRM_STAGES],
  };
};

function parseNonNegativeInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.trim().replace(",", "."))
      : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.round(parsed);
  if (normalized < 0) return fallback;
  return Math.min(normalized, max);
}

function normalizeTimeValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return TIME_VALUE_REGEX.test(normalized) ? normalized : fallback;
}

const normalizeTimeClockSettings = (value: unknown): TimeClockSettings => {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

  return {
    lateToleranceMinutes: parseNonNegativeInteger(
      candidate.lateToleranceMinutes,
      DEFAULT_TIME_CLOCK_SETTINGS.lateToleranceMinutes,
      240,
    ),
    overtimeToleranceMinutes: parseNonNegativeInteger(
      candidate.overtimeToleranceMinutes,
      DEFAULT_TIME_CLOCK_SETTINGS.overtimeToleranceMinutes,
      240,
    ),
    breakDurationMinutes: parseNonNegativeInteger(
      candidate.breakDurationMinutes,
      DEFAULT_TIME_CLOCK_SETTINGS.breakDurationMinutes,
      720,
    ),
    breakReminderBeforeMinutes: parseNonNegativeInteger(
      candidate.breakReminderBeforeMinutes,
      DEFAULT_TIME_CLOCK_SETTINGS.breakReminderBeforeMinutes,
      120,
    ),
    nightStartTime: normalizeTimeValue(candidate.nightStartTime, DEFAULT_TIME_CLOCK_SETTINGS.nightStartTime),
    nightEndTime: normalizeTimeValue(candidate.nightEndTime, DEFAULT_TIME_CLOCK_SETTINGS.nightEndTime),
    blockCloseWithIncompleteDays: typeof candidate.blockCloseWithIncompleteDays === "boolean"
      ? candidate.blockCloseWithIncompleteDays
      : DEFAULT_TIME_CLOCK_SETTINGS.blockCloseWithIncompleteDays,
    blockCloseWithAbsences: typeof candidate.blockCloseWithAbsences === "boolean"
      ? candidate.blockCloseWithAbsences
      : DEFAULT_TIME_CLOCK_SETTINGS.blockCloseWithAbsences,
    blockCloseWithOutOfRangeAttempts: typeof candidate.blockCloseWithOutOfRangeAttempts === "boolean"
      ? candidate.blockCloseWithOutOfRangeAttempts
      : DEFAULT_TIME_CLOCK_SETTINGS.blockCloseWithOutOfRangeAttempts,
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
  crmKanban: normalizeCrmKanban(DEFAULT_CRM_STAGES),
  timeClock: normalizeTimeClockSettings(DEFAULT_TIME_CLOCK_SETTINGS),
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
    crmKanban: normalizeCrmKanban(candidate.crmKanban),
    timeClock: normalizeTimeClockSettings(candidate.timeClock),
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
  const resolvedRoute = ROUTE_ALIASES[route] ?? route;
  const allowed = roleRoutes[role] ?? [];
  if (resolvedRoute === "/") return allowed.includes("/");
  return allowed.some((currentRoute) => currentRoute !== "/" && resolvedRoute.startsWith(currentRoute));
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
