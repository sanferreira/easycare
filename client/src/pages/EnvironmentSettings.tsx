import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  SHIFT_ASSIGNMENT_TYPE_VALUES,
  MODULE_ROUTE_VALUES,
  getShiftProfileRule,
  normalizeEnvironmentSettings,
  type EnvironmentSettings,
  type ModuleRoute,
  type ShiftAssignmentType,
} from "@shared/environment";
import { useAuth } from "@/hooks/use-auth";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "@/hooks/use-environment-settings";
import { ROLE_LABELS, canEditRoute } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const MODULE_LABELS: Record<ModuleRoute, string> = {
  "/": "Dashboard",
  "/residents": "Pacientes",
  "/prontuario": "Prontuário",
  "/staff": "Equipe",
  "/escalas": "Escalas",
  "/ponto-eletronico": "Ponto eletrônico",
  "/occurrences": "Ocorrências (prontuario)",
  "/financeiro": "Financeiro",
  "/crm": "CRM",
  "/environment": "Configuracao de ambiente",
  "/audit": "Auditoria",
};

const SHIFT_TYPE_LABELS: Record<ShiftAssignmentType, string> = {
  "12h_manha": "12h Manha",
  "12h_noite": "12h Noite",
  "24h": "24h",
  avulso: "Avulso",
};

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseRuleNumberInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function profileLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "flexivel") return "Flexivel";
  if (normalized === "12x36") return "12x36";
  if (normalized === "comercial") return "Comercial";
  return value;
}

function roleLabel(value: string): string {
  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function sortRouteMap(routeMap: EnvironmentSettings["roleRoutes"]): EnvironmentSettings["roleRoutes"] {
  const sortedRoles = Object.keys(routeMap).sort((left, right) => left.localeCompare(right));
  const result: EnvironmentSettings["roleRoutes"] = {};
  for (const role of sortedRoles) {
    result[role] = Array.from(new Set(routeMap[role])) as ModuleRoute[];
  }
  return result;
}

function buildInitialDraft(settings?: EnvironmentSettings): EnvironmentSettings {
  return normalizeEnvironmentSettings(settings ?? DEFAULT_ENVIRONMENT_SETTINGS);
}

export default function EnvironmentSettingsPage() {
  const { user } = useAuth();
  const { data: settings, isLoading } = useEnvironmentSettings();
  const updateMutation = useUpdateEnvironmentSettings();
  const [draft, setDraft] = useState<EnvironmentSettings>(buildInitialDraft());
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newShiftProfile, setNewShiftProfile] = useState("");

  useEffect(() => {
    if (settings) setDraft(buildInitialDraft(settings));
  }, [settings]);

  const roleKeys = useMemo(
    () => Array.from(
      new Set([
        ...Object.keys(draft.roleRoutes),
        ...Object.keys(draft.roleEditRoutes),
      ]),
    ).sort((left, right) => left.localeCompare(right)),
    [draft.roleRoutes, draft.roleEditRoutes],
  );
  const roleLabelMap = useMemo(
    () => new Map(draft.availableStaffRoles.map((option) => [option.value, option.label] as const)),
    [draft.availableStaffRoles],
  );

  const shiftProfiles = useMemo(() => {
    const all = new Set<string>([
      ...draft.shiftProfiles.available,
      ...draft.shiftProfiles.scheduleConfigurable,
      ...Object.keys(draft.shiftProfiles.rules ?? {}),
    ]);
    return Array.from(all).sort((left, right) => left.localeCompare(right));
  }, [draft.shiftProfiles.available, draft.shiftProfiles.scheduleConfigurable, draft.shiftProfiles.rules]);
  const canEditEnvironment = useMemo(
    () =>
      user?.isSuperAdmin
      || canEditRoute(
        user?.role,
        "/environment",
        settings?.roleRoutes,
        settings?.roleEditRoutes,
      ),
    [user?.isSuperAdmin, user?.role, settings?.roleRoutes, settings?.roleEditRoutes],
  );

  const toggleModuleViewPermission = (role: string, route: ModuleRoute, checked: boolean) => {
    setDraft((current) => {
      const currentViewRoutes = current.roleRoutes[role] ?? [];
      const currentEditRoutes = current.roleEditRoutes[role] ?? [];
      const nextViewRoutes = checked
        ? Array.from(new Set([...currentViewRoutes, route]))
        : currentViewRoutes.filter((item) => item !== route);
      const nextEditRoutes = checked
        ? currentEditRoutes
        : currentEditRoutes.filter((item) => item !== route);
      return {
        ...current,
        roleRoutes: sortRouteMap({
          ...current.roleRoutes,
          [role]: nextViewRoutes,
        }),
        roleEditRoutes: sortRouteMap({
          ...current.roleEditRoutes,
          [role]: nextEditRoutes,
        }),
      };
    });
  };

  const toggleModuleEditPermission = (role: string, route: ModuleRoute, checked: boolean) => {
    setDraft((current) => {
      const currentViewRoutes = current.roleRoutes[role] ?? [];
      const currentEditRoutes = current.roleEditRoutes[role] ?? [];
      const nextEditRoutes = checked
        ? Array.from(new Set([...currentEditRoutes, route]))
        : currentEditRoutes.filter((item) => item !== route);
      const nextViewRoutes = checked
        ? Array.from(new Set([...currentViewRoutes, route]))
        : currentViewRoutes;
      return {
        ...current,
        roleRoutes: sortRouteMap({
          ...current.roleRoutes,
          [role]: nextViewRoutes,
        }),
        roleEditRoutes: sortRouteMap({
          ...current.roleEditRoutes,
          [role]: nextEditRoutes,
        }),
      };
    });
  };

  const updateRoleOption = (index: number, key: "label" | "value", value: string) => {
    setDraft((current) => {
      const next = [...current.availableStaffRoles];
      const currentItem = next[index];
      if (!currentItem) return current;
      const nextValue = key === "value" ? toSlug(value) : currentItem.value;
      const nextLabel = key === "label" ? value : currentItem.label;
      if (!nextValue) return current;
      if (
        next.some((option, currentIndex) =>
          currentIndex !== index && option.value.toLowerCase() === nextValue.toLowerCase(),
        )
      ) {
        return current;
      }
      next[index] = {
        value: nextValue,
        label: nextLabel,
      };

      const nextRoleRoutes = { ...current.roleRoutes };
      const nextRoleEditRoutes = { ...current.roleEditRoutes };
      if (currentItem.value !== nextValue) {
        const previousRoutes = nextRoleRoutes[currentItem.value];
        const previousEditRoutes = nextRoleEditRoutes[currentItem.value];
        delete nextRoleRoutes[currentItem.value];
        delete nextRoleEditRoutes[currentItem.value];
        if (!nextRoleRoutes[nextValue]) {
          nextRoleRoutes[nextValue] = previousRoutes ?? ["/"];
        }
        if (!nextRoleEditRoutes[nextValue]) {
          nextRoleEditRoutes[nextValue] = previousEditRoutes ?? nextRoleRoutes[nextValue] ?? ["/"];
        }
      } else if (!nextRoleRoutes[nextValue]) {
        nextRoleRoutes[nextValue] = ["/"];
      } else if (!nextRoleEditRoutes[nextValue]) {
        nextRoleEditRoutes[nextValue] = [...nextRoleRoutes[nextValue]];
      }

      return {
        ...current,
        roleRoutes: sortRouteMap(nextRoleRoutes),
        roleEditRoutes: sortRouteMap(nextRoleEditRoutes),
        availableStaffRoles: next,
      };
    });
  };

  const addRoleOption = () => {
    const label = newRoleLabel.trim();
    const value = toSlug(label);
    if (!label || !value) return;
    setDraft((current) => {
      const alreadyExistsInStaff = current.availableStaffRoles.some((option) => option.value === value);
      const alreadyExistsInRoutes = Boolean(current.roleRoutes[value]);
      const alreadyExistsInEditRoutes = Boolean(current.roleEditRoutes[value]);
      if (alreadyExistsInStaff && alreadyExistsInRoutes && alreadyExistsInEditRoutes) return current;
      const defaultRoutes = current.roleRoutes[value] ?? ["/"];
      return {
        ...current,
        roleRoutes: sortRouteMap({
          ...current.roleRoutes,
          [value]: defaultRoutes,
        }),
        roleEditRoutes: sortRouteMap({
          ...current.roleEditRoutes,
          [value]: alreadyExistsInEditRoutes ? (current.roleEditRoutes[value] ?? defaultRoutes) : defaultRoutes,
        }),
        availableStaffRoles: alreadyExistsInStaff
          ? current.availableStaffRoles
          : [...current.availableStaffRoles, { value, label }],
      };
    });
    setNewRoleLabel("");
  };

  const removeRoleOption = (index: number) => {
    setDraft((current) => {
      const currentOption = current.availableStaffRoles[index];
      if (!currentOption) return current;
      const nextRoleRoutes = { ...current.roleRoutes };
      const nextRoleEditRoutes = { ...current.roleEditRoutes };
      delete nextRoleRoutes[currentOption.value];
      delete nextRoleEditRoutes[currentOption.value];
      return {
        ...current,
        roleRoutes: sortRouteMap(nextRoleRoutes),
        roleEditRoutes: sortRouteMap(nextRoleEditRoutes),
        availableStaffRoles: current.availableStaffRoles.filter((_, currentIndex) => currentIndex !== index),
      };
    });
  };

  const toggleShiftAvailability = (profile: string, checked: boolean) => {
    setDraft((current) => {
      const availableSet = new Set(current.shiftProfiles.available);
      const configurableSet = new Set(current.shiftProfiles.scheduleConfigurable);
      const nextRules = { ...current.shiftProfiles.rules };
      if (checked) {
        availableSet.add(profile);
        if (!nextRules[profile]) {
          nextRules[profile] = getShiftProfileRule(profile, current.shiftProfiles);
        }
      } else {
        availableSet.delete(profile);
        configurableSet.delete(profile);
        delete nextRules[profile];
      }
      return {
        ...current,
        shiftProfiles: {
          available: Array.from(availableSet),
          scheduleConfigurable: Array.from(configurableSet),
          rules: nextRules,
        },
      };
    });
  };

  const toggleShiftScheduleConfigurability = (profile: string, checked: boolean) => {
    setDraft((current) => {
      const configurableSet = new Set(current.shiftProfiles.scheduleConfigurable);
      if (checked) configurableSet.add(profile);
      else configurableSet.delete(profile);
      return {
        ...current,
        shiftProfiles: {
          ...current.shiftProfiles,
          scheduleConfigurable: Array.from(configurableSet),
          rules: current.shiftProfiles.rules,
        },
      };
    });
  };

  const updateShiftRule = (
    profile: string,
    updates: Partial<EnvironmentSettings["shiftProfiles"]["rules"][string]>,
  ) => {
    setDraft((current) => {
      const currentRule = getShiftProfileRule(profile, current.shiftProfiles);
      return {
        ...current,
        shiftProfiles: {
          ...current.shiftProfiles,
          rules: {
            ...current.shiftProfiles.rules,
            [profile]: {
              ...currentRule,
              ...updates,
            },
          },
        },
      };
    });
  };

  const toggleShiftTypeForRule = (profile: string, shiftType: ShiftAssignmentType, checked: boolean) => {
    setDraft((current) => {
      const currentRule = getShiftProfileRule(profile, current.shiftProfiles);
      const allowed = new Set(currentRule.allowedShiftTypes);
      if (checked) {
        allowed.add(shiftType);
      } else {
        allowed.delete(shiftType);
      }
      return {
        ...current,
        shiftProfiles: {
          ...current.shiftProfiles,
          rules: {
            ...current.shiftProfiles.rules,
            [profile]: {
              ...currentRule,
              allowedShiftTypes: Array.from(allowed),
            },
          },
        },
      };
    });
  };

  const addShiftProfile = () => {
    const value = toSlug(newShiftProfile);
    if (!value) return;
    setDraft((current) => {
      if (current.shiftProfiles.available.includes(value)) return current;
      return {
        ...current,
        shiftProfiles: {
          available: [...current.shiftProfiles.available, value],
          scheduleConfigurable: [...current.shiftProfiles.scheduleConfigurable, value],
          rules: {
            ...current.shiftProfiles.rules,
            [value]: getShiftProfileRule(value, current.shiftProfiles),
          },
        },
      };
    });
    setNewShiftProfile("");
  };

  const removeShiftProfile = (profile: string) => {
    setDraft((current) => ({
      ...current,
      shiftProfiles: {
        available: current.shiftProfiles.available.filter((item) => item !== profile),
        scheduleConfigurable: current.shiftProfiles.scheduleConfigurable.filter((item) => item !== profile),
        rules: Object.fromEntries(
          Object.entries(current.shiftProfiles.rules).filter(([key]) => key !== profile),
        ),
      },
    }));
  };

  const handleSave = () => {
    if (!canEditEnvironment) return;
    updateMutation.mutate(normalizeEnvironmentSettings(draft));
  };

  const handleReset = () => {
    setDraft(buildInitialDraft(settings));
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Carregando configurações...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground">Configuracao de Ambiente</h1>
          <p className="text-muted-foreground mt-1">
            Defina permissoes por papel, cargos da equipe e perfis de jornada da organização.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleReset} disabled={updateMutation.isPending}>
            Recarregar
          </Button>
          <Button type="button" onClick={handleSave} disabled={updateMutation.isPending || !canEditEnvironment}>
            <Save className="h-4 w-4 mr-2" />
            Salvar
          </Button>
        </div>
      </div>

      {!canEditEnvironment && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Seu perfil está em modo de visualização neste módulo. Alterações e salvamentos estão bloqueados.
        </div>
      )}

      <div className={canEditEnvironment ? "space-y-6" : "space-y-6 pointer-events-none opacity-70"}>
      <Card>
        <CardHeader>
          <CardTitle>Papeis/Cargos e permissoes por modulo</CardTitle>
          <CardDescription>
            Cadastre papeis/cargos e separe acesso de visualizacao e edição por modulo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Papeis/Cargos da equipe</p>
              <p className="text-xs text-muted-foreground">
                Ao criar, editar ou remover um cargo, o papel do sistema e atualizado automaticamente.
              </p>
            </div>

            {draft.availableStaffRoles.map((option, index) => (
              <div key={`${option.value}-${index}`} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  value={option.label}
                  onChange={(event) => updateRoleOption(index, "label", event.target.value)}
                  placeholder="Nome exibido"
                />
                <Input
                  value={option.value}
                  onChange={(event) => updateRoleOption(index, "value", event.target.value)}
                  placeholder="Valor interno"
                />
                <Button type="button" variant="ghost" onClick={() => removeRoleOption(index)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex gap-2">
              <Input
                value={newRoleLabel}
                onChange={(event) => setNewRoleLabel(event.target.value)}
                placeholder="Novo papel/cargo"
                className="max-w-sm"
              />
              <Button type="button" variant="outline" onClick={addRoleOption}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {roleKeys.map((role) => (
              <div key={`permissions-${role}`} className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-muted/50 border-b border-border">
                  <p className="text-sm font-semibold">
                    {ROLE_LABELS[role] ?? roleLabelMap.get(role) ?? roleLabel(role)}
                  </p>
                  <p className="text-xs text-muted-foreground">{role}</p>
                </div>
                <div className="divide-y divide-border">
                  {MODULE_ROUTE_VALUES.map((route) => {
                    const canView = draft.roleRoutes[role]?.includes(route) ?? false;
                    const canEdit = draft.roleEditRoutes[role]?.includes(route) ?? false;
                    return (
                      <div
                        key={`permissions-${role}-${route}`}
                        className="px-3 py-2 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-center"
                      >
                        <span className="text-sm text-foreground">{MODULE_LABELS[route]}</span>
                        <div className="flex items-center justify-between sm:justify-end gap-2">
                          <span className="text-[11px] text-muted-foreground">Ver</span>
                          <Switch
                            checked={canView}
                            onCheckedChange={(nextChecked) => toggleModuleViewPermission(role, route, nextChecked)}
                          />
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-2">
                          <span className="text-[11px] text-muted-foreground">Editar</span>
                          <Switch
                            checked={canEdit}
                            onCheckedChange={(nextChecked) => toggleModuleEditPermission(role, route, nextChecked)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Perfis de jornada</CardTitle>
          <CardDescription>
            Defina quais perfis podem ser usados e quais abrem agenda recorrente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {shiftProfiles.map((profile) => {
            const available = draft.shiftProfiles.available.includes(profile);
            const scheduleConfigurable = draft.shiftProfiles.scheduleConfigurable.includes(profile);
            const rule = getShiftProfileRule(profile, draft.shiftProfiles);
            const hasRule = rule.enabled;
            return (
              <div
                key={profile}
                className="space-y-3 rounded-lg border border-border p-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-center">
                  <div>
                    <p className="font-medium">{profileLabel(profile)}</p>
                    <p className="text-xs text-muted-foreground">{profile}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Disponivel</span>
                    <Switch
                      checked={available}
                      onCheckedChange={(checked) => toggleShiftAvailability(profile, checked)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Agenda recorrente</span>
                    <Switch
                      checked={scheduleConfigurable}
                      disabled={!available}
                      onCheckedChange={(checked) => toggleShiftScheduleConfigurability(profile, checked)}
                    />
                  </div>
                  <Button type="button" variant="ghost" onClick={() => removeShiftProfile(profile)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="rounded-lg border border-border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Aplicar regra deste perfil</span>
                    <Switch
                      checked={hasRule}
                      onCheckedChange={(checked) => updateShiftRule(profile, { enabled: checked })}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Horas por plantão</p>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={rule.exactShiftHours ?? ""}
                        disabled={!hasRule}
                        onChange={(event) =>
                          updateShiftRule(profile, {
                            exactShiftHours: parseRuleNumberInput(event.target.value),
                          })}
                        placeholder="Ex: 12"
                      />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Descanso mínimo (horas)</p>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={rule.minRestHours ?? ""}
                        disabled={!hasRule}
                        onChange={(event) =>
                          updateShiftRule(profile, {
                            minRestHours: parseRuleNumberInput(event.target.value),
                          })}
                        placeholder="Ex: 36"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Tipos de plantão permitidos</p>
                    <div className="flex flex-wrap gap-2">
                      {SHIFT_ASSIGNMENT_TYPE_VALUES.map((shiftType) => {
                        const active = rule.allowedShiftTypes.includes(shiftType);
                        return (
                          <Button
                            key={`${profile}-${shiftType}`}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            disabled={!hasRule}
                            onClick={() => toggleShiftTypeForRule(profile, shiftType, !active)}
                          >
                            {SHIFT_TYPE_LABELS[shiftType]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {hasRule
                      ? `Regra ativa${rule.exactShiftHours ? `: plantão de ${rule.exactShiftHours}h` : ""}${rule.minRestHours ? ` e descanso mínimo de ${rule.minRestHours}h` : ""}.`
                      : "Sem regra fixa: o perfil aceita qualquer tipo de plantão e descanso, respeitando apenas conflitos de horário."}
                  </p>
                </div>
              </div>
            );
          })}

          <div className="flex gap-2">
            <Input
              value={newShiftProfile}
              onChange={(event) => setNewShiftProfile(event.target.value)}
              placeholder="Novo perfil (ex: parcial)"
              className="max-w-sm"
            />
            <Button type="button" variant="outline" onClick={addShiftProfile}>
              <Plus className="h-4 w-4 mr-2" />
              Adicionar perfil
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
