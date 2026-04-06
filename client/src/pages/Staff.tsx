import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStaff, useCreateStaff, useUpdateStaff } from "@/hooks/use-staff";
import { useEnvironmentSettings } from "@/hooks/use-environment-settings";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeOff, Plus, Trash2, UserCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { staffFormSchema, type StaffFormInput, type StaffMember } from "@shared/schema";
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  getShiftProfileRule,
  normalizeShiftProfileKey,
  type ShiftProfileRule,
} from "@shared/environment";
import { digitsOnly, maskCep, maskCnpj, maskCpf, maskPhoneBR } from "@/lib/masks";
import { imageFileToDataUrl } from "@/lib/imageUpload";

type WeekdayKey =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

type WorkScheduleSlot = {
  start: string;
  end: string;
};

type WorkScheduleRule = {
  enabled: boolean;
  slots: WorkScheduleSlot[];
};

type ProfileCycleStartType = "12h_manha" | "12h_noite" | null;

type WorkScheduleConfig = {
  version: 1;
  weekly: Record<WeekdayKey, WorkScheduleRule>;
  oddDays: WorkScheduleRule;
  evenDays: WorkScheduleRule;
  blockedDates: string[];
  profileCycleStart: ProfileCycleStartType;
};

type ShiftProfileOption = {
  value: string;
  label: string;
  description: string;
};

const WEEKDAY_ROWS: Array<{ key: WeekdayKey; label: string }> = [
  { key: "sunday", label: "Domingo" },
  { key: "monday", label: "Segunda" },
  { key: "tuesday", label: "Terca" },
  { key: "wednesday", label: "Quarta" },
  { key: "thursday", label: "Quinta" },
  { key: "friday", label: "Sexta" },
  { key: "saturday", label: "Sabado" },
];

const DEFAULT_SLOT: WorkScheduleSlot = { start: "08:00", end: "17:00" };

const createRule = (enabled = false): WorkScheduleRule => ({
  enabled,
  slots: enabled ? [{ ...DEFAULT_SLOT }] : [],
});

const createEmptyWorkSchedule = (): WorkScheduleConfig => ({
  version: 1,
  weekly: createEmptyWeeklySchedule(),
  oddDays: createRule(false),
  evenDays: createRule(false),
  blockedDates: [],
  profileCycleStart: null,
});

const createEmptyWeeklySchedule = (): Record<WeekdayKey, WorkScheduleRule> => ({
  sunday: createRule(false),
  monday: createRule(false),
  tuesday: createRule(false),
  wednesday: createRule(false),
  thursday: createRule(false),
  friday: createRule(false),
  saturday: createRule(false),
});

const DATE_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0][1-9]|[12]\d|3[01])$/;

const isValidClock = (value: string): boolean => /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);

const normalizeRule = (raw: unknown): WorkScheduleRule => {
  if (!raw || typeof raw !== "object") return createRule(false);
  const candidate = raw as { enabled?: unknown; slots?: unknown };
  const slots = Array.isArray(candidate.slots)
    ? candidate.slots
        .map((slot) => {
          if (!slot || typeof slot !== "object") return null;
          const current = slot as { start?: unknown; end?: unknown };
          if (typeof current.start !== "string" || typeof current.end !== "string") return null;
          if (!isValidClock(current.start) || !isValidClock(current.end)) return null;
          return { start: current.start, end: current.end };
        })
        .filter((slot): slot is WorkScheduleSlot => !!slot)
    : [];
  const enabled = Boolean(candidate.enabled);
  return {
    enabled,
    slots: enabled ? (slots.length > 0 ? slots : [{ ...DEFAULT_SLOT }]) : slots,
  };
};

const parseWorkSchedule = (value?: string | null): WorkScheduleConfig => {
  const emptySchedule = createEmptyWorkSchedule();
  if (!value || typeof value !== "string") return emptySchedule;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const rawWeekly = parsed.weekly && typeof parsed.weekly === "object"
      ? (parsed.weekly as Record<string, unknown>)
      : {};
    return {
      version: 1,
      weekly: WEEKDAY_ROWS.reduce<Record<WeekdayKey, WorkScheduleRule>>((acc, day) => {
        acc[day.key] = normalizeRule(rawWeekly[day.key]);
        return acc;
      }, {} as Record<WeekdayKey, WorkScheduleRule>),
      oddDays: normalizeRule(parsed.oddDays),
      evenDays: normalizeRule(parsed.evenDays),
      blockedDates: Array.isArray(parsed.blockedDates)
        ? parsed.blockedDates
            .filter((date): date is string => typeof date === "string" && DATE_KEY_REGEX.test(date))
            .filter((date, index, source) => source.indexOf(date) === index)
            .sort()
        : [],
      profileCycleStart:
        parsed.profileCycleStart === "12h_manha" || parsed.profileCycleStart === "12h_noite"
          ? parsed.profileCycleStart
          : null,
    };
  } catch {
    return emptySchedule;
  }
};

const hasAnyWorkSchedule = (schedule: WorkScheduleConfig): boolean => {
  const weeklyHasEntries = WEEKDAY_ROWS.some((day) => {
    const rule = schedule.weekly[day.key];
    return rule.enabled && rule.slots.length > 0;
  });
  const oddHasEntries = schedule.oddDays.enabled && schedule.oddDays.slots.length > 0;
  const evenHasEntries = schedule.evenDays.enabled && schedule.evenDays.slots.length > 0;
  return weeklyHasEntries || oddHasEntries || evenHasEntries || schedule.blockedDates.length > 0;
};

const hasWorkScheduleMetadata = (schedule: WorkScheduleConfig): boolean =>
  schedule.profileCycleStart === "12h_manha" || schedule.profileCycleStart === "12h_noite";

const validateRule = (rule: WorkScheduleRule): boolean =>
  !rule.enabled
  || (rule.slots.length > 0
    && rule.slots.every((slot) =>
      isValidClock(slot.start) && isValidClock(slot.end) && slot.start !== slot.end,
    ));

type ViaCepPayload = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

function normalizeEmploymentType(value?: string | null): "clt" | "pj" {
  return String(value || "").trim().toLowerCase() === "pj" ? "pj" : "clt";
}

function normalizeShiftProfile(value?: string | null): string {
  const normalized = normalizeShiftProfileKey(value || "");
  if (!normalized) return "flexivel";
  return normalized;
}

function normalizeStaffRoleValue(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function dedupeStaffRoleOptions(
  options: Array<{ value: string; label: string }>,
): Array<{ value: string; label: string }> {
  const roleMap = new Map<string, string>();
  for (const option of options) {
    const normalizedValue = normalizeStaffRoleValue(option.value);
    if (!normalizedValue || roleMap.has(normalizedValue)) continue;
    roleMap.set(normalizedValue, option.label.trim() || toTitleCase(normalizedValue));
  }

  if (roleMap.size === 0) {
    roleMap.set("cuidador", "Cuidador");
  }

  return Array.from(roleMap.entries()).map(([value, label]) => ({ value, label }));
}

function toTitleCase(value: string): string {
  return value
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function getShiftProfileLabel(
  value?: string | null,
  options: ShiftProfileOption[] = [],
): string {
  const normalized = normalizeShiftProfile(value);
  return options.find((option) => option.value === normalized)?.label ?? toTitleCase(normalized);
}

function describeShiftProfileRule(rule: ShiftProfileRule): string {
  if (!rule.enabled) {
    return "Sem regra fixa de duracao/descanso para este perfil.";
  }
  const parts: string[] = [];
  if (rule.exactShiftHours) {
    parts.push(`plantao de ${rule.exactShiftHours}h`);
  }
  if (rule.minRestHours) {
    parts.push(`descanso minimo de ${rule.minRestHours}h`);
  }
  if (rule.allowedShiftTypes.length > 0) {
    parts.push(`tipos permitidos: ${rule.allowedShiftTypes.join(", ")}`);
  }
  if (parts.length === 0) return "Regra ativa para este perfil.";
  return `Regra ativa: ${parts.join(" | ")}.`;
}

function buildShiftProfileOptions(
  values: string[],
  rules: Record<string, ShiftProfileRule>,
): ShiftProfileOption[] {
  const uniqueValues = values
    .map((value) => normalizeShiftProfile(value))
    .filter((value, index, source) => value.length > 0 && source.indexOf(value) === index);
  const safeValues = uniqueValues.length > 0 ? uniqueValues : ["flexivel"];
  return safeValues.map((value) => ({
    value,
    label: getShiftProfileLabel(value),
    description: describeShiftProfileRule(
      getShiftProfileRule(value, { available: safeValues, scheduleConfigurable: [], rules }),
    ),
  }));
}

function getStaffDocument(member: StaffMember): string {
  const employmentType = normalizeEmploymentType(member.employmentType);
  if (employmentType === "pj") return member.cnpj || "-";
  return member.cpf || "-";
}

function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function getWorkScheduleSummary(raw?: string | null): string {
  const schedule = parseWorkSchedule(raw);
  const weeklyCount = WEEKDAY_ROWS.reduce((acc, day) => {
    const rule = schedule.weekly[day.key];
    if (!rule.enabled) return acc;
    return acc + (rule.slots.length || 0);
  }, 0);
  const oddCount = schedule.oddDays.enabled ? schedule.oddDays.slots.length : 0;
  const evenCount = schedule.evenDays.enabled ? schedule.evenDays.slots.length : 0;
  const blockedCount = schedule.blockedDates.length;
  const total = weeklyCount + oddCount + evenCount;
  if (total === 0 && blockedCount === 0) return "Sem agenda recorrente";
  if (blockedCount === 0) return `${total} faixa(s) de horario`;
  return `${total} faixa(s) de horario - ${blockedCount} excecao(oes)`;
}

async function fetchAddressByCep(cep: string): Promise<{ cep: string; address: string }> {
  const normalizedCep = digitsOnly(cep);
  if (normalizedCep.length !== 8) {
    throw new Error("Informe um CEP valido com 8 digitos.");
  }

  const response = await fetch(`https://viacep.com.br/ws/${normalizedCep}/json/`);
  if (!response.ok) throw new Error("Nao foi possivel consultar o ViaCEP.");

  const data: ViaCepPayload = await response.json();
  if (data.erro) throw new Error("CEP nao encontrado.");

  const cityAndUf = [data.localidade, data.uf].filter(Boolean).join("/");
  const addressParts = [data.logradouro, data.bairro, cityAndUf].filter(Boolean);

  return {
    cep: maskCep(data.cep || normalizedCep),
    address: addressParts.join(" - "),
  };
}

export default function Staff() {
  const { data: staff, isLoading } = useStaff();
  const { data: environmentSettings } = useEnvironmentSettings();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirmDialog();
  const rawStaffRoleOptions = environmentSettings?.availableStaffRoles
    ?? DEFAULT_ENVIRONMENT_SETTINGS.availableStaffRoles;
  const staffRoleOptions = useMemo(
    () => dedupeStaffRoleOptions(rawStaffRoleOptions),
    [rawStaffRoleOptions],
  );
  const configuredShiftProfiles = environmentSettings?.shiftProfiles
    ?? DEFAULT_ENVIRONMENT_SETTINGS.shiftProfiles;
  const shiftProfileOptions = buildShiftProfileOptions(
    configuredShiftProfiles.available,
    configuredShiftProfiles.rules,
  );

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/staff/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir colaborador");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Colaborador excluido" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir colaborador" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground">Equipe</h1>
          <p className="text-muted-foreground mt-1">Colaboradores da instituicao.</p>
        </div>
        <Button
          onClick={() => {
            setEditingStaff(null);
            setIsDialogOpen(true);
          }}
          className="shadow-lg shadow-primary/20"
        >
          <Plus className="mr-2 h-4 w-4" /> Novo Colaborador
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Regime</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : staff?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Nenhum colaborador cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              staff?.map((member) => {
                const employmentType = normalizeEmploymentType(member.employmentType);
                return (
                  <TableRow key={member.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {member.photoUrl ? (
                          <img
                            src={member.photoUrl}
                            alt={member.name}
                            className="h-10 w-10 rounded-full object-cover border border-border"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold">
                            {member.name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{member.name}</div>
                          {member.portalAccess && (
                            <div className="text-[11px] text-primary font-medium">
                              Acesso ao portal ativo
                            </div>
                          )}
                          {member.phone && (
                            <div className="text-xs text-muted-foreground">{maskPhoneBR(member.phone)}</div>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            {getWorkScheduleSummary(member.workSchedule)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Plantao: {formatCurrencyBRL(Number(member.shiftValue ?? 0))}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{member.role}</TableCell>
                    <TableCell>{employmentType.toUpperCase()}</TableCell>
                    <TableCell className="text-xs">{getStaffDocument(member)}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border
                        ${
                          member.active
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-neutral-100 text-neutral-600 border-neutral-200"
                        }`}
                      >
                        {member.active ? "Ativo" : "Inativo"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingStaff(member);
                            setIsDialogOpen(true);
                          }}
                          data-testid={`button-edit-staff-${member.id}`}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            confirm({
                              title: "Excluir colaborador",
                              description: `Excluir "${member.name}" da equipe? Esta ação não pode ser desfeita.`,
                              confirmText: "Excluir",
                              pendingText: "Excluindo...",
                              variant: "destructive",
                              onConfirm: () => deleteMutation.mutateAsync(member.id),
                            });
                          }}
                          data-testid={`button-delete-staff-${member.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <StaffDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        staff={editingStaff}
        staffRoleOptions={staffRoleOptions}
        shiftProfileOptions={shiftProfileOptions}
        scheduleConfigurableProfiles={configuredShiftProfiles.scheduleConfigurable}
        shiftProfileRules={configuredShiftProfiles.rules}
      />
      {confirmDialog}
    </div>
  );
}

function StaffDialog({
  open,
  onOpenChange,
  staff,
  staffRoleOptions,
  shiftProfileOptions,
  scheduleConfigurableProfiles,
  shiftProfileRules,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffMember | null;
  staffRoleOptions: Array<{ value: string; label: string }>;
  shiftProfileOptions: ShiftProfileOption[];
  scheduleConfigurableProfiles: string[];
  shiftProfileRules: Record<string, ShiftProfileRule>;
}) {
  const createMutation = useCreateStaff();
  const updateMutation = useUpdateStaff();
  const { toast } = useToast();
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [isLookingUpCep, setIsLookingUpCep] = useState(false);
  const [portalPassword, setPortalPassword] = useState("");
  const [showPortalPassword, setShowPortalPassword] = useState(false);
  const [workSchedule, setWorkSchedule] = useState<WorkScheduleConfig>(createEmptyWorkSchedule());
  const initializedFormKeyRef = useRef<string | null>(null);
  const normalizedScheduleConfigurableProfiles = useMemo(
    () => new Set(scheduleConfigurableProfiles.map((profile) => normalizeShiftProfile(profile))),
    [scheduleConfigurableProfiles],
  );
  const fallbackShiftProfile = shiftProfileOptions[0]?.value ?? "flexivel";
  const fallbackStaffRole = staffRoleOptions[0]?.value ?? "cuidador";

  type StaffDialogFormInput = StaffFormInput & { portalPassword?: string };

  const defaultValues: StaffDialogFormInput = {
    name: "",
    role: fallbackStaffRole,
    shift: fallbackShiftProfile,
    employmentType: "clt",
    cpf: "",
    cnpj: "",
    shiftValue: 0,
    phone: "",
    cep: "",
    address: "",
    email: "",
    portalAccess: false,
    portalUsername: "",
    portalUserId: null,
    active: true,
    photoUrl: "",
    workSchedule: "",
    portalPassword: "",
  };

  const form = useForm<StaffDialogFormInput>({
    resolver: zodResolver(staffFormSchema),
    defaultValues,
  });

  const employmentType = normalizeEmploymentType(form.watch("employmentType"));
  const selectedRole = normalizeStaffRoleValue(form.watch("role"));
  const effectiveStaffRoleOptions = useMemo(() => {
    const withFormSelection = staffRoleOptions.some((option) => option.value === selectedRole)
      ? staffRoleOptions
      : selectedRole
        ? [...staffRoleOptions, { value: selectedRole, label: toTitleCase(selectedRole) }]
        : staffRoleOptions;

    if (!staff) return withFormSelection;
    const staffRole = normalizeStaffRoleValue(staff.role);
    if (!staffRole) return withFormSelection;
    if (withFormSelection.some((option) => option.value === staffRole)) return withFormSelection;
    return dedupeStaffRoleOptions([
      ...withFormSelection,
      { value: staffRole, label: toTitleCase(staffRole) },
    ]);
  }, [selectedRole, staffRoleOptions, staff]);
  const selectedShiftProfile = normalizeShiftProfile(form.watch("shift"));
  const effectiveShiftProfileOptions = useMemo(() => {
    return shiftProfileOptions.some((option) => option.value === selectedShiftProfile)
      ? shiftProfileOptions
      : [
          ...shiftProfileOptions,
          {
            value: selectedShiftProfile,
            label: getShiftProfileLabel(selectedShiftProfile, shiftProfileOptions),
            description: describeShiftProfileRule(
              getShiftProfileRule(selectedShiftProfile, {
                available: shiftProfileOptions.map((option) => option.value),
                scheduleConfigurable: [],
                rules: shiftProfileRules,
              }),
            ),
          },
        ];
  }, [selectedShiftProfile, shiftProfileOptions, shiftProfileRules]);
  const canConfigureRecurringSchedule = normalizedScheduleConfigurableProfiles.has(selectedShiftProfile);
  const selectedShiftOption = effectiveShiftProfileOptions.find((option) => option.value === selectedShiftProfile);
  const selectedShiftRule = useMemo(
    () =>
      getShiftProfileRule(selectedShiftProfile, {
        available: effectiveShiftProfileOptions.map((option) => option.value),
        scheduleConfigurable: [],
        rules: shiftProfileRules,
      }),
    [selectedShiftProfile, effectiveShiftProfileOptions, shiftProfileRules],
  );
  const canChooseProfileCycleStart =
    selectedShiftRule.enabled
    && selectedShiftRule.allowedShiftTypes.includes("12h_manha")
    && selectedShiftRule.allowedShiftTypes.includes("12h_noite");
  const portalAccessEnabled = !!form.watch("portalAccess");
  const hasParityBasedSchedule = workSchedule.oddDays.enabled || workSchedule.evenDays.enabled;
  const photoPreview = form.watch("photoUrl");

  useEffect(() => {
    if (canChooseProfileCycleStart) return;
    if (!workSchedule.profileCycleStart) return;
    setWorkSchedule((current) => ({
      ...current,
      profileCycleStart: null,
    }));
  }, [canChooseProfileCycleStart, workSchedule.profileCycleStart]);

  useEffect(() => {
    if (portalAccessEnabled) return;
    if (portalPassword.length === 0) return;
    setPortalPassword("");
  }, [portalAccessEnabled, portalPassword.length]);

  useEffect(() => {
    if (!open) {
      initializedFormKeyRef.current = null;
      return;
    }

    const formKey = staff ? `edit:${staff.id}` : "create";
    if (initializedFormKeyRef.current === formKey) return;
    initializedFormKeyRef.current = formKey;

    if (staff) {
      const normalizedStaffRole = normalizeStaffRoleValue(staff.role);
      const safeStaffRole = staffRoleOptions.some((option) => option.value === normalizedStaffRole)
        ? normalizedStaffRole
        : (normalizedStaffRole || fallbackStaffRole);
      const normalizedStaffShift = normalizeShiftProfile(staff.shift);
      const safeShiftProfile = shiftProfileOptions.some((option) => option.value === normalizedStaffShift)
        ? normalizedStaffShift
        : fallbackShiftProfile;
      form.reset({
        ...defaultValues,
        ...staff,
        role: safeStaffRole,
        shift: safeShiftProfile,
        employmentType: normalizeEmploymentType(staff.employmentType),
        cpf: maskCpf(staff.cpf ?? ""),
        cnpj: maskCnpj(staff.cnpj ?? ""),
        shiftValue: Number.isFinite(Number(staff.shiftValue ?? 0)) ? Number(staff.shiftValue ?? 0) : 0,
        phone: maskPhoneBR(staff.phone ?? ""),
        cep: maskCep(staff.cep ?? ""),
        address: staff.address ?? "",
        photoUrl: staff.photoUrl ?? "",
        portalAccess: !!staff.portalAccess,
        portalUsername: staff.portalUsername ?? "",
      });
      setPortalPassword("");
      setShowPortalPassword(false);
      setWorkSchedule(parseWorkSchedule(staff.workSchedule));
      return;
    }

    form.reset(defaultValues);
    setPortalPassword("");
    setShowPortalPassword(false);
    setWorkSchedule(createEmptyWorkSchedule());
  }, [
    open,
    staff,
    defaultValues,
    fallbackShiftProfile,
    fallbackStaffRole,
    shiftProfileOptions,
    staffRoleOptions,
    form,
  ]);

  async function handleLookupCep() {
    const currentCep = form.getValues("cep");
    if (digitsOnly(currentCep || "").length !== 8) {
      form.setError("cep", { type: "manual", message: "Informe um CEP valido." });
      return;
    }

    setIsLookingUpCep(true);
    try {
      const address = await fetchAddressByCep(currentCep || "");
      form.setValue("cep", address.cep, { shouldDirty: true, shouldValidate: true });
      form.setValue("address", address.address, { shouldDirty: true, shouldValidate: true });
      toast({ title: "Endereco preenchido pelo CEP." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Nao foi possivel buscar o CEP.",
      });
    } finally {
      setIsLookingUpCep(false);
    }
  }

  async function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessingPhoto(true);
    try {
      const dataUrl = await imageFileToDataUrl(file);
      form.setValue("photoUrl", dataUrl, { shouldDirty: true, shouldValidate: true });
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao carregar foto.",
      });
    } finally {
      setIsProcessingPhoto(false);
      event.target.value = "";
    }
  }

  function updateWeeklyRule(day: WeekdayKey, updater: (current: WorkScheduleRule) => WorkScheduleRule) {
    setWorkSchedule((currentSchedule) => ({
      ...currentSchedule,
      weekly: {
        ...currentSchedule.weekly,
        [day]: updater(currentSchedule.weekly[day]),
      },
    }));
  }

  function updateParityRule(
    key: "oddDays" | "evenDays",
    updater: (current: WorkScheduleRule) => WorkScheduleRule,
  ) {
    setWorkSchedule((currentSchedule) => {
      const nextRule = updater(currentSchedule[key]);
      const nextSchedule: WorkScheduleConfig = {
        ...currentSchedule,
        [key]: nextRule,
      };
      if (nextRule.enabled) {
        nextSchedule.weekly = createEmptyWeeklySchedule();
      }
      return nextSchedule;
    });
  }

  function onSubmit(data: StaffFormInput) {
    const selectedEmploymentType = normalizeEmploymentType(data.employmentType);
    const selectedRoleKey = normalizeStaffRoleValue(data.role);
    const selectedProfile = normalizeShiftProfile(data.shift);
    const shiftValueNumber = Number(data.shiftValue ?? 0);
    const scheduleAllowedForProfile = normalizedScheduleConfigurableProfiles.has(selectedProfile);
    const cpfDigits = digitsOnly(data.cpf || "");
    const cnpjDigits = digitsOnly(data.cnpj || "");
    const cepDigits = digitsOnly(data.cep || "");

    if (selectedEmploymentType === "clt" && cpfDigits.length !== 11) {
      form.setError("cpf", { type: "manual", message: "CPF invalido para colaborador CLT." });
      return;
    }
    if (selectedEmploymentType === "pj" && cnpjDigits.length !== 14) {
      form.setError("cnpj", { type: "manual", message: "CNPJ invalido para colaborador PJ." });
      return;
    }
    if (cepDigits && cepDigits.length !== 8) {
      form.setError("cep", { type: "manual", message: "CEP deve ter 8 digitos." });
      return;
    }
    if (!selectedRoleKey) {
      form.setError("role", { type: "manual", message: "Selecione um cargo valido." });
      return;
    }
    if (!Number.isFinite(shiftValueNumber) || shiftValueNumber < 0) {
      form.setError("shiftValue", { type: "manual", message: "Valor do plantao invalido." });
      return;
    }

    if (scheduleAllowedForProfile) {
      const weeklyRuleInvalid = WEEKDAY_ROWS.some((day) => !validateRule(workSchedule.weekly[day.key]));
      const oddRuleInvalid = !validateRule(workSchedule.oddDays);
      const evenRuleInvalid = !validateRule(workSchedule.evenDays);
      if (weeklyRuleInvalid || oddRuleInvalid || evenRuleInvalid) {
        toast({
          variant: "destructive",
          title: "Agenda invalida. Revise horarios com inicio/fim corretos.",
        });
        return;
      }
    }

    const normalizedWorkSchedule: WorkScheduleConfig = scheduleAllowedForProfile
      ? { ...workSchedule }
      : {
          ...createEmptyWorkSchedule(),
          blockedDates: [...workSchedule.blockedDates],
          profileCycleStart: workSchedule.profileCycleStart,
        };
    if (!canChooseProfileCycleStart) {
      normalizedWorkSchedule.profileCycleStart = null;
    } else if (!normalizedWorkSchedule.profileCycleStart) {
      normalizedWorkSchedule.profileCycleStart = "12h_manha";
    }
    const shouldPersistWorkSchedule =
      hasAnyWorkSchedule(normalizedWorkSchedule)
      || hasWorkScheduleMetadata(normalizedWorkSchedule);

    const normalizedPortalUsername = (data.portalUsername ?? "").trim().toLowerCase();
    const normalizedPortalPassword = portalPassword.trim();
    const shouldEnablePortalAccess = !!data.portalAccess;

    if (shouldEnablePortalAccess && normalizedPortalUsername.length < 3) {
      form.setError("portalUsername", { type: "manual", message: "Informe um usuario com pelo menos 3 caracteres." });
      return;
    }
    if (shouldEnablePortalAccess && !staff?.portalUserId && !normalizedPortalPassword) {
      toast({
        variant: "destructive",
        title: "Senha obrigatoria para criar acesso ao portal.",
      });
      return;
    }

    const payload: StaffFormInput & { portalPassword?: string } = {
      ...data,
      name: data.name.trim(),
      role: selectedRoleKey,
      shift: selectedProfile,
      employmentType: selectedEmploymentType,
      cpf: selectedEmploymentType === "clt" ? (data.cpf?.trim() || null) : null,
      cnpj: selectedEmploymentType === "pj" ? (data.cnpj?.trim() || null) : null,
      shiftValue: Math.round((shiftValueNumber + Number.EPSILON) * 100) / 100,
      phone: data.phone?.trim() || null,
      cep: data.cep?.trim() || null,
      address: data.address?.trim() || null,
      email: data.email?.trim() || null,
      portalAccess: shouldEnablePortalAccess,
      portalUsername: shouldEnablePortalAccess ? normalizedPortalUsername : null,
      portalUserId: shouldEnablePortalAccess ? (data.portalUserId ?? null) : null,
      portalPassword: shouldEnablePortalAccess && normalizedPortalPassword
        ? normalizedPortalPassword
        : undefined,
      photoUrl: data.photoUrl?.trim() || null,
      workSchedule:
        shouldPersistWorkSchedule
          ? JSON.stringify(normalizedWorkSchedule)
          : null,
    };

    if (staff) {
      updateMutation.mutate(
        { id: staff.id, ...payload },
        {
          onSuccess: () => onOpenChange(false),
        },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => onOpenChange(false),
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{staff ? "Editar Colaborador" : "Novo Colaborador"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Foto do profissional</p>
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-xl border border-border overflow-hidden bg-muted flex items-center justify-center">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Foto do profissional" className="h-full w-full object-cover" />
                  ) : (
                    <UserCheck className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="space-y-2">
                  <Input type="file" accept="image/*" onChange={handlePhotoSelection} />
                  <div className="flex items-center gap-2">
                    {photoPreview && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => form.setValue("photoUrl", "", { shouldDirty: true, shouldValidate: true })}
                      >
                        Remover foto
                      </Button>
                    )}
                    {isProcessingPhoto && (
                      <span className="text-xs text-muted-foreground">Processando imagem...</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome completo *</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={15}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(maskPhoneBR(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cep"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CEP</FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <Input
                          {...field}
                          maxLength={9}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(maskCep(e.target.value))}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isLookingUpCep}
                          onClick={handleLookupCep}
                        >
                          Buscar
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endereco</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cargo *</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(normalizeStaffRoleValue(value))}
                      value={normalizeStaffRoleValue(field.value) || fallbackStaffRole}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o cargo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {effectiveStaffRoleOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="shift"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perfil de jornada *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={normalizeShiftProfile(field.value) || fallbackShiftProfile}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o perfil" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {effectiveShiftProfileOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {selectedShiftOption?.description}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {canChooseProfileCycleStart && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-foreground">Inicio do ciclo no gerador mensal</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Define se a primeira escala gerada no mes comeca em plantao diurno ou noturno.
                </p>
                <div className="mt-3">
                  <Select
                    value={workSchedule.profileCycleStart ?? "12h_manha"}
                    onValueChange={(value: "12h_manha" | "12h_noite") =>
                      setWorkSchedule((current) => ({
                        ...current,
                        profileCycleStart: value,
                      }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12h_manha">Inicia de manha (07:00)</SelectItem>
                      <SelectItem value="12h_noite">Inicia a noite (19:00)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {canConfigureRecurringSchedule ? (
              <div className="rounded-xl border border-border p-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground">Agenda recorrente de trabalho</p>
                <p className="text-xs text-muted-foreground">
                  Configure horários por dia da semana e também regras de dias pares/ímpares.
                </p>
                {hasParityBasedSchedule && (
                  <p className="text-xs text-amber-700 mt-1">
                    Dias pares/ímpares ativos: a grade por dia da semana fica desconsiderada.
                  </p>
                )}
              </div>

              <div className="space-y-3">
                {WEEKDAY_ROWS.map((day) => {
                  const dayRule = workSchedule.weekly[day.key];
                  return (
                    <div key={day.key} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{day.label}</p>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={hasParityBasedSchedule}
                            onClick={() =>
                              updateWeeklyRule(day.key, (rule) => ({
                                ...rule,
                                slots: [...rule.slots, { ...DEFAULT_SLOT }],
                                enabled: true,
                              }))
                            }
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Faixa
                          </Button>
                          <Switch
                            checked={dayRule.enabled}
                            disabled={hasParityBasedSchedule}
                            onCheckedChange={(checked) =>
                              updateWeeklyRule(day.key, (rule) => ({
                                ...rule,
                                enabled: checked,
                                slots: checked && rule.slots.length === 0
                                  ? [{ ...DEFAULT_SLOT }]
                                  : rule.slots,
                              }))
                            }
                          />
                        </div>
                      </div>

                      {dayRule.enabled && (
                        <div className="mt-3 space-y-2">
                          {dayRule.slots.map((slot, slotIndex) => (
                            <div key={`${day.key}-${slotIndex}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                              <Input
                                type="time"
                                value={slot.start}
                                disabled={hasParityBasedSchedule}
                                onChange={(event) =>
                                  updateWeeklyRule(day.key, (rule) => ({
                                    ...rule,
                                    slots: rule.slots.map((item, index) =>
                                      index === slotIndex
                                        ? { ...item, start: event.target.value }
                                        : item,
                                    ),
                                  }))
                                }
                              />
                              <Input
                                type="time"
                                value={slot.end}
                                disabled={hasParityBasedSchedule}
                                onChange={(event) =>
                                  updateWeeklyRule(day.key, (rule) => ({
                                    ...rule,
                                    slots: rule.slots.map((item, index) =>
                                      index === slotIndex
                                        ? { ...item, end: event.target.value }
                                        : item,
                                    ),
                                  }))
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  updateWeeklyRule(day.key, (rule) => ({
                                    ...rule,
                                    slots: rule.slots.filter((_, index) => index !== slotIndex),
                                  }))
                                }
                                disabled={hasParityBasedSchedule || dayRule.slots.length === 1}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {([
                { key: "oddDays", label: "Dias ímpares do mês" },
                { key: "evenDays", label: "Dias pares do mês" },
              ] as Array<{ key: "oddDays" | "evenDays"; label: string }>).map((item) => {
                const rule = workSchedule[item.key];
                return (
                  <div key={item.key} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{item.label}</p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateParityRule(item.key, (currentRule) => ({
                              ...currentRule,
                              slots: [...currentRule.slots, { ...DEFAULT_SLOT }],
                              enabled: true,
                            }))
                          }
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Faixa
                        </Button>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(checked) =>
                            updateParityRule(item.key, (currentRule) => ({
                              ...currentRule,
                              enabled: checked,
                              slots: checked && currentRule.slots.length === 0
                                ? [{ ...DEFAULT_SLOT }]
                                : currentRule.slots,
                            }))
                          }
                        />
                      </div>
                    </div>

                    {rule.enabled && (
                      <div className="mt-3 space-y-2">
                        {rule.slots.map((slot, slotIndex) => (
                          <div key={`${item.key}-${slotIndex}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                            <Input
                              type="time"
                              value={slot.start}
                              onChange={(event) =>
                                updateParityRule(item.key, (currentRule) => ({
                                  ...currentRule,
                                  slots: currentRule.slots.map((currentSlot, index) =>
                                    index === slotIndex
                                      ? { ...currentSlot, start: event.target.value }
                                      : currentSlot,
                                  ),
                                }))
                              }
                            />
                            <Input
                              type="time"
                              value={slot.end}
                              onChange={(event) =>
                                updateParityRule(item.key, (currentRule) => ({
                                  ...currentRule,
                                  slots: currentRule.slots.map((currentSlot, index) =>
                                    index === slotIndex
                                      ? { ...currentSlot, end: event.target.value }
                                      : currentSlot,
                                  ),
                                }))
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                updateParityRule(item.key, (currentRule) => ({
                                  ...currentRule,
                                  slots: currentRule.slots.filter((_, index) => index !== slotIndex),
                                }))
                              }
                              disabled={rule.slots.length === 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Agenda recorrente desativada para o perfil{" "}
                <strong>{getShiftProfileLabel(selectedShiftProfile, effectiveShiftProfileOptions)}</strong>.
                Ative a opcao de agenda recorrente na Configuracao de Ambiente quando necessario.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <FormField
                control={form.control}
                name="employmentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Regime *</FormLabel>
                    <Select onValueChange={field.onChange} value={normalizeEmploymentType(field.value)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="clt">CLT</SelectItem>
                        <SelectItem value="pj">PJ</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cpf"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPF {employmentType === "clt" ? "*" : ""}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={14}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(maskCpf(e.target.value))}
                        placeholder="000.000.000-00"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cnpj"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CNPJ {employmentType === "pj" ? "*" : ""}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={18}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(maskCnpj(e.target.value))}
                        placeholder="00.000.000/0000-00"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="shiftValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valor do plantao (R$)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={typeof field.value === "number" ? field.value : Number(field.value ?? 0)}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          field.onChange(nextValue === "" ? 0 : Number(nextValue));
                        }}
                        placeholder="0,00"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Base usada para gerar contas a pagar automáticas da escala mensal.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-xl border border-border p-4 space-y-3">
              <FormField
                control={form.control}
                name="portalAccess"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <FormLabel className="m-0 text-sm font-medium">Acesso ao portal do colaborador</FormLabel>
                        <p className="text-xs text-muted-foreground mt-1">
                          Ative para criar login e permitir que este profissional acesse o sistema.
                        </p>
                      </div>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                  </FormItem>
                )}
              />

              {portalAccessEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="portalUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Usuario de acesso *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            placeholder="ex: maria.cuidador"
                            onChange={(event) => field.onChange(event.target.value.toLowerCase())}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Use letras minusculas, numeros e ponto.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormItem>
                    <FormLabel>
                      Senha {staff?.portalUserId ? "(opcional para alterar)" : "*"}
                    </FormLabel>
                    <div className="relative">
                      <Input
                        type={showPortalPassword ? "text" : "password"}
                        value={portalPassword}
                        placeholder={staff?.portalUserId ? "Deixe em branco para manter" : "Senha de acesso"}
                        onChange={(event) => setPortalPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPortalPassword((current) => !current)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPortalPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {staff?.portalUserId
                        ? "Preencha apenas se quiser trocar a senha."
                        : "Senha usada no primeiro acesso do colaborador."}
                    </p>
                  </FormItem>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="rounded-lg border border-border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <FormLabel className="m-0">Colaborador ativo</FormLabel>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending || isProcessingPhoto}>
                {staff ? "Salvar" : "Adicionar"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}



