import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useResidents, useCreateResident, useUpdateResident } from "@/hooks/use-residents";
import { useAuth } from "@/hooks/use-auth";
import { useEnvironmentSettings } from "@/hooks/use-environment-settings";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { canAccessRoute } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import AdmissaoWizard from "@/components/AdmissaoWizard";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Search, Trash2, Phone, Bed, Pencil, Eye, EyeOff, Globe, Sun, Moon, Timer, ClipboardList, Calendar as CalendarIcon, FileText, Download, Upload, MapPin } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  residentFormSchema,
  type ResidentFormInput,
  type Resident,
  type Medication,
  type Occurrence,
  type ShiftAssignment,
  type FamilyMember,
  type PatientDocument,
  type Contract,
} from "@shared/schema";
import { addDays, format } from "date-fns";
import { digitsOnly, maskCep, maskCpf, maskPhoneBR } from "@/lib/masks";
import { imageFileToDataUrl } from "@/lib/imageUpload";
import { toDateInputValue } from "@/lib/date";
import { downloadDataUrlFile, openDataUrlFile } from "@/lib/files";
import { DEFAULT_ENVIRONMENT_SETTINGS, getShiftProfileRule } from "@shared/environment";

type MedicationWithResident = Medication & { residentName?: string };
type MedicationAdministrationWithDetails = {
  id: number;
  medicationId: number;
  residentId: number;
  staffId: number | null;
  scheduledFor: string | null;
  administeredAt: string | null;
  status: "given" | "skipped" | "refused" | "late";
  notes: string | null;
  medicationName?: string;
  residentName?: string;
  administeredByName?: string;
};
type MedicationDoseScheduleItem = {
  key: string;
  medicationId: number;
  medicationName: string;
  dosage: string;
  frequency: string;
  route: string | null;
  scheduledFor: string;
  scheduledDate: string;
  scheduledTime: string;
  status: "pending" | "given" | "skipped" | "refused" | "late";
  isOverdue: boolean;
  notes: string | null;
  administeredAt: string | null;
  administeredByName: string | null;
  administeredByStaffId: number | null;
};
type MedicationDoseScheduleResponse = {
  residentId: number;
  from: string;
  to: string;
  generatedAt: string;
  doses: MedicationDoseScheduleItem[];
};
type OccurrenceWithResident = Occurrence & { residentName?: string };
type ShiftWithDetails = ShiftAssignment & { residentName?: string; staffName?: string };
type ContractWithResident = Contract & { residentName?: string };
type PatientDocumentItem = PatientDocument;
type ResidentDetailsTab = "medications" | "documents" | "shifts" | "occurrences" | "family" | "contracts";

type ViaCepPayload = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

const MAX_PATIENT_DOCUMENT_BYTES = 15 * 1024 * 1024;

function readDocumentFileAsDataUrl(file: File): Promise<string> {
  if (file.size > MAX_PATIENT_DOCUMENT_BYTES) {
    throw new Error("Arquivo maior que 15MB.");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:")) {
        reject(new Error("Arquivo inválido."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

async function fetchResidentAddressByCep(cep: string): Promise<{
  cep: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
}> {
  const normalizedCep = digitsOnly(cep);
  if (normalizedCep.length !== 8) {
    throw new Error("Informe um CEP válido com 8 dígitos.");
  }

  const response = await fetch(`https://viacep.com.br/ws/${normalizedCep}/json/`);
  if (!response.ok) throw new Error("Não foi possível consultar o ViaCEP.");

  const data: ViaCepPayload = await response.json();
  if (data.erro) throw new Error("CEP não encontrado.");

  return {
    cep: maskCep(data.cep || normalizedCep),
    address: data.logradouro || "",
    neighborhood: data.bairro || "",
    city: data.localidade || "",
    state: data.uf || "",
  };
}

function formatFileSize(bytes?: number | null): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTimeLabel(value?: string | Date | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return format(parsed, "dd/MM/yyyy HH:mm");
}

const familySchema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  relationship: z.string().min(2, "Parentesco obrigatorio"),
  phone: z.string().min(8, "Telefone obrigatorio"),
  phone2: z.string().optional(),
  email: z.string().optional(),
  cpf: z.string().optional(),
  address: z.string().optional(),
  isPrimary: z.boolean().default(false),
  portalAccess: z.boolean().default(false),
  portalUsername: z.string().optional(),
  portalPassword: z.string().optional(),
}).refine((data) => {
  if (!data.portalAccess) return true;
  return !!data.portalUsername && data.portalUsername.trim().length >= 3;
}, {
  message: "Usuário de portal obrigatorio",
  path: ["portalUsername"],
});

const defaultFamilyFormValues: z.infer<typeof familySchema> = {
  name: "",
  relationship: "",
  phone: "",
  phone2: "",
  email: "",
  cpf: "",
  address: "",
  isPrimary: false,
  portalAccess: false,
  portalUsername: "",
  portalPassword: "",
};

const patientDocumentSchema = z.object({
  title: z.string().trim().min(2, "Titulo obrigatorio"),
  subtitle: z.string().optional(),
  category: z.string().optional(),
  fileName: z.string().min(1, "Selecione um arquivo"),
  fileType: z.string().optional(),
  fileSize: z.number().optional(),
  fileData: z.string().min(1, "Selecione um arquivo"),
});

const defaultPatientDocumentValues: z.infer<typeof patientDocumentSchema> = {
  title: "",
  subtitle: "",
  category: "document",
  fileName: "",
  fileType: "",
  fileSize: 0,
  fileData: "",
};

const contractSchema = z.object({
  residentId: z.coerce.number().min(1, "Residente obrigatorio"),
  plan: z.enum(["standard", "premium", "vip"]),
  monthlyValue: z.coerce.number().min(1, "Valor obrigatorio"),
  startDate: z.string().min(1, "Data obrigatoria"),
  endDate: z.string().optional(),
  paymentDay: z.coerce.number().min(1).max(31).default(5),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["active", "suspended", "terminated"]).default("active"),
});
const residentMedicationSchema = z.object({
  name: z.string().min(2, "Medicação obrigatoria"),
  dosage: z.string().min(1, "Dose obrigatoria"),
  frequency: z.string().min(1, "Frequencia obrigatoria"),
  status: z.enum(["active", "suspended"]).default("active"),
  route: z.string().optional(),
  scheduleTime: z.string().optional(),
  prescribedBy: z.string().optional(),
  notes: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
const residentMedicationDoseActionSchema = z.object({
  status: z.enum(["given", "skipped", "refused", "late"]).default("given"),
  notes: z.string().optional(),
  staffId: z.coerce.number().optional(),
});
const residentShiftSchema = z.object({
  staffId: z.coerce.number().min(1, "Cuidador obrigatorio"),
  shiftType: z.enum(["12h_manha", "12h_noite", "24h", "avulso"]).default("avulso"),
  date: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.date?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["date"],
      message: "Data obrigatoria",
    });
  }
  if (!data.startTime?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startTime"],
      message: "Inicio obrigatorio",
    });
  }
  if (!data.endTime?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endTime"],
      message: "Fim obrigatorio",
    });
  }
});
const residentOccurrenceSchema = z.object({
  type: z.string().min(2, "Tipo obrigatorio"),
  description: z.string().min(5, "Descricao obrigatoria"),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
  status: z.enum(["open", "in_progress", "resolved"]).default("open"),
  resolution: z.string().optional(),
});

const medicationStatusLabel: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
};
const MEDICATION_FREQUENCY_OPTIONS = [
  { value: "a cada 4h", label: "A cada 4 horas" },
  { value: "a cada 6h", label: "A cada 6 horas" },
  { value: "a cada 8h", label: "A cada 8 horas" },
  { value: "a cada 12h", label: "A cada 12 horas" },
  { value: "a cada 24h", label: "1x ao dia (24h)" },
  { value: "2x ao dia", label: "2x ao dia" },
  { value: "3x ao dia", label: "3x ao dia" },
  { value: "4x ao dia", label: "4x ao dia" },
  { value: "semanal", label: "Semanal" },
  { value: "sob demanda", label: "Sob demanda (se necessario)" },
] as const;
const ALL_MEDICATIONS_FILTER = "__all_medications__";

function getMedicationFrequencyLabel(value?: string | null): string {
  if (!value) return "-";
  const normalizedValue = value.trim().toLowerCase();
  const found = MEDICATION_FREQUENCY_OPTIONS.find(
    (option) => option.value.trim().toLowerCase() === normalizedValue,
  );
  return found?.label ?? value;
}

function getMedicationFrequencyOptionsForValue(value?: string | null): Array<{ value: string; label: string }> {
  const currentValue = value?.trim() ?? "";
  if (!currentValue) return [...MEDICATION_FREQUENCY_OPTIONS];
  const hasCurrent = MEDICATION_FREQUENCY_OPTIONS.some(
    (option) => option.value.trim().toLowerCase() === currentValue.toLowerCase(),
  );
  if (hasCurrent) return [...MEDICATION_FREQUENCY_OPTIONS];
  return [
    { value: currentValue, label: `Personalizado (${currentValue})` },
    ...MEDICATION_FREQUENCY_OPTIONS,
  ];
}

function extractPrimaryScheduleTime(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const token = raw
    .split(/[\n,;|]+/g)
    .map((item) => item.trim())
    .find((item) => /^([01]?\d|2[0-3]):([0-5]\d)$/.test(item));
  if (!token) return "";
  const [hourText, minuteText] = token.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeScheduleTimeValue(value?: string | null): string | null {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized)) return null;
  return normalized;
}

function frequencyNeedsBaseTime(value?: string | null): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("sob demanda")) return false;
  if (normalized.includes("semanal")) return true;
  if (normalized.match(/(?:a cada\s*)?(\d{1,2})\s*h/)) return true;
  const timesPerDayMatch = normalized.match(/(\d{1,2})\s*x\s*ao\s*dia/);
  if (timesPerDayMatch) return true;
  return false;
}

function parseDateOnly(value?: string | null): Date | null {
  const raw = (value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateOnly(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function formatDateLabel(value?: string | null): string {
  const parsed = parseDateOnly(value);
  if (!parsed) return "Selecionar data";
  return format(parsed, "dd/MM/yyyy");
}

function formatMedicationDoseDateTime(dose: MedicationDoseScheduleItem): string {
  if (dose.scheduledDate && dose.scheduledTime) {
    return `${formatDateLabel(dose.scheduledDate)} ${dose.scheduledTime}`;
  }
  return format(new Date(dose.scheduledFor), "dd/MM/yyyy HH:mm");
}

const medicationAdministrationStatusLabel: Record<
  MedicationDoseScheduleItem["status"] | MedicationAdministrationWithDetails["status"],
  string
> = {
  pending: "Pendente",
  given: "Administrado",
  skipped: "Não administrado",
  refused: "Recusado",
  late: "Atrasado",
};

const occurrenceSeverityLabel: Record<string, string> = {
  low: "Leve",
  medium: "Moderada",
  high: "Grave",
  critical: "Critica",
};

const occurrenceStatusLabel: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  resolved: "Resolvida",
};

const shiftTypeLabel: Record<string, string> = {
  "12h_manha": "12h Manha",
  "12h_noite": "12h Noite",
  "24h": "24h",
  avulso: "Avulso",
};
const shiftTypeMeta = {
  "12h_manha": {
    label: "12h Manha",
    hint: "12h editavel",
    icon: Sun,
    selectedStyle: "bg-sky-100 text-sky-800 border-sky-200 ring-sky-500/25",
  },
  "12h_noite": {
    label: "12h Noite",
    hint: "12h editavel",
    icon: Moon,
    selectedStyle: "bg-violet-100 text-violet-800 border-violet-200 ring-violet-500/25",
  },
  "24h": {
    label: "Plantao 24h",
    hint: "24h editavel",
    icon: Timer,
    selectedStyle: "bg-amber-100 text-amber-800 border-amber-200 ring-amber-500/25",
  },
  avulso: {
    label: "Avulso",
    hint: "horário livre",
    icon: ClipboardList,
    selectedStyle: "bg-emerald-100 text-emerald-800 border-emerald-200 ring-emerald-500/25",
  },
} as const;

function medicationAdministrationStatusClass(status: MedicationDoseScheduleItem["status"]): string {
  if (status === "given") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (status === "skipped") return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "refused") return "bg-rose-100 text-rose-800 border-rose-200";
  if (status === "late") return "bg-violet-100 text-violet-800 border-violet-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

const residentStatusView: Record<string, { label: string; className: string }> = {
  active: { label: "Ativo", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  inactive: { label: "Inativo", className: "border-amber-200 bg-amber-50 text-amber-700" },
  deceased: { label: "Falecido", className: "border-neutral-200 bg-neutral-100 text-neutral-600" },
};

function getResidentStatusView(status?: string | null) {
  return residentStatusView[status || ""] ?? residentStatusView.inactive;
}

function formatResidentBirthDate(value?: string | Date | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd/MM/yyyy");
}

function ResidentAvatar({ resident, size = "md" }: { resident: Resident; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-10 w-10 text-sm" : "h-12 w-12 text-base";
  if (resident.photoUrl) {
    return (
      <img
        src={resident.photoUrl}
        alt={resident.name}
        className={`${sizeClass} shrink-0 rounded-lg border border-border object-cover`}
      />
    );
  }

  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center rounded-lg bg-secondary font-bold text-primary`}>
      {resident.name.charAt(0)}
    </div>
  );
}

function ResidentStatusBadge({ status }: { status?: string | null }) {
  const view = getResidentStatusView(status);
  return (
    <Badge variant="outline" className={view.className}>
      {view.label}
    </Badge>
  );
}

function ResidentSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function ResidentTabNotice({
  children,
  variant = "muted",
}: {
  children: ReactNode;
  variant?: "muted" | "destructive";
}) {
  const className =
    variant === "destructive"
      ? "rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive"
      : "rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground";

  return <div className={className}>{children}</div>;
}

function getDefaultShiftTimes(
  type: z.infer<typeof residentShiftSchema>["shiftType"],
  date: string,
  rule?: ReturnType<typeof getShiftProfileRule>,
): { startTime: string; endTime: string } {
  if (!date) return { startTime: "", endTime: "" };
  let startClock = "08:00";
  switch (type) {
    case "12h_manha":
      startClock = "07:00";
      break;
    case "12h_noite":
      startClock = "19:00";
      break;
    case "24h":
      startClock = "07:00";
      break;
  }

  const startTime = `${date}T${startClock}`;
  const durationHours = getResidentShiftDurationHours(type, rule) ?? 9;
  return {
    startTime,
    endTime: addHoursToDateTimeInput(startTime, durationHours) ?? `${date}T17:00`,
  };
}

function getResidentShiftDurationHours(
  type: z.infer<typeof residentShiftSchema>["shiftType"],
  rule?: ReturnType<typeof getShiftProfileRule>,
): number | null {
  if (type === "avulso") return null;
  const configuredDuration = Number(rule?.exactShiftHours ?? 0);
  if (rule?.enabled && Number.isFinite(configuredDuration) && configuredDuration > 0) {
    return configuredDuration;
  }
  if (type === "12h_manha" || type === "12h_noite") return 12;
  if (type === "24h") return 24;
  return null;
}

function parseDateTimeInput(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateTimeInput(value: Date): string {
  return format(value, "yyyy-MM-dd'T'HH:mm");
}

function addHoursToDateTimeInput(value: string, hours: number): string | null {
  const parsed = parseDateTimeInput(value);
  if (!parsed) return null;
  return formatDateTimeInput(new Date(parsed.getTime() + (hours * 60 * 60 * 1000)));
}

function subtractHoursFromDateTimeInput(value: string, hours: number): string | null {
  const parsed = parseDateTimeInput(value);
  if (!parsed) return null;
  return formatDateTimeInput(new Date(parsed.getTime() - (hours * 60 * 60 * 1000)));
}

function buildShiftRuleHint(rule: ReturnType<typeof getShiftProfileRule>): string | null {
  if (!rule.enabled) return null;
  const parts: string[] = [];
  if (rule.exactShiftHours) parts.push(`somente plantões de ${rule.exactShiftHours}h`);
  if (rule.minRestHours) parts.push(`descanso mínimo de ${rule.minRestHours}h entre escalas`);
  if (rule.allowedShiftTypes.length > 0) {
    parts.push(`tipos permitidos: ${rule.allowedShiftTypes.join(", ")}`);
  }
  if (parts.length === 0) return "Perfil com regra ativa.";
  return `Regra do perfil: ${parts.join(" | ")}.`;
}

const contractPlanLabel: Record<string, string> = {
  standard: "Standard",
  premium: "Premium",
  vip: "VIP",
};

const contractStatusLabel: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
  terminated: "Encerrado",
};

const BLOOD_TYPE_OPTIONS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

const MOBILITY_STATUS_OPTIONS = [
  { value: "independente", label: "Independente" },
  { value: "assistido", label: "Assistido" },
  { value: "acamado", label: "Acamado" },
] as const;

const COGNITIVE_STATUS_OPTIONS = [
  { value: "preservado", label: "Preservado" },
  { value: "comprometimento leve", label: "Comprometimento leve" },
  { value: "comprometimento moderado", label: "Comprometimento moderado" },
  { value: "comprometimento grave", label: "Comprometimento grave" },
] as const;

async function fetchResidentData<T>(path: string, fallbackMessage: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Sem permissão para visualizar este conteúdo.");
    }
    const serverMessage =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : fallbackMessage;
    throw new Error(serverMessage || fallbackMessage);
  }

  return payload as T;
}

export default function Residents() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "deceased">("all");
  const { data: residents, isLoading } = useResidents({ search });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null);
  const [detailsTab, setDetailsTab] = useState<ResidentDetailsTab | undefined>(undefined);
  const { user } = useAuth();
  const { data: environmentSettings } = useEnvironmentSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canViewMedications = canAccessRoute(user?.role, "/prontuario", environmentSettings?.roleRoutes);
  const canViewEscalas = canAccessRoute(user?.role, "/escalas", environmentSettings?.roleRoutes);
  const canViewOccurrences = canAccessRoute(user?.role, "/occurrences", environmentSettings?.roleRoutes);
  const canManageFamily = canAccessRoute(user?.role, "/prontuario", environmentSettings?.roleRoutes);
  const canManageDocuments = canAccessRoute(user?.role, "/prontuario", environmentSettings?.roleRoutes);
  const canManageContracts = canAccessRoute(user?.role, "/financeiro", environmentSettings?.roleRoutes);

  const residentStatusFilterOptions = useMemo(() => {
    const list = residents ?? [];
    const countByStatus = (status: string) => list.filter((resident) => resident.status === status).length;

    return [
      { value: "all" as const, label: "Todos", count: list.length },
      { value: "active" as const, label: "Ativos", count: countByStatus("active") },
      { value: "inactive" as const, label: "Inativos", count: countByStatus("inactive") },
      { value: "deceased" as const, label: "Falecidos", count: countByStatus("deceased") },
    ];
  }, [residents]);

  const filteredResidents = residents?.filter((resident) => {
    const normalizedSearch = search.trim().toLowerCase();
    const matchesSearch =
      normalizedSearch.length === 0 ||
      [
        resident.name,
        resident.roomNumber,
        resident.contactName,
        resident.contactPhone,
        resident.address,
        resident.city,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    const matchesStatus = statusFilter === "all" || resident.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/residents/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir residente");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Residente excluído" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir residente" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-foreground">Residentes</h1>
          <p className="text-muted-foreground mt-1">Gerencie os idosos acolhidos na instituição.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setEditingResident(null); setIsDialogOpen(true); }} data-testid="button-new-resident">
            <Plus className="mr-2 h-4 w-4" /> Cadastro Rápido
          </Button>
          <Button onClick={() => setIsWizardOpen(true)} className="w-full sm:w-auto shadow-lg shadow-primary/20 gap-2" data-testid="button-nova-admissao">
            <Plus className="h-4 w-4" /> Nova Admissão
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, quarto ou contato..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 focus-visible:ring-0 bg-transparent px-0 text-sm sm:text-base"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {residentStatusFilterOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={statusFilter === option.value ? "default" : "outline"}
              size="sm"
              className="h-8 shrink-0 gap-2 rounded-lg px-3"
              onClick={() => setStatusFilter(option.value)}
            >
              <span>{option.label}</span>
              <span className="rounded-md bg-background/25 px-1.5 text-xs">{option.count}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {isLoading ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Carregando residentes...
          </div>
        ) : filteredResidents?.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Nenhum residente encontrado.
          </div>
        ) : (
          filteredResidents?.map((resident) => (
            <div
              key={resident.id}
              className="w-full rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start gap-3">
                <ResidentAvatar resident={resident} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{resident.name}</p>
                      <p className="text-xs text-muted-foreground">{formatResidentBirthDate(resident.birthDate)}</p>
                    </div>
                    <ResidentStatusBadge status={resident.status} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Bed className="h-4 w-4 shrink-0" />
                      <span>Quarto {resident.roomNumber || "-"}</span>
                    </div>
                    {resident.careType === "home_care" || resident.address ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <MapPin className="h-4 w-4 shrink-0" />
                        <span className="truncate">
                          {resident.address
                            ? [resident.address, resident.addressNumber, resident.city].filter(Boolean).join(", ")
                            : "Home Care"}
                        </span>
                      </div>
                    ) : null}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{resident.contactName || "Sem contato"}</p>
                      <div className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span>{maskPhoneBR(resident.contactPhone)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setSelectedResident(resident);
                        setDetailsTab(undefined);
                      }}
                      data-testid={`button-open-resident-mobile-${resident.id}`}
                    >
                      Abrir ficha
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingResident(resident);
                        setIsDialogOpen(true);
                      }}
                      data-testid={`button-edit-resident-mobile-${resident.id}`}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      disabled={deleteMutation.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        confirm({
                          title: "Excluir residente",
                          description: `Excluir "${resident.name}"? Esta ação não pode ser desfeita.`,
                          confirmText: "Excluir",
                          pendingText: "Excluindo...",
                          variant: "destructive",
                          onConfirm: () => deleteMutation.mutateAsync(resident.id),
                        });
                      }}
                      data-testid={`button-delete-resident-mobile-${resident.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[240px]">Nome</TableHead>
              <TableHead>Quarto</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : filteredResidents?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Nenhum residente encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filteredResidents?.map((resident) => (
                <TableRow
                  key={resident.id}
                  className="hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => {
                    setSelectedResident(resident);
                    setDetailsTab(undefined);
                  }}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ResidentAvatar resident={resident} size="sm" />
                      <div>
                        <div className="font-medium">{resident.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatResidentBirthDate(resident.birthDate)}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <Bed className="h-4 w-4 text-muted-foreground" />
                      {resident.roomNumber || "-"}
                    </div>
                    {resident.careType === "home_care" ? (
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        Home Care
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <p className="font-medium">{resident.contactName}</p>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {maskPhoneBR(resident.contactPhone)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ResidentStatusBadge status={resident.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingResident(resident);
                          setIsDialogOpen(true);
                        }}
                        data-testid={`button-edit-resident-${resident.id}`}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        disabled={deleteMutation.isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          confirm({
                            title: "Excluir residente",
                            description: `Excluir "${resident.name}"? Esta ação não pode ser desfeita.`,
                            confirmText: "Excluir",
                            pendingText: "Excluindo...",
                            variant: "destructive",
                            onConfirm: () => deleteMutation.mutateAsync(resident.id),
                          });
                        }}
                        data-testid={`button-delete-resident-${resident.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ResidentDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        resident={editingResident}
      />
      <ResidentDetailsDialog
        open={!!selectedResident}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedResident(null);
            setDetailsTab(undefined);
          }
        }}
        resident={selectedResident}
        initialTab={detailsTab}
        canViewMedications={canViewMedications}
        canViewEscalas={canViewEscalas}
        canViewOccurrences={canViewOccurrences}
        canManageFamily={canManageFamily}
        canManageDocuments={canManageDocuments}
        canManageContracts={canManageContracts}
      />
      {confirmDialog}
      <AdmissaoWizard open={isWizardOpen} onOpenChange={setIsWizardOpen} />
    </div>
  );
}

function ResidentDetailsDialog({
  open,
  onOpenChange,
  resident,
  initialTab,
  canViewMedications,
  canViewEscalas,
  canViewOccurrences,
  canManageFamily,
  canManageDocuments,
  canManageContracts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resident: Resident | null;
  initialTab?: ResidentDetailsTab;
  canViewMedications: boolean;
  canViewEscalas: boolean;
  canViewOccurrences: boolean;
  canManageFamily: boolean;
  canManageDocuments: boolean;
  canManageContracts: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user } = useAuth();
  const { data: environmentSettings } = useEnvironmentSettings();
  const configuredShiftProfiles = environmentSettings?.shiftProfiles
    ?? DEFAULT_ENVIRONMENT_SETTINGS.shiftProfiles;
  const residentId = resident?.id ?? 0;
  const isTabAllowed = (tab: ResidentDetailsTab) => {
    if (tab === "medications") return canViewMedications;
    if (tab === "shifts") return canViewEscalas;
    if (tab === "occurrences") return canViewOccurrences;
    if (tab === "family") return canManageFamily;
    if (tab === "documents") return canManageDocuments;
    if (tab === "contracts") return canManageContracts;
    return false;
  };

  const defaultTab = initialTab && isTabAllowed(initialTab)
    ? initialTab
    : canViewMedications
    ? "medications"
    : canManageDocuments
      ? "documents"
    : canViewEscalas
      ? "shifts"
      : canViewOccurrences
        ? "occurrences"
        : canManageFamily
          ? "family"
          : canManageContracts
            ? "contracts"
            : "medications";

  const medicationsQuery = useQuery<MedicationWithResident[]>({
    queryKey: ["/api/medications", "resident-details", residentId],
    enabled: open && !!resident && canViewMedications,
    queryFn: () =>
      fetchResidentData<MedicationWithResident[]>(
        `/api/medications?residentId=${residentId}`,
        "Erro ao carregar medicações.",
      ),
  });
  const [medicationScheduleRange, setMedicationScheduleRange] = useState(() => {
    const baseDate = new Date();
    return {
      from: format(baseDate, "yyyy-MM-dd"),
      to: format(addDays(baseDate, 6), "yyyy-MM-dd"),
    };
  });
  const [isFromMedicationCalendarOpen, setIsFromMedicationCalendarOpen] = useState(false);
  const [isToMedicationCalendarOpen, setIsToMedicationCalendarOpen] = useState(false);
  const [isDoseActionDialogOpen, setIsDoseActionDialogOpen] = useState(false);
  const [selectedDoseItem, setSelectedDoseItem] = useState<MedicationDoseScheduleItem | null>(null);
  const [showRegisteredMedicationDoses, setShowRegisteredMedicationDoses] = useState(false);
  const [selectedMedicationDoseFilter, setSelectedMedicationDoseFilter] = useState(ALL_MEDICATIONS_FILTER);

  const applyMedicationRangeToday = () => {
    const today = formatDateOnly(new Date());
    setMedicationScheduleRange({ from: today, to: today });
  };

  const handleMedicationFromDateSelect = (selected?: Date) => {
    if (!selected) return;
    const selectedValue = formatDateOnly(selected);
    setMedicationScheduleRange((prev) => {
      const currentTo = parseDateOnly(prev.to);
      if (currentTo && selected > currentTo) {
        return { from: selectedValue, to: selectedValue };
      }
      return { ...prev, from: selectedValue };
    });
    setIsFromMedicationCalendarOpen(false);
  };

  const handleMedicationToDateSelect = (selected?: Date) => {
    if (!selected) return;
    const selectedValue = formatDateOnly(selected);
    setMedicationScheduleRange((prev) => {
      const currentFrom = parseDateOnly(prev.from);
      if (currentFrom && selected < currentFrom) {
        return { from: selectedValue, to: selectedValue };
      }
      return { ...prev, to: selectedValue };
    });
    setIsToMedicationCalendarOpen(false);
  };

  const medicationDoseScheduleQuery = useQuery<MedicationDoseScheduleResponse>({
    queryKey: [
      "/api/residents",
      residentId,
      "medication-dose-schedule",
      medicationScheduleRange.from,
      medicationScheduleRange.to,
    ],
    enabled: open && !!resident && canViewMedications,
    queryFn: () =>
      fetchResidentData<MedicationDoseScheduleResponse>(
        `/api/residents/${residentId}/medication-dose-schedule?from=${medicationScheduleRange.from}&to=${medicationScheduleRange.to}`,
        "Erro ao carregar agenda de doses.",
      ),
  });
  const visibleMedicationScheduleDoses = useMemo(() => {
    const doses = medicationDoseScheduleQuery.data?.doses ?? [];
    if (showRegisteredMedicationDoses) return doses;
    return doses.filter((dose) => dose.status === "pending");
  }, [medicationDoseScheduleQuery.data?.doses, showRegisteredMedicationDoses]);
  const medicationDoseFilterOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        (medicationDoseScheduleQuery.data?.doses ?? [])
          .map((dose) => (dose.medicationName ?? "").trim())
          .filter((name) => name.length > 0),
      ),
    );
    return names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [medicationDoseScheduleQuery.data?.doses]);
  const filteredVisibleMedicationScheduleDoses = useMemo(() => {
    if (selectedMedicationDoseFilter === ALL_MEDICATIONS_FILTER) {
      return visibleMedicationScheduleDoses;
    }
    return visibleMedicationScheduleDoses.filter((dose) => dose.medicationName === selectedMedicationDoseFilter);
  }, [selectedMedicationDoseFilter, visibleMedicationScheduleDoses]);

  const medicationAdministrationHistoryQuery = useQuery<MedicationAdministrationWithDetails[]>({
    queryKey: ["/api/medication-administrations", "resident-details", residentId],
    enabled: open && !!resident && canViewMedications,
    queryFn: () =>
      fetchResidentData<MedicationAdministrationWithDetails[]>(
        `/api/medication-administrations?residentId=${residentId}`,
        "Erro ao carregar historico de medicações.",
      ),
  });

  const occurrencesQuery = useQuery<OccurrenceWithResident[]>({
    queryKey: ["/api/occurrences", "resident-details", residentId],
    enabled: open && !!resident && canViewOccurrences,
    queryFn: () =>
      fetchResidentData<OccurrenceWithResident[]>(
        `/api/occurrences?residentId=${residentId}`,
        "Erro ao carregar ocorrências.",
      ),
  });

  const shiftsQuery = useQuery<ShiftWithDetails[]>({
    queryKey: ["/api/shift-assignments", "resident-details", residentId],
    enabled: open && !!resident && canViewEscalas,
    queryFn: () =>
      fetchResidentData<ShiftWithDetails[]>(
        `/api/shift-assignments?residentId=${residentId}`,
        "Erro ao carregar escalas.",
      ),
  });

  const familyQuery = useQuery<FamilyMember[]>({
    queryKey: ["/api/residents", residentId, "family", "resident-details"],
    enabled: open && !!resident && canManageFamily,
    queryFn: () =>
      fetchResidentData<FamilyMember[]>(
        `/api/residents/${residentId}/family`,
        "Erro ao carregar familiares.",
      ),
  });

  const patientDocumentsQuery = useQuery<PatientDocumentItem[]>({
    queryKey: ["/api/residents", residentId, "documents", "resident-details"],
    enabled: open && !!resident && canManageDocuments,
    queryFn: () =>
      fetchResidentData<PatientDocumentItem[]>(
        `/api/residents/${residentId}/documents`,
        "Erro ao carregar documentos.",
      ),
  });

  const contractsQuery = useQuery<ContractWithResident[]>({
    queryKey: ["/api/contracts", "resident-details", residentId],
    enabled: open && !!resident && canManageContracts,
    queryFn: () =>
      fetchResidentData<ContractWithResident[]>(
        `/api/contracts?residentId=${residentId}`,
        "Erro ao carregar contratos.",
      ),
  });
  const staffQuery = useQuery<Array<{ id: number; name: string; role?: string; shift?: string; active?: boolean }>>({
    queryKey: ["/api/staff", "resident-details", residentId],
    enabled: open && !!resident && (canViewEscalas || canViewMedications),
    queryFn: async () => {
      const res = await fetch("/api/staff", { credentials: "include" });
      if (res.status === 403) return [];
      if (!res.ok) throw new Error("Erro ao carregar equipe.");
      return (await res.json()) as Array<{ id: number; name: string; role?: string; shift?: string; active?: boolean }>;
    },
  });
  const isCaregiver = user?.role === "cuidador";
  const normalizeStaffName = (value?: string | null) =>
    (value ?? "").trim().toLocaleLowerCase("pt-BR");
  const linkedStaffForCaregiver = useMemo(() => {
    if (!isCaregiver) return null;
    const normalizedUserName = normalizeStaffName(user?.name);
    if (!normalizedUserName) return null;
    return (
      staffQuery.data?.find((member) => normalizeStaffName(member.name) === normalizedUserName)
      ?? null
    );
  }, [isCaregiver, staffQuery.data, user?.name]);
  const selectableStaff = useMemo(() => {
    if (!isCaregiver) return staffQuery.data ?? [];
    return linkedStaffForCaregiver ? [linkedStaffForCaregiver] : [];
  }, [isCaregiver, linkedStaffForCaregiver, staffQuery.data]);
  const activeMedicationAdministrators = useMemo(
    () => (staffQuery.data ?? []).filter((member) => member.active !== false),
    [staffQuery.data],
  );
  const defaultShiftStaffId = linkedStaffForCaregiver?.id ?? 0;

  const [isMedicationDialogOpen, setIsMedicationDialogOpen] = useState(false);
  const [editingMedication, setEditingMedication] = useState<MedicationWithResident | null>(null);
  const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftWithDetails | null>(null);
  const [isOccurrenceDialogOpen, setIsOccurrenceDialogOpen] = useState(false);
  const [editingOccurrence, setEditingOccurrence] = useState<OccurrenceWithResident | null>(null);
  const [isFamilyDialogOpen, setIsFamilyDialogOpen] = useState(false);
  const [editingFamily, setEditingFamily] = useState<FamilyMember | null>(null);
  const [showPortalPassword, setShowPortalPassword] = useState(false);
  const [isContractDialogOpen, setIsContractDialogOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<ContractWithResident | null>(null);

  const medicationForm = useForm<z.infer<typeof residentMedicationSchema>>({
    resolver: zodResolver(residentMedicationSchema),
    defaultValues: {
      name: "",
      dosage: "",
      frequency: "",
      status: "active",
      route: "",
      scheduleTime: "",
      prescribedBy: "",
      notes: "",
      startDate: "",
      endDate: "",
    },
  });
  const watchedMedicationFrequency = medicationForm.watch("frequency");
  const medicationDoseActionForm = useForm<z.infer<typeof residentMedicationDoseActionSchema>>({
    resolver: zodResolver(residentMedicationDoseActionSchema),
    defaultValues: {
      status: "given",
      notes: "",
      staffId: undefined,
    },
  });
  const shiftForm = useForm<z.infer<typeof residentShiftSchema>>({
    resolver: zodResolver(residentShiftSchema),
    defaultValues: {
      staffId: 0,
      shiftType: "12h_manha",
      date: format(new Date(), "yyyy-MM-dd"),
      startTime: "",
      endTime: "",
      notes: "",
    },
  });
  const occurrenceForm = useForm<z.infer<typeof residentOccurrenceSchema>>({
    resolver: zodResolver(residentOccurrenceSchema),
    defaultValues: {
      type: "Saude",
      description: "",
      severity: "low",
      status: "open",
      resolution: "",
    },
  });
  const familyForm = useForm<z.infer<typeof familySchema>>({
    resolver: zodResolver(familySchema),
    defaultValues: defaultFamilyFormValues,
  });

  const patientDocumentForm = useForm<z.infer<typeof patientDocumentSchema>>({
    resolver: zodResolver(patientDocumentSchema),
    defaultValues: defaultPatientDocumentValues,
  });

  const contractForm = useForm<z.infer<typeof contractSchema>>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      residentId,
      plan: "standard",
      monthlyValue: 3200,
      startDate: toDateInputValue(),
      paymentDay: 5,
      paymentMethod: "",
      notes: "",
      status: "active",
    },
  });

  useEffect(() => {
    if (!open) return;
    contractForm.setValue("residentId", residentId);
  }, [open, residentId, contractForm]);

  useEffect(() => {
    if (!open) return;
    if (!selectedDoseItem) return;
    const initialStatus = selectedDoseItem.status === "pending"
      ? "given"
      : selectedDoseItem.status;
    medicationDoseActionForm.reset({
      status: initialStatus,
      notes: selectedDoseItem.notes ?? "",
      staffId: selectedDoseItem.administeredByStaffId ?? undefined,
    });
  }, [medicationDoseActionForm, open, selectedDoseItem]);

  const selectedShiftType = shiftForm.watch("shiftType");
  const shiftDate = shiftForm.watch("date");
  const selectedStaffId = shiftForm.watch("staffId");
  const selectedStaff = useMemo(
    () => selectableStaff.find((staffMember) => staffMember.id === Number(selectedStaffId)),
    [selectableStaff, selectedStaffId],
  );
  const selectedStaffRule = useMemo(
    () => getShiftProfileRule(selectedStaff?.shift, configuredShiftProfiles),
    [configuredShiftProfiles, selectedStaff?.shift],
  );
  const selectedStaffRuleHint = useMemo(
    () => buildShiftRuleHint(selectedStaffRule),
    [selectedStaffRule],
  );
  const availableShiftTypes = useMemo<Array<z.infer<typeof residentShiftSchema>["shiftType"]>>(
    () => {
      const allShiftTypes: Array<z.infer<typeof residentShiftSchema>["shiftType"]> =
        ["12h_manha", "12h_noite", "24h", "avulso"];
      if (!selectedStaffRule.enabled || selectedStaffRule.allowedShiftTypes.length === 0) {
        return allShiftTypes;
      }
      const allowed = selectedStaffRule.allowedShiftTypes.filter(
        (item): item is z.infer<typeof residentShiftSchema>["shiftType"] =>
          allShiftTypes.includes(item as z.infer<typeof residentShiftSchema>["shiftType"]),
      );
      return allowed.length > 0 ? allowed : allShiftTypes;
    },
    [selectedStaffRule],
  );

  useEffect(() => {
    const currentShiftType = shiftForm.getValues("shiftType");
    if (!availableShiftTypes.includes(currentShiftType)) {
      const nextShiftType = availableShiftTypes[0] ?? "12h_manha";
      const date = shiftForm.getValues("date") || format(new Date(), "yyyy-MM-dd");
      const suggestedTimes = getDefaultShiftTimes(nextShiftType, date, selectedStaffRule);
      const previousStartClock = shiftForm.getValues("startTime")?.slice(11, 16);
      const startTime = previousStartClock ? `${date}T${previousStartClock}` : suggestedTimes.startTime;
      const durationHours = getResidentShiftDurationHours(nextShiftType, selectedStaffRule);
      const endTime = durationHours
        ? (addHoursToDateTimeInput(startTime, durationHours) ?? suggestedTimes.endTime)
        : suggestedTimes.endTime;
      shiftForm.setValue("shiftType", nextShiftType, { shouldDirty: true, shouldValidate: true });
      shiftForm.setValue("date", date, { shouldDirty: true, shouldValidate: true });
      shiftForm.setValue("startTime", startTime, { shouldDirty: true, shouldValidate: true });
      shiftForm.setValue("endTime", endTime, { shouldDirty: true, shouldValidate: true });
    }
  }, [availableShiftTypes, selectedStaffRule, shiftForm]);

  useEffect(() => {
    if (!isCaregiver || !defaultShiftStaffId) return;
    const currentStaffId = Number(shiftForm.getValues("staffId"));
    if (currentStaffId === defaultShiftStaffId) return;
    shiftForm.setValue("staffId", defaultShiftStaffId, { shouldDirty: true, shouldValidate: true });
  }, [isCaregiver, defaultShiftStaffId, shiftForm]);

  const createMedication = useMutation({
    mutationFn: async (data: z.infer<typeof residentMedicationSchema>) => {
      const scheduleTime = normalizeScheduleTimeValue(data.scheduleTime);
      if (frequencyNeedsBaseTime(data.frequency) && !scheduleTime) {
        throw new Error("Informe o horário base para esta frequência.");
      }
      const payload = {
        residentId,
        name: data.name.trim(),
        dosage: data.dosage.trim(),
        frequency: data.frequency.trim(),
        status: data.status,
        route: data.route?.trim() || null,
        scheduleTime,
        prescribedBy: data.prescribedBy?.trim() || null,
        notes: data.notes?.trim() || null,
        startDate: data.startDate?.trim() || null,
        endDate: data.endDate?.trim() || null,
      };
      const res = await fetch("/api/medications", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao cadastrar medicação.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/medications", "resident-details", residentId] });
      setIsMedicationDialogOpen(false);
      setEditingMedication(null);
      medicationForm.reset({
        name: "",
        dosage: "",
        frequency: "",
        status: "active",
        route: "",
        scheduleTime: "",
        prescribedBy: "",
        notes: "",
        startDate: "",
        endDate: "",
      });
      toast({ title: "Medicação cadastrada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao cadastrar medicação" });
    },
  });

  const updateMedication = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof residentMedicationSchema> }) => {
      const scheduleTime = normalizeScheduleTimeValue(data.scheduleTime);
      if (frequencyNeedsBaseTime(data.frequency) && !scheduleTime) {
        throw new Error("Informe o horário base para esta frequência.");
      }
      const payload = {
        residentId,
        name: data.name.trim(),
        dosage: data.dosage.trim(),
        frequency: data.frequency.trim(),
        status: data.status,
        route: data.route?.trim() || null,
        scheduleTime,
        prescribedBy: data.prescribedBy?.trim() || null,
        notes: data.notes?.trim() || null,
        startDate: data.startDate?.trim() || null,
        endDate: data.endDate?.trim() || null,
      };
      const res = await fetch(`/api/medications/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao atualizar medicação.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/medications", "resident-details", residentId] });
      setIsMedicationDialogOpen(false);
      setEditingMedication(null);
      toast({ title: "Medicação atualizada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao atualizar medicação" });
    },
  });

  const deleteMedication = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/medications/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir medicação.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/medications", "resident-details", residentId] });
      toast({ title: "Medicação removida" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao excluir medicação" });
    },
  });
  const registerDoseAdministration = useMutation({
    mutationFn: async (data: z.infer<typeof residentMedicationDoseActionSchema>) => {
      if (!selectedDoseItem) {
        throw new Error("Nenhuma dose selecionada.");
      }
      const payload = {
        medicationId: selectedDoseItem.medicationId,
        scheduledFor: selectedDoseItem.scheduledFor,
        staffId: isCaregiver ? undefined : data.staffId ?? undefined,
        status: data.status,
        notes: data.notes?.trim() || null,
        administeredAt: new Date().toISOString(),
      };
      const res = await fetch(`/api/residents/${residentId}/medication-dose-records`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao registrar administração da dose.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medication-administrations"] });
      queryClient.invalidateQueries({
        queryKey: [
          "/api/residents",
          residentId,
          "medication-dose-schedule",
          medicationScheduleRange.from,
          medicationScheduleRange.to,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/medication-administrations", "resident-details", residentId],
      });
      setIsDoseActionDialogOpen(false);
      setSelectedDoseItem(null);
      toast({ title: "Administracao registrada com sucesso" });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: error.message || "Erro ao registrar administração da dose",
      });
    },
  });

  const createShift = useMutation({
    mutationFn: async (data: z.infer<typeof residentShiftSchema>) => {
      const payload = {
        residentId,
        staffId: Number(data.staffId),
        shiftType: data.shiftType,
        startTime: new Date(data.startTime || ""),
        endTime: new Date(data.endTime || ""),
        notes: data.notes?.trim() || null,
      };
      const res = await fetch("/api/shift-assignments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao cadastrar escala.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments", "resident-details", residentId] });
      setIsShiftDialogOpen(false);
      setEditingShift(null);
      shiftForm.reset({
        staffId: 0,
        shiftType: "12h_manha",
        date: format(new Date(), "yyyy-MM-dd"),
        startTime: "",
        endTime: "",
        notes: "",
      });
      toast({ title: "Escala cadastrada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao cadastrar escala" });
    },
  });

  const updateShift = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof residentShiftSchema> }) => {
      const payload = {
        residentId,
        staffId: Number(data.staffId),
        shiftType: data.shiftType,
        startTime: new Date(data.startTime || ""),
        endTime: new Date(data.endTime || ""),
        notes: data.notes?.trim() || null,
      };
      const res = await fetch(`/api/shift-assignments/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao atualizar escala.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments", "resident-details", residentId] });
      setIsShiftDialogOpen(false);
      setEditingShift(null);
      toast({ title: "Escala atualizada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao atualizar escala" });
    },
  });

  const deleteShift = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/shift-assignments/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao remover escala.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments", "resident-details", residentId] });
      toast({ title: "Escala removida" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao remover escala" });
    },
  });

  const createOccurrence = useMutation({
    mutationFn: async (data: z.infer<typeof residentOccurrenceSchema>) => {
      const payload = {
        residentId,
        type: data.type.trim(),
        description: data.description.trim(),
        severity: data.severity,
        status: data.status,
        resolution: data.resolution?.trim() || null,
      };
      const res = await fetch("/api/occurrences", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao registrar ocorrência.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", "resident-details", residentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setIsOccurrenceDialogOpen(false);
      setEditingOccurrence(null);
      occurrenceForm.reset({
        type: "Saude",
        description: "",
        severity: "low",
        status: "open",
        resolution: "",
      });
      toast({ title: "Ocorrência registrada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao registrar ocorrência" });
    },
  });

  const updateOccurrence = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof residentOccurrenceSchema> }) => {
      const payload: Record<string, unknown> = {
        residentId,
        type: data.type.trim(),
        description: data.description.trim(),
        severity: data.severity,
        status: data.status,
        resolution: data.resolution?.trim() || null,
      };
      if (data.status === "resolved") {
        payload.resolvedAt = new Date().toISOString();
      }
      const res = await fetch(`/api/occurrences/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao atualizar ocorrência.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", "resident-details", residentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setIsOccurrenceDialogOpen(false);
      setEditingOccurrence(null);
      toast({ title: "Ocorrência atualizada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao atualizar ocorrência" });
    },
  });

  const deleteOccurrence = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/occurrences/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir ocorrência.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", "resident-details", residentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Ocorrência removida" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao excluir ocorrência" });
    },
  });

  const createFamily = useMutation({
    mutationFn: async (data: z.infer<typeof familySchema>) => {
      if (data.portalAccess && (!data.portalPassword || data.portalPassword.length < 4)) {
        throw new Error("Senha obrigatoria para acesso ao portal (min. 4 caracteres).");
      }
      const res = await fetch(`/api/residents/${residentId}/family`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        let message = "Erro ao cadastrar familiar.";
        try {
          const payload = await res.json();
          if (payload?.message) message = payload.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "family"] });
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "family", "resident-details"] });
      setIsFamilyDialogOpen(false);
      setEditingFamily(null);
      setShowPortalPassword(false);
      familyForm.reset(defaultFamilyFormValues);
      toast({ title: "Familiar cadastrado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao cadastrar familiar" });
    },
  });

  const updateFamily = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof familySchema> }) => {
      if (data.portalPassword && data.portalPassword.length < 4) {
        throw new Error("Senha do portal deve ter ao menos 4 caracteres.");
      }
      const payload: Record<string, unknown> = { ...data };
      if (!payload.portalPassword) delete payload.portalPassword;
      const res = await fetch(`/api/family/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao atualizar familiar.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "family"] });
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "family", "resident-details"] });
      setIsFamilyDialogOpen(false);
      setEditingFamily(null);
      setShowPortalPassword(false);
      familyForm.reset(defaultFamilyFormValues);
      toast({ title: "Familiar atualizado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao atualizar familiar" });
    },
  });

  const deleteFamily = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/family/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao remover familiar.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "family"] });
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "family", "resident-details"] });
      toast({ title: "Familiar removido" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao remover familiar" });
    },
  });

  const createPatientDocument = useMutation({
    mutationFn: async (data: z.infer<typeof patientDocumentSchema>) => {
      const payload = {
        title: data.title.trim(),
        subtitle: data.subtitle?.trim() || null,
        category: data.category?.trim() || "document",
        fileName: data.fileName,
        fileType: data.fileType?.trim() || null,
        fileSize: data.fileSize ?? null,
        fileData: data.fileData,
      };
      const res = await fetch(`/api/residents/${residentId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao salvar documento.";
        try {
          const responseBody = await res.json();
          if (responseBody?.message) message = responseBody.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "documents", "resident-details"] });
      patientDocumentForm.reset(defaultPatientDocumentValues);
      toast({ title: "Documento salvo com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao salvar documento" });
    },
  });

  const deletePatientDocument = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/patient-documents/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao remover documento.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "documents", "resident-details"] });
      toast({ title: "Documento removido" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao remover documento" });
    },
  });

  const createContract = useMutation({
    mutationFn: async (data: z.infer<typeof contractSchema>) => {
      const payload = {
        ...data,
        endDate: data.endDate?.trim() ? data.endDate : undefined,
        paymentMethod: data.paymentMethod?.trim() ? data.paymentMethod : undefined,
        notes: data.notes?.trim() ? data.notes : undefined,
      };
      const res = await fetch("/api/contracts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao criar contrato.";
        try {
          const payload = await res.json();
          if (payload?.message) message = payload.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts", "resident-details", residentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setIsContractDialogOpen(false);
      setEditingContract(null);
      contractForm.reset({
        residentId,
        plan: "standard",
        monthlyValue: 3200,
        startDate: toDateInputValue(),
        paymentDay: 5,
        paymentMethod: "",
        notes: "",
        status: "active",
      });
      toast({ title: "Contrato criado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao criar contrato" });
    },
  });

  const updateContract = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof contractSchema> }) => {
      const payload = {
        ...data,
        endDate: data.endDate?.trim() ? data.endDate : undefined,
        paymentMethod: data.paymentMethod?.trim() ? data.paymentMethod : undefined,
        notes: data.notes?.trim() ? data.notes : undefined,
      };
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = "Erro ao atualizar contrato.";
        try {
          const payload = await res.json();
          if (payload?.message) message = payload.message;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts", "resident-details", residentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setIsContractDialogOpen(false);
      setEditingContract(null);
      toast({ title: "Contrato atualizado com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao atualizar contrato" });
    },
  });

  const deleteContract = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/contracts/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir contrato.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts", "resident-details", residentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Contrato excluido" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao excluir contrato" });
    },
  });

  const openCreateMedicationDialog = () => {
    setEditingMedication(null);
    medicationForm.reset({
      name: "",
      dosage: "",
      frequency: "",
      status: "active",
      route: "",
      scheduleTime: "",
      prescribedBy: "",
      notes: "",
      startDate: "",
      endDate: "",
    });
    setIsMedicationDialogOpen(true);
  };

  const openEditMedicationDialog = (medication: MedicationWithResident) => {
    setEditingMedication(medication);
    medicationForm.reset({
      name: medication.name || "",
      dosage: medication.dosage || "",
      frequency: medication.frequency || "",
      status: (medication.status as "active" | "suspended") || "active",
      route: medication.route || "",
      scheduleTime: extractPrimaryScheduleTime(medication.scheduleTime),
      prescribedBy: medication.prescribedBy || "",
      notes: medication.notes || "",
      startDate: medication.startDate || "",
      endDate: medication.endDate || "",
    });
    setIsMedicationDialogOpen(true);
  };

  const openDoseActionDialog = (dose: MedicationDoseScheduleItem) => {
    setSelectedDoseItem(dose);
    medicationDoseActionForm.reset({
      status: dose.status === "pending" ? "given" : dose.status,
      notes: dose.notes ?? "",
      staffId: dose.administeredByStaffId ?? activeMedicationAdministrators[0]?.id,
    });
    setIsDoseActionDialogOpen(true);
  };

  const openCreateShiftDialog = () => {
    const date = format(new Date(), "yyyy-MM-dd");
    const times = getDefaultShiftTimes("12h_manha", date, selectedStaffRule);
    setEditingShift(null);
    shiftForm.reset({
      staffId: defaultShiftStaffId,
      shiftType: "12h_manha",
      date,
      startTime: times.startTime,
      endTime: times.endTime,
      notes: "",
    });
    setIsShiftDialogOpen(true);
  };

  const openEditShiftDialog = (shift: ShiftWithDetails) => {
    setEditingShift(shift);
    shiftForm.reset({
      staffId: isCaregiver && defaultShiftStaffId ? defaultShiftStaffId : shift.staffId,
      shiftType: (shift.shiftType as "12h_manha" | "12h_noite" | "24h" | "avulso") || "avulso",
      date: format(new Date(shift.startTime), "yyyy-MM-dd"),
      startTime: format(new Date(shift.startTime), "yyyy-MM-dd'T'HH:mm"),
      endTime: format(new Date(shift.endTime), "yyyy-MM-dd'T'HH:mm"),
      notes: shift.notes || "",
    });
    setIsShiftDialogOpen(true);
  };

  const openCreateOccurrenceDialog = () => {
    setEditingOccurrence(null);
    occurrenceForm.reset({
      type: "Saude",
      description: "",
      severity: "low",
      status: "open",
      resolution: "",
    });
    setIsOccurrenceDialogOpen(true);
  };

  const openEditOccurrenceDialog = (occurrence: OccurrenceWithResident) => {
    setEditingOccurrence(occurrence);
    occurrenceForm.reset({
      type: occurrence.type || "",
      description: occurrence.description || "",
      severity: (occurrence.severity as "low" | "medium" | "high" | "critical") || "low",
      status: (occurrence.status as "open" | "in_progress" | "resolved") || "open",
      resolution: occurrence.resolution || "",
    });
    setIsOccurrenceDialogOpen(true);
  };

  const portalAccessValue = familyForm.watch("portalAccess");

  const openCreateFamilyDialog = () => {
    setEditingFamily(null);
    setShowPortalPassword(false);
    familyForm.reset(defaultFamilyFormValues);
    setIsFamilyDialogOpen(true);
  };

  const openEditFamilyDialog = (family: FamilyMember) => {
    setEditingFamily(family);
    setShowPortalPassword(false);
    familyForm.reset({
      name: family.name,
      relationship: family.relationship,
      phone: maskPhoneBR(family.phone),
      phone2: family.phone2 ? maskPhoneBR(family.phone2) : "",
      email: family.email ?? "",
      cpf: family.cpf ? maskCpf(family.cpf) : "",
      address: family.address ?? "",
      isPrimary: family.isPrimary ?? false,
      portalAccess: family.portalAccess ?? false,
      portalUsername: family.portalUsername ?? "",
      portalPassword: "",
    });
    setIsFamilyDialogOpen(true);
  };

  async function handlePatientDocumentSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readDocumentFileAsDataUrl(file);
      patientDocumentForm.setValue("fileName", file.name, { shouldDirty: true, shouldValidate: true });
      patientDocumentForm.setValue("fileType", file.type || "application/octet-stream", { shouldDirty: true });
      patientDocumentForm.setValue("fileSize", file.size, { shouldDirty: true });
      patientDocumentForm.setValue("fileData", dataUrl, { shouldDirty: true, shouldValidate: true });
      if (!patientDocumentForm.getValues("title").trim()) {
        patientDocumentForm.setValue("title", file.name.replace(/\.[^.]+$/, ""), { shouldDirty: true, shouldValidate: true });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Não foi possível carregar o arquivo.",
      });
    } finally {
      event.target.value = "";
    }
  }

  const openCreateContractDialog = () => {
    setEditingContract(null);
    contractForm.reset({
      residentId,
      plan: "standard",
      monthlyValue: 3200,
      startDate: resident?.admissionDate || toDateInputValue(),
      endDate: "",
      paymentDay: 5,
      paymentMethod: "",
      notes: "",
      status: "active",
    });
    setIsContractDialogOpen(true);
  };

  const openEditContractDialog = (contract: ContractWithResident) => {
    setEditingContract(contract);
    contractForm.reset({
      residentId: contract.residentId,
      plan: (contract.plan as "standard" | "premium" | "vip") || "standard",
      monthlyValue: contract.monthlyValue ?? 0,
      startDate: contract.startDate || "",
      endDate: contract.endDate || "",
      paymentDay: contract.paymentDay ?? 5,
      paymentMethod: contract.paymentMethod || "",
      notes: contract.notes || "",
      status: (contract.status as "active" | "suspended" | "terminated") || "active",
    });
    setIsContractDialogOpen(true);
  };

  if (!resident) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden p-0">
        <div className="max-h-[92vh] overflow-y-auto">
          <DialogHeader className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
            <DialogTitle className="sr-only">Detalhes do residente</DialogTitle>
            <div className="flex min-w-0 items-center gap-3 pr-8">
              <ResidentAvatar resident={resident} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-foreground">{resident.name}</h2>
                  <ResidentStatusBadge status={resident.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Bed className="h-3.5 w-3.5" />
                    Quarto {resident.roomNumber || "-"}
                  </span>
                  <span>Nasc. {formatResidentBirthDate(resident.birthDate)}</span>
                  {resident.careType === "home_care" || resident.address ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      <span className="truncate">
                        {resident.address
                          ? [resident.address, resident.addressNumber, resident.city].filter(Boolean).join(", ")
                          : "Home Care"}
                      </span>
                    </span>
                  ) : null}
                  <span className="truncate">{resident.contactName || "Sem contato principal"}</span>
                </div>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 p-4">
            <Tabs defaultValue={defaultTab} className="space-y-4">
              <TabsList className="flex h-auto w-full justify-start overflow-x-auto rounded-lg bg-muted/60 p-1">
                <TabsTrigger className="min-w-[132px] flex-1 sm:flex-none" value="medications" disabled={!canViewMedications}>
              Medicações
                </TabsTrigger>
                <TabsTrigger className="min-w-[124px] flex-1 sm:flex-none" value="documents" disabled={!canManageDocuments}>
              Documentos
                </TabsTrigger>
                <TabsTrigger className="min-w-[112px] flex-1 sm:flex-none" value="shifts" disabled={!canViewEscalas}>
              Escalas
                </TabsTrigger>
                <TabsTrigger className="min-w-[124px] flex-1 sm:flex-none" value="occurrences" disabled={!canViewOccurrences}>
              Ocorrências
                </TabsTrigger>
                <TabsTrigger className="min-w-[120px] flex-1 sm:flex-none" value="family" disabled={!canManageFamily}>
              Familiares
                </TabsTrigger>
                <TabsTrigger className="min-w-[112px] flex-1 sm:flex-none" value="contracts" disabled={!canManageContracts}>
              Contratos
                </TabsTrigger>
              </TabsList>

          <TabsContent value="medications" className="mt-0 space-y-4">
            {!canViewMedications ? (
              <ResidentTabNotice>
                Sem permissão para visualizar medicações.
              </ResidentTabNotice>
            ) : (
              <>
                <ResidentSectionHeader
                  title="Medicações prescritas"
                  description="Prescricoes ativas ou suspensas vinculadas ao residente."
                  action={
                    <Button size="sm" onClick={openCreateMedicationDialog}>
                      <Plus className="h-4 w-4 mr-1" />
                      Nova Medicação
                    </Button>
                  }
                />

                {medicationsQuery.isLoading ? (
                  <ResidentTabNotice>
                    Carregando medicações...
                  </ResidentTabNotice>
                ) : medicationsQuery.error ? (
                  <ResidentTabNotice variant="destructive">
                    {medicationsQuery.error instanceof Error
                      ? medicationsQuery.error.message
                      : "Erro ao carregar medicações."}
                  </ResidentTabNotice>
                ) : (medicationsQuery.data?.length ?? 0) === 0 ? (
                  <ResidentTabNotice>
                    Nenhuma medicação cadastrada para este residente.
                  </ResidentTabNotice>
                ) : (
                  <>
                    <div className="space-y-3 md:hidden">
                      {medicationsQuery.data?.map((medication) => (
                        <div key={medication.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{medication.name}</p>
                              <p className="text-sm text-muted-foreground">{medication.dosage}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                medication.status === "active"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                              }
                            >
                              {medicationStatusLabel[medication.status] ?? medication.status}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-1 text-sm text-muted-foreground">
                            <span>{getMedicationFrequencyLabel(medication.frequency)}</span>
                            {medication.route ? <span>Via: {medication.route}</span> : null}
                            {medication.prescribedBy ? <span>Prescrito por: {medication.prescribedBy}</span> : null}
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditMedicationDialog(medication)}
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              disabled={deleteMedication.isPending}
                              onClick={() => {
                                confirm({
                                  title: "Excluir medicação",
                                  description: `Excluir a medicação "${medication.name}"?`,
                                  confirmText: "Excluir",
                                  pendingText: "Excluindo...",
                                  variant: "destructive",
                                  onConfirm: () => deleteMedication.mutateAsync(medication.id),
                                });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto rounded-xl border border-border bg-card shadow-sm md:block">
                      <Table className="min-w-[720px]">
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Medicamento</TableHead>
                          <TableHead>Dose</TableHead>
                          <TableHead>Frequencia</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {medicationsQuery.data?.map((medication) => (
                          <TableRow key={medication.id}>
                            <TableCell className="font-medium">{medication.name}</TableCell>
                            <TableCell>{medication.dosage}</TableCell>
                            <TableCell>{getMedicationFrequencyLabel(medication.frequency)}</TableCell>
                            <TableCell>
                              {medicationStatusLabel[medication.status] ?? medication.status}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => openEditMedicationDialog(medication)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  disabled={deleteMedication.isPending}
                                  onClick={() => {
                                    confirm({
                                      title: "Excluir medicação",
                                      description: `Excluir a medicação "${medication.name}"?`,
                                      confirmText: "Excluir",
                                      pendingText: "Excluindo...",
                                      variant: "destructive",
                                      onConfirm: () => deleteMedication.mutateAsync(medication.id),
                                    });
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      </Table>
                    </div>
                  </>
                )}

                <Tabs defaultValue="agenda" className="space-y-3">
                  <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2">
                    <TabsTrigger value="agenda">Agenda de doses</TabsTrigger>
                    <TabsTrigger value="historico">Historico de administracoes</TabsTrigger>
                  </TabsList>

                  <TabsContent value="agenda" className="mt-0">
                    <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold text-foreground">Agenda de doses</h4>
                          <p className="text-xs text-muted-foreground">
                            Doses geradas por residente com base nos horários e período das prescrições.
                          </p>
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`show-registered-doses-resident-${residentId}`}
                              checked={showRegisteredMedicationDoses}
                              onCheckedChange={setShowRegisteredMedicationDoses}
                            />
                            <Label
                              htmlFor={`show-registered-doses-resident-${residentId}`}
                              className="cursor-pointer text-xs text-muted-foreground"
                            >
                              Mostrar registradas
                            </Label>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">De</Label>
                            <Popover
                              open={isFromMedicationCalendarOpen}
                              onOpenChange={setIsFromMedicationCalendarOpen}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 w-full min-w-[148px] justify-between px-2 font-normal"
                                >
                                  <span>{formatDateLabel(medicationScheduleRange.from)}</span>
                                  <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="end">
                                <Calendar
                                  mode="single"
                                  selected={parseDateOnly(medicationScheduleRange.from) ?? undefined}
                                  onSelect={handleMedicationFromDateSelect}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Ate</Label>
                            <Popover
                              open={isToMedicationCalendarOpen}
                              onOpenChange={setIsToMedicationCalendarOpen}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 w-full min-w-[148px] justify-between px-2 font-normal"
                                >
                                  <span>{formatDateLabel(medicationScheduleRange.to)}</span>
                                  <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="end">
                                <Calendar
                                  mode="single"
                                  selected={parseDateOnly(medicationScheduleRange.to) ?? undefined}
                                  onSelect={handleMedicationToDateSelect}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <Button type="button" size="sm" variant="secondary" onClick={applyMedicationRangeToday}>
                            Hoje
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              queryClient.invalidateQueries({
                                queryKey: [
                                  "/api/residents",
                                  residentId,
                                  "medication-dose-schedule",
                                  medicationScheduleRange.from,
                                  medicationScheduleRange.to,
                                ],
                              });
                            }}
                          >
                            Atualizar agenda
                          </Button>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Medicamento</Label>
                            <Select value={selectedMedicationDoseFilter} onValueChange={setSelectedMedicationDoseFilter}>
                              <SelectTrigger className="h-8 min-w-[210px]">
                                <SelectValue placeholder="Todos os medicamentos" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={ALL_MEDICATIONS_FILTER}>Todos os medicamentos</SelectItem>
                                {medicationDoseFilterOptions.map((name) => (
                                  <SelectItem key={name} value={name}>
                                    {name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {medicationDoseScheduleQuery.isLoading ? (
                        <ResidentTabNotice>
                          Carregando agenda de doses...
                        </ResidentTabNotice>
                      ) : medicationDoseScheduleQuery.error ? (
                        <ResidentTabNotice variant="destructive">
                          {medicationDoseScheduleQuery.error instanceof Error
                            ? medicationDoseScheduleQuery.error.message
                            : "Erro ao carregar agenda de doses."}
                        </ResidentTabNotice>
                      ) : (medicationDoseScheduleQuery.data?.doses.length ?? 0) === 0 ? (
                        <ResidentTabNotice>
                          Nenhuma dose gerada no período selecionado.
                        </ResidentTabNotice>
                      ) : visibleMedicationScheduleDoses.length === 0 ? (
                        <ResidentTabNotice>
                          Todas as doses deste período já foram registradas. Ative "Mostrar registradas" para visualizar.
                        </ResidentTabNotice>
                      ) : filteredVisibleMedicationScheduleDoses.length === 0 ? (
                        <ResidentTabNotice>
                          Nenhuma dose encontrada para o medicamento selecionado.
                        </ResidentTabNotice>
                      ) : (
                        <>
                          <div className="space-y-3 md:hidden">
                            {filteredVisibleMedicationScheduleDoses.map((dose) => (
                              <div key={dose.key} className="rounded-lg border border-border bg-background p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-foreground">{formatMedicationDoseDateTime(dose)}</p>
                                    <p className="truncate text-sm text-muted-foreground">{dose.medicationName}</p>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={medicationAdministrationStatusClass(dose.status)}
                                  >
                                    {medicationAdministrationStatusLabel[dose.status]}
                                  </Badge>
                                </div>
                                <div className="mt-3 grid gap-1 text-sm text-muted-foreground">
                                  <span>Dose: {dose.dosage}</span>
                                  <span>{getMedicationFrequencyLabel(dose.frequency)}</span>
                                  <span>Administrado por: {dose.administeredByName || "-"}</span>
                                  {dose.isOverdue && dose.status === "pending" ? (
                                    <span className="text-rose-600">Dose em atraso</span>
                                  ) : null}
                                </div>
                                <div className="mt-3 flex justify-end">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openDoseActionDialog(dose)}
                                  >
                                    {dose.status === "pending" ? "Registrar" : "Editar registro"}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                            <Table className="min-w-[860px]">
                            <TableHeader className="bg-muted/50">
                              <TableRow>
                                <TableHead>Data/Hora</TableHead>
                                <TableHead>Medicação</TableHead>
                                <TableHead>Dose</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Administrado por</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredVisibleMedicationScheduleDoses.map((dose) => (
                                <TableRow key={dose.key}>
                                  <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                      <span>{formatMedicationDoseDateTime(dose)}</span>
                                      {dose.isOverdue && dose.status === "pending" ? (
                                        <span className="text-[11px] text-rose-600">Dose em atraso</span>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-col">
                                      <span className="font-medium">{dose.medicationName}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {getMedicationFrequencyLabel(dose.frequency)}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell>{dose.dosage}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={medicationAdministrationStatusClass(dose.status)}
                                    >
                                      {medicationAdministrationStatusLabel[dose.status]}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {dose.administeredByName || "-"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => openDoseActionDialog(dose)}
                                    >
                                      {dose.status === "pending" ? "Registrar" : "Editar registro"}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                            </Table>
                          </div>
                        </>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="historico" className="mt-0">
                    <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">Historico de administracoes</h4>
                        <p className="text-xs text-muted-foreground">
                          Rastreabilidade completa por dose, com status, observações e responsável.
                        </p>
                      </div>
                      {medicationAdministrationHistoryQuery.isLoading ? (
                        <ResidentTabNotice>
                          Carregando historico...
                        </ResidentTabNotice>
                      ) : medicationAdministrationHistoryQuery.error ? (
                        <ResidentTabNotice variant="destructive">
                          {medicationAdministrationHistoryQuery.error instanceof Error
                            ? medicationAdministrationHistoryQuery.error.message
                            : "Erro ao carregar historico de administracoes."}
                        </ResidentTabNotice>
                      ) : (medicationAdministrationHistoryQuery.data?.length ?? 0) === 0 ? (
                        <ResidentTabNotice>
                          Nenhuma administração registrada para este residente.
                        </ResidentTabNotice>
                      ) : (
                        <>
                          <div className="space-y-3 md:hidden">
                            {medicationAdministrationHistoryQuery.data?.map((entry) => (
                              <div key={entry.id} className="rounded-lg border border-border bg-background p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-foreground">{entry.medicationName || "-"}</p>
                                    <p className="text-sm text-muted-foreground">
                                      Dose: {entry.scheduledFor ? format(new Date(entry.scheduledFor), "dd/MM/yyyy HH:mm") : "-"}
                                    </p>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={medicationAdministrationStatusClass(entry.status)}
                                  >
                                    {medicationAdministrationStatusLabel[entry.status]}
                                  </Badge>
                                </div>
                                <div className="mt-3 grid gap-1 text-sm text-muted-foreground">
                                  <span>Profissional: {entry.administeredByName || "-"}</span>
                                  <span>
                                    Registro: {entry.administeredAt
                                      ? format(new Date(entry.administeredAt), "dd/MM/yyyy HH:mm")
                                      : "-"}
                                  </span>
                                  {entry.notes ? <span>Obs.: {entry.notes}</span> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                            <Table className="min-w-[900px]">
                            <TableHeader className="bg-muted/50">
                              <TableRow>
                                <TableHead>Data/Hora da dose</TableHead>
                                <TableHead>Medicação</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Administrado por</TableHead>
                                <TableHead>Registro em</TableHead>
                                <TableHead>Observações</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {medicationAdministrationHistoryQuery.data?.map((entry) => (
                                <TableRow key={entry.id}>
                                  <TableCell>
                                    {entry.scheduledFor
                                      ? format(new Date(entry.scheduledFor), "dd/MM/yyyy HH:mm")
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="font-medium">{entry.medicationName || "-"}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={medicationAdministrationStatusClass(entry.status)}
                                    >
                                      {medicationAdministrationStatusLabel[entry.status]}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {entry.administeredByName || "-"}
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {entry.administeredAt
                                      ? format(new Date(entry.administeredAt), "dd/MM/yyyy HH:mm")
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="max-w-[260px]">
                                    <span className="text-sm text-muted-foreground">{entry.notes || "-"}</span>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                            </Table>
                          </div>
                        </>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </TabsContent>

          <TabsContent value="documents" className="mt-0 space-y-4">
            {!canManageDocuments ? (
              <ResidentTabNotice>
                Sem permissão para gerenciar documentos.
              </ResidentTabNotice>
            ) : (
              <>
                <ResidentSectionHeader
                  title="Documentos do paciente"
                  description="Exames, anamnese, contratos assinados e arquivos vinculados ao residente."
                />

                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <Form {...patientDocumentForm}>
                    <form
                      className="space-y-4"
                      onSubmit={patientDocumentForm.handleSubmit((data) => createPatientDocument.mutate(data))}
                    >
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FormField
                          control={patientDocumentForm.control}
                          name="title"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Titulo *</FormLabel>
                              <FormControl>
                                <Input placeholder="Ex: Contrato 2026" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={patientDocumentForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Categoria</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value || "document"}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="document">Documento</SelectItem>
                                  <SelectItem value="exam">Exame</SelectItem>
                                  <SelectItem value="anamnese">Anamnese</SelectItem>
                                  <SelectItem value="contract">Contrato</SelectItem>
                                  <SelectItem value="other">Outro</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={patientDocumentForm.control}
                        name="subtitle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Subtitulo</FormLabel>
                            <FormControl>
                              <Input placeholder="Ex: Exame de sangue - julho/2026" {...field} value={field.value ?? ""} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <div className="grid gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3 md:grid-cols-[1fr_auto] md:items-center">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {patientDocumentForm.watch("fileName") || "Nenhum arquivo selecionado"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            PDF, imagem ou documento até 15MB.
                            {patientDocumentForm.watch("fileSize")
                              ? ` Selecionado: ${formatFileSize(patientDocumentForm.watch("fileSize"))}.`
                              : ""}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            className="md:w-[260px]"
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,image/*,application/pdf"
                            onChange={handlePatientDocumentSelection}
                          />
                          <Button type="submit" disabled={createPatientDocument.isPending} className="gap-2">
                            <Upload className="h-4 w-4" />
                            Salvar
                          </Button>
                        </div>
                      </div>
                    </form>
                  </Form>
                </div>

                {patientDocumentsQuery.isLoading ? (
                  <ResidentTabNotice>
                    Carregando documentos...
                  </ResidentTabNotice>
                ) : patientDocumentsQuery.error ? (
                  <ResidentTabNotice variant="destructive">
                    {patientDocumentsQuery.error instanceof Error
                      ? patientDocumentsQuery.error.message
                      : "Erro ao carregar documentos."}
                  </ResidentTabNotice>
                ) : (patientDocumentsQuery.data?.length ?? 0) === 0 ? (
                  <ResidentTabNotice>
                    Nenhum documento cadastrado para este residente.
                  </ResidentTabNotice>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {patientDocumentsQuery.data?.map((document) => (
                      <div key={document.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-semibold text-foreground">{document.title}</p>
                              <Badge variant="secondary" className="text-[10px]">
                                {document.category || "documento"}
                              </Badge>
                            </div>
                            {document.subtitle ? (
                              <p className="mt-1 text-sm text-muted-foreground">{document.subtitle}</p>
                            ) : null}
                            <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                              <span className="truncate">{document.fileName}</span>
                              <span>{formatFileSize(document.fileSize)} - {formatDateTimeLabel(document.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!openDataUrlFile(document.fileData)) {
                                toast({
                                  variant: "destructive",
                                  title: "Não foi possível abrir",
                                  description: "Use o botao Baixar para salvar o arquivo.",
                                });
                              }
                            }}
                          >
                            Abrir
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => {
                              if (!downloadDataUrlFile(document.fileData, document.fileName || "documento")) {
                                toast({ variant: "destructive", title: "Não foi possível baixar o documento." });
                              }
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Baixar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            disabled={deletePatientDocument.isPending}
                            onClick={() => {
                              confirm({
                                title: "Remover documento",
                                description: `Remover "${document.title}" da ficha do residente?`,
                                confirmText: "Remover",
                                pendingText: "Removendo...",
                                variant: "destructive",
                                onConfirm: () => deletePatientDocument.mutateAsync(document.id),
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="shifts" className="mt-0 space-y-4">
            {!canViewEscalas ? (
              <ResidentTabNotice>
                Sem permissão para visualizar escalas.
              </ResidentTabNotice>
            ) : (
              <>
                <ResidentSectionHeader
                  title="Escalas vinculadas"
                  description="Plantões e cuidadores relacionados a este residente."
                  action={
                    <Button size="sm" onClick={openCreateShiftDialog}>
                      <Plus className="h-4 w-4 mr-1" />
                      Nova Escala
                    </Button>
                  }
                />

                {shiftsQuery.isLoading ? (
                  <ResidentTabNotice>
                    Carregando escalas...
                  </ResidentTabNotice>
                ) : shiftsQuery.error ? (
                  <ResidentTabNotice variant="destructive">
                    {shiftsQuery.error instanceof Error
                      ? shiftsQuery.error.message
                      : "Erro ao carregar escalas."}
                  </ResidentTabNotice>
                ) : (shiftsQuery.data?.length ?? 0) === 0 ? (
                  <ResidentTabNotice>
                    Nenhuma escala vinculada a este residente.
                  </ResidentTabNotice>
                ) : (
                  <>
                    <div className="space-y-3 md:hidden">
                      {shiftsQuery.data?.map((shift) => (
                        <div key={shift.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{shift.staffName || "-"}</p>
                              <p className="text-sm text-muted-foreground">
                                {shiftTypeLabel[shift.shiftType || ""] ?? shift.shiftType}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                onClick={() => openEditShiftDialog(shift)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                disabled={deleteShift.isPending}
                                onClick={() => {
                                  confirm({
                                    title: "Excluir escala vinculada",
                                    description: "Excluir esta escala vinculada?",
                                    confirmText: "Excluir",
                                    pendingText: "Excluindo...",
                                    variant: "destructive",
                                    onConfirm: () => deleteShift.mutateAsync(shift.id),
                                  });
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-1 text-sm text-muted-foreground">
                            <span>Inicio: {format(new Date(shift.startTime), "dd/MM/yyyy HH:mm")}</span>
                            <span>Fim: {format(new Date(shift.endTime), "dd/MM/yyyy HH:mm")}</span>
                            {shift.notes ? <span>Obs.: {shift.notes}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto rounded-xl border border-border bg-card shadow-sm md:block">
                      <Table className="min-w-[880px]">
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Cuidador</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Inicio</TableHead>
                          <TableHead>Fim</TableHead>
                          <TableHead>Observações</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shiftsQuery.data?.map((shift) => (
                          <TableRow key={shift.id}>
                            <TableCell className="font-medium">{shift.staffName || "-"}</TableCell>
                            <TableCell>{shiftTypeLabel[shift.shiftType || ""] ?? shift.shiftType}</TableCell>
                            <TableCell>{format(new Date(shift.startTime), "dd/MM/yyyy HH:mm")}</TableCell>
                            <TableCell>{format(new Date(shift.endTime), "dd/MM/yyyy HH:mm")}</TableCell>
                            <TableCell className="max-w-[220px] truncate">{shift.notes || "-"}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => openEditShiftDialog(shift)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  disabled={deleteShift.isPending}
                                  onClick={() => {
                                    confirm({
                                      title: "Excluir escala vinculada",
                                      description: "Excluir esta escala vinculada?",
                                      confirmText: "Excluir",
                                      pendingText: "Excluindo...",
                                      variant: "destructive",
                                      onConfirm: () => deleteShift.mutateAsync(shift.id),
                                    });
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="occurrences" className="mt-0 space-y-4">
            {!canViewOccurrences ? (
              <ResidentTabNotice>
                Sem permissão para visualizar ocorrências.
              </ResidentTabNotice>
            ) : (
              <>
                <ResidentSectionHeader
                  title="Ocorrências"
                  description="Registros clínicos, intercorrências e pendências acompanhadas pela equipe."
                  action={
                    <Button size="sm" variant="destructive" onClick={openCreateOccurrenceDialog}>
                      <Plus className="h-4 w-4 mr-1" />
                      Nova Ocorrência
                    </Button>
                  }
                />

                {occurrencesQuery.isLoading ? (
                  <ResidentTabNotice>
                    Carregando ocorrências...
                  </ResidentTabNotice>
                ) : occurrencesQuery.error ? (
                  <ResidentTabNotice variant="destructive">
                    {occurrencesQuery.error instanceof Error
                      ? occurrencesQuery.error.message
                      : "Erro ao carregar ocorrências."}
                  </ResidentTabNotice>
                ) : (occurrencesQuery.data?.length ?? 0) === 0 ? (
                  <ResidentTabNotice>
                    Nenhuma ocorrência registrada para este residente.
                  </ResidentTabNotice>
                ) : (
                  <>
                    <div className="space-y-3 md:hidden">
                      {occurrencesQuery.data?.map((occurrence) => (
                        <div key={occurrence.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{occurrence.type}</p>
                              <p className="text-sm text-muted-foreground">
                                {occurrence.createdAt ? format(new Date(occurrence.createdAt), "dd/MM/yyyy HH:mm") : "-"}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                onClick={() => openEditOccurrenceDialog(occurrence)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                disabled={deleteOccurrence.isPending}
                                onClick={() => {
                                  confirm({
                                    title: "Excluir ocorrência",
                                    description: "Excluir esta ocorrência?",
                                    confirmText: "Excluir",
                                    pendingText: "Excluindo...",
                                    variant: "destructive",
                                    onConfirm: () => deleteOccurrence.mutateAsync(occurrence.id),
                                  });
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant="outline">
                              {occurrenceSeverityLabel[occurrence.severity] ?? occurrence.severity}
                            </Badge>
                            <Badge variant="secondary">
                              {occurrenceStatusLabel[occurrence.status] ?? occurrence.status}
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm text-muted-foreground">{occurrence.description}</p>
                        </div>
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto rounded-xl border border-border bg-card shadow-sm md:block">
                      <Table className="min-w-[860px]">
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Gravidade</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Descricao</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {occurrencesQuery.data?.map((occurrence) => (
                          <TableRow key={occurrence.id}>
                            <TableCell className="font-medium">{occurrence.type}</TableCell>
                            <TableCell>
                              {occurrenceSeverityLabel[occurrence.severity] ?? occurrence.severity}
                            </TableCell>
                            <TableCell>
                              {occurrenceStatusLabel[occurrence.status] ?? occurrence.status}
                            </TableCell>
                            <TableCell>
                              {occurrence.createdAt
                                ? format(new Date(occurrence.createdAt), "dd/MM/yyyy HH:mm")
                                : "-"}
                            </TableCell>
                            <TableCell className="max-w-[260px] truncate">
                              {occurrence.description}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => openEditOccurrenceDialog(occurrence)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  disabled={deleteOccurrence.isPending}
                                  onClick={() => {
                                    confirm({
                                      title: "Excluir ocorrência",
                                      description: "Excluir esta ocorrência?",
                                      confirmText: "Excluir",
                                      pendingText: "Excluindo...",
                                      variant: "destructive",
                                      onConfirm: () => deleteOccurrence.mutateAsync(occurrence.id),
                                    });
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </>
            )}
          </TabsContent>

          <Dialog
            open={isMedicationDialogOpen}
            onOpenChange={(isOpen) => {
              setIsMedicationDialogOpen(isOpen);
              if (!isOpen) {
                setEditingMedication(null);
              }
            }}
          >
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>{editingMedication ? "Editar Medicação" : "Nova Medicação"}</DialogTitle>
              </DialogHeader>
              <Form {...medicationForm}>
                <form
                  onSubmit={medicationForm.handleSubmit((data) => {
                    if (editingMedication) {
                      updateMedication.mutate({ id: editingMedication.id, data });
                    } else {
                      createMedication.mutate(data);
                    }
                  })}
                  className="space-y-4"
                >
                  <FormField
                    control={medicationForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Medicação *</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={medicationForm.control}
                      name="dosage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dose *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={medicationForm.control}
                      name="frequency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Frequencia *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecionar frequencia" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {getMedicationFrequencyOptionsForValue(field.value).map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Para frequencias com mais de 1 dose ao dia, preencha tambem os Horario(s).
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={medicationForm.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="active">Ativo</SelectItem>
                              <SelectItem value="suspended">Suspenso</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={medicationForm.control}
                      name="route"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Via</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="Ex: oral" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={medicationForm.control}
                      name="startDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Inicio</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={medicationForm.control}
                      name="endDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fim</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={medicationForm.control}
                      name="scheduleTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Horario base {frequencyNeedsBaseTime(watchedMedicationFrequency) ? "*" : "(opcional)"}
                          </FormLabel>
                          <FormControl>
                            <Input type="time" {...field} value={field.value ?? ""} />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            Ex: a cada 6h + 08:00 = 08:00, 14:00, 20:00, 02:00.
                          </p>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={medicationForm.control}
                      name="prescribedBy"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Prescrito por</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={medicationForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Observações</FormLabel>
                        <FormControl>
                          <Textarea {...field} value={field.value ?? ""} rows={3} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsMedicationDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={createMedication.isPending || updateMedication.isPending}>
                      {editingMedication ? "Salvar" : "Adicionar"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={isDoseActionDialogOpen}
            onOpenChange={(isOpen) => {
              setIsDoseActionDialogOpen(isOpen);
              if (!isOpen) {
                setSelectedDoseItem(null);
              }
            }}
          >
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Registrar administração da dose</DialogTitle>
              </DialogHeader>
              {selectedDoseItem ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Dose selecionada</p>
                    <p className="text-sm font-medium text-foreground">
                      {selectedDoseItem.medicationName} ({selectedDoseItem.dosage})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatMedicationDoseDateTime(selectedDoseItem)}
                    </p>
                  </div>
                  <Form {...medicationDoseActionForm}>
                    <form
                      onSubmit={medicationDoseActionForm.handleSubmit((data) => {
                        if (!isCaregiver && !data.staffId) {
                          medicationDoseActionForm.setError("staffId", {
                            type: "manual",
                            message: "Profissional obrigatorio.",
                          });
                          return;
                        }
                        registerDoseAdministration.mutate(data);
                      })}
                      className="space-y-4"
                    >
                      <FormField
                        control={medicationDoseActionForm.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Status da dose</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="given">Administrado</SelectItem>
                                <SelectItem value="skipped">Não administrado</SelectItem>
                                <SelectItem value="refused">Recusado</SelectItem>
                                <SelectItem value="late">Atrasado</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {isCaregiver ? (
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                          <p className="text-xs text-muted-foreground">Profissional responsável</p>
                          <p className="text-sm font-medium text-foreground">
                            {user?.name || "Cuidador logado"}
                          </p>
                        </div>
                      ) : (
                        <FormField
                          control={medicationDoseActionForm.control}
                          name="staffId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Profissional que administrou *</FormLabel>
                              <Select
                                onValueChange={(value) => field.onChange(Number(value))}
                                value={field.value ? String(field.value) : undefined}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecionar profissional" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {activeMedicationAdministrators.map((member) => (
                                    <SelectItem key={member.id} value={String(member.id)}>
                                      {member.name}{member.role ? ` - ${member.role}` : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      <FormField
                        control={medicationDoseActionForm.control}
                        name="notes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Observações</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                value={field.value ?? ""}
                                rows={3}
                                placeholder="Ex: aferido sinais vitais antes da administração"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsDoseActionDialogOpen(false)}
                        >
                          Cancelar
                        </Button>
                        <Button type="submit" disabled={registerDoseAdministration.isPending}>
                          {registerDoseAdministration.isPending ? "Salvando..." : "Salvar dose"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </div>
              ) : null}
            </DialogContent>
          </Dialog>

          <Dialog
            open={isShiftDialogOpen}
            onOpenChange={(isOpen) => {
              setIsShiftDialogOpen(isOpen);
              if (!isOpen) {
                setEditingShift(null);
              }
            }}
          >
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>{editingShift ? "Editar Plantao" : "Novo Plantao"}</DialogTitle>
              </DialogHeader>
              <Form {...shiftForm}>
                <form
                  onSubmit={shiftForm.handleSubmit((data) => {
                    if (editingShift) {
                      updateShift.mutate({ id: editingShift.id, data });
                    } else {
                      createShift.mutate(data);
                    }
                  })}
                  className="space-y-4 pt-1"
                >
                  <FormField
                    control={shiftForm.control}
                    name="staffId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cuidador / Funcionário *</FormLabel>
                        <Select
                          onValueChange={(value) => {
                            const nextStaffId = Number(value);
                            const nextStaff = selectableStaff.find((staffMember) => staffMember.id === nextStaffId);
                            const nextRule = getShiftProfileRule(nextStaff?.shift, configuredShiftProfiles);
                            const allShiftTypes = ["12h_manha", "12h_noite", "24h", "avulso"] as Array<z.infer<typeof residentShiftSchema>["shiftType"]>;
                            const allowedShiftTypes = nextRule.enabled && nextRule.allowedShiftTypes.length > 0
                              ? nextRule.allowedShiftTypes.filter((item): item is z.infer<typeof residentShiftSchema>["shiftType"] =>
                                allShiftTypes.includes(item as z.infer<typeof residentShiftSchema>["shiftType"]),
                              )
                              : allShiftTypes;
                            const currentShiftType = shiftForm.getValues("shiftType");
                            const nextShiftType = allowedShiftTypes.includes(currentShiftType)
                              ? currentShiftType
                              : (allowedShiftTypes[0] ?? "12h_manha");
                            const date = shiftForm.getValues("date") || format(new Date(), "yyyy-MM-dd");
                            const suggestedTimes = getDefaultShiftTimes(nextShiftType, date, nextRule);
                            const previousStartClock = shiftForm.getValues("startTime")?.slice(11, 16);
                            const startTime = previousStartClock ? `${date}T${previousStartClock}` : suggestedTimes.startTime;
                            const durationHours = getResidentShiftDurationHours(nextShiftType, nextRule);
                            const endTime = durationHours
                              ? (addHoursToDateTimeInput(startTime, durationHours) ?? suggestedTimes.endTime)
                              : suggestedTimes.endTime;
                            field.onChange(nextStaffId);
                            shiftForm.setValue("shiftType", nextShiftType, { shouldDirty: true, shouldValidate: true });
                            shiftForm.setValue("date", date, { shouldDirty: true, shouldValidate: true });
                            shiftForm.setValue("startTime", startTime, { shouldDirty: true, shouldValidate: true });
                            shiftForm.setValue("endTime", endTime, { shouldDirty: true, shouldValidate: true });
                          }}
                          value={field.value ? String(field.value) : undefined}
                          disabled={isCaregiver}
                        >
                          <FormControl>
                            <SelectTrigger className="mt-1.5" data-testid="resident-shift-select-staff">
                              <SelectValue placeholder="Selecione o funcionário" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {selectableStaff.map((staffMember) => (
                              <SelectItem key={staffMember.id} value={String(staffMember.id)}>
                                {staffMember.name}{staffMember.role ? ` - ${staffMember.role}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isCaregiver && (
                          <p className="text-xs text-muted-foreground mt-1.5">
                            Como cuidador, voce so pode selecionar seu proprio cadastro.
                          </p>
                        )}
                        {selectedStaffRuleHint && (
                          <p className="text-xs text-muted-foreground mt-1.5">
                            {selectedStaffRuleHint}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div>
                    <Label className="text-sm font-medium">Tipo de Plantao *</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                      {availableShiftTypes.map((shiftType) => {
                        const meta = shiftTypeMeta[shiftType];
                        const Icon = meta.icon;
                        const isSelected = selectedShiftType === shiftType;
                        return (
                          <button
                            key={shiftType}
                            type="button"
                            onClick={() => {
                              const date = shiftForm.getValues("date") || format(new Date(), "yyyy-MM-dd");
                              const times = getDefaultShiftTimes(shiftType, date, selectedStaffRule);
                              shiftForm.setValue("shiftType", shiftType, { shouldDirty: true, shouldValidate: true });
                              shiftForm.setValue("date", date, { shouldDirty: true, shouldValidate: true });
                              shiftForm.setValue("startTime", times.startTime, { shouldDirty: true, shouldValidate: true });
                              shiftForm.setValue("endTime", times.endTime, { shouldDirty: true, shouldValidate: true });
                            }}
                            data-testid={`resident-shift-type-${shiftType}`}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left
                              ${isSelected
                                ? `${meta.selectedStyle} ring-2 ring-offset-1`
                                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              }`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <div>
                              <p className="leading-none">{meta.label}</p>
                              <p className="text-[10px] opacity-70 mt-0.5">{meta.hint}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <FormField
                      control={shiftForm.control}
                      name="date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Data do Plantao *</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              className="mt-1.5"
                              value={field.value ?? ""}
                              onChange={(event) => {
                                const date = event.target.value;
                                const suggestedTimes = getDefaultShiftTimes(selectedShiftType, date, selectedStaffRule);
                                const previousStartClock = shiftForm.getValues("startTime")?.slice(11, 16);
                                const startTime = previousStartClock ? `${date}T${previousStartClock}` : suggestedTimes.startTime;
                                const durationHours = getResidentShiftDurationHours(selectedShiftType, selectedStaffRule);
                                const endTime = durationHours
                                  ? (addHoursToDateTimeInput(startTime, durationHours) ?? suggestedTimes.endTime)
                                  : suggestedTimes.endTime;
                                field.onChange(date);
                                shiftForm.setValue("startTime", startTime, { shouldDirty: true, shouldValidate: true });
                                shiftForm.setValue("endTime", endTime, { shouldDirty: true, shouldValidate: true });
                              }}
                              data-testid="resident-shift-date"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormField
                        control={shiftForm.control}
                        name="startTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Inicio *</FormLabel>
                            <FormControl>
                              <Input
                                type="datetime-local"
                                className="mt-1.5"
                                {...field}
                                value={field.value ?? ""}
                                onChange={(event) => {
                                  const startTime = event.target.value;
                                  const durationHours = getResidentShiftDurationHours(selectedShiftType, selectedStaffRule);
                                  field.onChange(startTime);
                                  shiftForm.setValue("date", startTime.slice(0, 10) || shiftDate || "", { shouldDirty: true, shouldValidate: true });
                                  if (durationHours) {
                                    const endTime = addHoursToDateTimeInput(startTime, durationHours);
                                    if (endTime) {
                                      shiftForm.setValue("endTime", endTime, { shouldDirty: true, shouldValidate: true });
                                    }
                                  }
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={shiftForm.control}
                        name="endTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Fim *</FormLabel>
                            <FormControl>
                              <Input
                                type="datetime-local"
                                className="mt-1.5"
                                {...field}
                                value={field.value ?? ""}
                                onChange={(event) => {
                                  const endTime = event.target.value;
                                  const durationHours = getResidentShiftDurationHours(selectedShiftType, selectedStaffRule);
                                  field.onChange(endTime);
                                  if (durationHours) {
                                    const startTime = subtractHoursFromDateTimeInput(endTime, durationHours);
                                    if (startTime) {
                                      shiftForm.setValue("date", startTime.slice(0, 10), { shouldDirty: true, shouldValidate: true });
                                      shiftForm.setValue("startTime", startTime, { shouldDirty: true, shouldValidate: true });
                                    }
                                  }
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {getResidentShiftDurationHours(selectedShiftType, selectedStaffRule)
                        ? `Inicio e fim sao editaveis; ao alterar um deles, o outro e recalculado para ${getResidentShiftDurationHours(selectedShiftType, selectedStaffRule)}h.`
                        : "Inicio e fim podem ser ajustados livremente para plantão avulso."}
                    </p>
                  </div>

                  <FormField
                    control={shiftForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Observações</FormLabel>
                        <FormControl>
                          <Textarea
                            className="mt-1.5 resize-none"
                            {...field}
                            value={field.value ?? ""}
                            rows={2}
                            placeholder="Anotações sobre este plantão..."
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-3 pt-1">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setIsShiftDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1"
                      disabled={createShift.isPending || updateShift.isPending || !selectedStaffId}
                    >
                      {editingShift
                        ? (updateShift.isPending ? "Salvando..." : "Salvar Alteracoes")
                        : (createShift.isPending ? "Criando..." : "Criar Plantao")}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={isOccurrenceDialogOpen}
            onOpenChange={(isOpen) => {
              setIsOccurrenceDialogOpen(isOpen);
              if (!isOpen) {
                setEditingOccurrence(null);
              }
            }}
          >
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>{editingOccurrence ? "Editar Ocorrência" : "Nova Ocorrência"}</DialogTitle>
              </DialogHeader>
              <Form {...occurrenceForm}>
                <form
                  onSubmit={occurrenceForm.handleSubmit((data) => {
                    if (editingOccurrence) {
                      updateOccurrence.mutate({ id: editingOccurrence.id, data });
                    } else {
                      createOccurrence.mutate(data);
                    }
                  })}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={occurrenceForm.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={occurrenceForm.control}
                      name="severity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Gravidade</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Leve</SelectItem>
                              <SelectItem value="medium">Moderada</SelectItem>
                              <SelectItem value="high">Grave</SelectItem>
                              <SelectItem value="critical">Critica</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={occurrenceForm.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="open">Aberta</SelectItem>
                              <SelectItem value="in_progress">Em andamento</SelectItem>
                              <SelectItem value="resolved">Resolvida</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={occurrenceForm.control}
                      name="resolution"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Resolucao</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={occurrenceForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descricao *</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={4} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsOccurrenceDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" variant="destructive" disabled={createOccurrence.isPending || updateOccurrence.isPending}>
                      {editingOccurrence ? "Salvar" : "Registrar"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <TabsContent value="family" className="mt-0 space-y-4">
            {!canManageFamily ? (
              <ResidentTabNotice>
                Sem permissão para gerenciar familiares.
              </ResidentTabNotice>
            ) : (
              <>
                <ResidentSectionHeader
                  title="Familiares e portal"
                  description="Contatos autorizados, responsável principal e acesso ao portal da família."
                  action={
                    <Button size="sm" onClick={openCreateFamilyDialog}>
                      <Plus className="h-4 w-4 mr-1" />
                      Adicionar Familiar
                    </Button>
                  }
                />

                {familyQuery.isLoading ? (
                  <ResidentTabNotice>
                    Carregando familiares...
                  </ResidentTabNotice>
                ) : familyQuery.error ? (
                  <ResidentTabNotice variant="destructive">
                    {familyQuery.error instanceof Error
                      ? familyQuery.error.message
                      : "Erro ao carregar familiares."}
                  </ResidentTabNotice>
                ) : (familyQuery.data?.length ?? 0) === 0 ? (
                  <ResidentTabNotice>
                    Nenhum familiar cadastrado para este residente.
                  </ResidentTabNotice>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {familyQuery.data?.map((family) => (
                      <div key={family.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{family.name}</p>
                            <p className="text-sm text-muted-foreground">{family.relationship}</p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {family.isPrimary && (
                              <Badge variant="secondary" className="text-[10px]">Principal</Badge>
                            )}
                            {family.portalAccess && (
                              <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-cyan-700">
                                Portal
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-1 text-sm text-muted-foreground">
                          <span>{maskPhoneBR(family.phone)}</span>
                          {family.phone2 ? <span>{maskPhoneBR(family.phone2)}</span> : null}
                          {family.email ? <span className="truncate">{family.email}</span> : null}
                        </div>
                        {family.portalAccess && (
                          <div className="mt-3 inline-block rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs text-cyan-700">
                            Portal ativo @{family.portalUsername}
                          </div>
                        )}
                        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditFamilyDialog(family)}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            disabled={deleteFamily.isPending}
                            onClick={() => {
                              confirm({
                                title: "Remover familiar",
                                description: `Remover "${family.name}" dos familiares? ${
                                  family.portalAccess
                                    ? "O acesso ao portal desta pessoa também será removido."
                                    : ""
                                }`,
                                confirmText: "Remover",
                                pendingText: "Removendo...",
                                variant: "destructive",
                                onConfirm: () => deleteFamily.mutateAsync(family.id),
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <Dialog
                  open={isFamilyDialogOpen}
                  onOpenChange={(isOpen) => {
                    setIsFamilyDialogOpen(isOpen);
                    if (!isOpen) {
                      setEditingFamily(null);
                      setShowPortalPassword(false);
                      familyForm.reset(defaultFamilyFormValues);
                    }
                  }}
                >
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>{editingFamily ? "Editar Familiar" : "Adicionar Familiar"}</DialogTitle>
                    </DialogHeader>
                    <Form {...familyForm}>
                      <form
                        onSubmit={familyForm.handleSubmit((data) => {
                          if (editingFamily) {
                            updateFamily.mutate({ id: editingFamily.id, data });
                          } else {
                            createFamily.mutate(data);
                          }
                        })}
                        className="space-y-4"
                      >
                        <FormField
                          control={familyForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Nome *</FormLabel>
                              <FormControl>
                                <Input {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={familyForm.control}
                            name="relationship"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Parentesco *</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={familyForm.control}
                            name="phone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Telefone *</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    maxLength={15}
                                    value={field.value ?? ""}
                                    onChange={(event) => field.onChange(maskPhoneBR(event.target.value))}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={familyForm.control}
                            name="phone2"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Telefone 2</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    maxLength={15}
                                    value={field.value ?? ""}
                                    onChange={(event) => field.onChange(maskPhoneBR(event.target.value))}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={familyForm.control}
                            name="email"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>E-mail</FormLabel>
                                <FormControl>
                                  <Input type="email" {...field} value={field.value ?? ""} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={familyForm.control}
                            name="cpf"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>CPF</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="000.000.000-00"
                                    maxLength={14}
                                    {...field}
                                    value={field.value ?? ""}
                                    onChange={(e) => field.onChange(maskCpf(e.target.value))}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={familyForm.control}
                            name="address"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Endereço</FormLabel>
                                <FormControl>
                                  <Input {...field} value={field.value ?? ""} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="rounded-xl border border-border p-3 space-y-3">
                          <FormField
                            control={familyForm.control}
                            name="isPrimary"
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex items-center justify-between">
                                  <FormLabel className="m-0">Contato principal</FormLabel>
                                  <FormControl>
                                    <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                                  </FormControl>
                                </div>
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={familyForm.control}
                            name="portalAccess"
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Globe className="h-4 w-4 text-cyan-600" />
                                    <FormLabel className="m-0">Acesso ao portal da familia</FormLabel>
                                  </div>
                                  <FormControl>
                                    <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                                  </FormControl>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Ao ativar, o familiar podera acessar o portal para acompanhar o residente.
                                </p>
                              </FormItem>
                            )}
                          />
                        </div>

                        {portalAccessValue && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                              control={familyForm.control}
                              name="portalUsername"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Usuário do portal *</FormLabel>
                                  <FormControl>
                                    <Input {...field} value={field.value ?? ""} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={familyForm.control}
                              name="portalPassword"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Senha do portal</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        type={showPortalPassword ? "text" : "password"}
                                        placeholder={editingFamily ? "Deixe em branco para manter" : "Min. 4 caracteres"}
                                        {...field}
                                        value={field.value ?? ""}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setShowPortalPassword((oldValue) => !oldValue)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                      >
                                        {showPortalPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                      </button>
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        )}

                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => setIsFamilyDialogOpen(false)}>
                            Cancelar
                          </Button>
                          <Button type="submit" disabled={createFamily.isPending || updateFamily.isPending}>
                            {editingFamily ? "Salvar" : "Adicionar"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </TabsContent>

          <TabsContent value="contracts" className="mt-0 space-y-4">
            {!canManageContracts ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Sem permissão para gerenciar contratos.
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button size="sm" onClick={openCreateContractDialog}>
                    <Plus className="h-4 w-4 mr-1" />
                    Novo Contrato
                  </Button>
                </div>

                {contractsQuery.isLoading ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Carregando contratos...
                  </div>
                ) : contractsQuery.error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                    {contractsQuery.error instanceof Error
                      ? contractsQuery.error.message
                      : "Erro ao carregar contratos."}
                  </div>
                ) : (contractsQuery.data?.length ?? 0) === 0 ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Nenhum contrato cadastrado para este residente.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {contractsQuery.data?.map((contract) => (
                      <div key={contract.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-foreground">
                                Plano {contractPlanLabel[contract.plan || "standard"] || contract.plan}
                              </p>
                              <Badge variant="outline" className="text-[10px]">
                                {contractStatusLabel[contract.status || "active"] || contract.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Inicio: {contract.startDate ? format(new Date(`${contract.startDate}T00:00:00`), "dd/MM/yyyy") : "-"}
                              {contract.paymentDay ? ` · Vencimento dia ${contract.paymentDay}` : ""}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Valor mensal: R$ {(contract.monthlyValue ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </p>
                            {contract.notes && <p className="text-xs text-muted-foreground mt-1">{contract.notes}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => openEditContractDialog(contract)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              disabled={deleteContract.isPending}
                              onClick={() => {
                                confirm({
                                  title: "Excluir contrato",
                                  description: "Excluir este contrato? Esta ação não pode ser desfeita.",
                                  confirmText: "Excluir",
                                  pendingText: "Excluindo...",
                                  variant: "destructive",
                                  onConfirm: () => deleteContract.mutateAsync(contract.id),
                                });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <Dialog
                  open={isContractDialogOpen}
                  onOpenChange={(isOpen) => {
                    setIsContractDialogOpen(isOpen);
                    if (!isOpen) setEditingContract(null);
                  }}
                >
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>{editingContract ? "Editar Contrato" : "Novo Contrato"}</DialogTitle>
                    </DialogHeader>
                    <Form {...contractForm}>
                      <form
                        onSubmit={contractForm.handleSubmit((data) => {
                          if (editingContract) {
                            updateContract.mutate({ id: editingContract.id, data });
                          } else {
                            createContract.mutate(data);
                          }
                        })}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={contractForm.control}
                            name="plan"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Plano *</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="standard">Standard</SelectItem>
                                    <SelectItem value="premium">Premium</SelectItem>
                                    <SelectItem value="vip">VIP</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={contractForm.control}
                            name="monthlyValue"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Valor mensal *</FormLabel>
                                <FormControl>
                                  <Input type="number" step="0.01" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={contractForm.control}
                            name="startDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Data de início *</FormLabel>
                                <FormControl>
                                  <Input type="date" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={contractForm.control}
                            name="endDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Data de termino</FormLabel>
                                <FormControl>
                                  <Input type="date" {...field} value={field.value ?? ""} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={contractForm.control}
                            name="paymentDay"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Dia de vencimento</FormLabel>
                                <FormControl>
                                  <Input type="number" min={1} max={31} {...field} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={contractForm.control}
                            name="status"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Status</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="active">Ativo</SelectItem>
                                    <SelectItem value="suspended">Suspenso</SelectItem>
                                    <SelectItem value="terminated">Encerrado</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={contractForm.control}
                          name="paymentMethod"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Forma de pagamento</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value ?? ""} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={contractForm.control}
                          name="notes"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Observações</FormLabel>
                              <FormControl>
                                <Textarea rows={3} {...field} value={field.value ?? ""} />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => setIsContractDialogOpen(false)}>
                            Cancelar
                          </Button>
                          <Button type="submit" disabled={createContract.isPending || updateContract.isPending}>
                            {editingContract ? "Salvar" : "Criar contrato"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
      {confirmDialog}
    </Dialog>
  );
}

function ResidentDialog({ open, onOpenChange, resident }: { open: boolean; onOpenChange: (open: boolean) => void; resident: Resident | null }) {
  const createMutation = useCreateResident();
  const updateMutation = useUpdateResident();
  const { toast } = useToast();
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [isLookingUpCep, setIsLookingUpCep] = useState(false);

  const defaultValues: ResidentFormInput = {
    name: "",
    birthDate: "",
    gender: null,
    cpf: null,
    rg: null,
    susNumber: null,
    maritalStatus: null,
    nationality: "Brasileiro(a)",
    contactName: "",
    contactPhone: "",
    contactRelationship: null,
    bloodType: null,
    dietaryRestrictions: null,
    mobilityStatus: null,
    cognitiveStatus: null,
    admissionDate: toDateInputValue(),
    roomNumber: "",
    healthNotes: "",
    allergies: "",
    photoUrl: "",
    careType: "residential",
    cep: "",
    address: "",
    addressNumber: "",
    addressComplement: "",
    neighborhood: "",
    city: "",
    state: "",
    status: "active"
  };
  
  const form = useForm<ResidentFormInput>({
    resolver: zodResolver(residentFormSchema),
    defaultValues,
  });

  useEffect(() => {
    if (!open) return;

    if (resident) {
      form.reset({
        ...defaultValues,
        ...resident,
        birthDate: resident.birthDate ? toDateInputValue(resident.birthDate) : "",
        admissionDate: resident.admissionDate ? toDateInputValue(resident.admissionDate) : "",
        photoUrl: resident.photoUrl ?? "",
      });
      return;
    }

    form.reset(defaultValues);
  }, [open, resident, form]);

  const photoPreview = form.watch("photoUrl");

  async function handleLookupCep() {
    const currentCep = form.getValues("cep");
    if (digitsOnly(currentCep || "").length !== 8) {
      form.setError("cep", { type: "manual", message: "Informe um CEP válido." });
      return;
    }

    setIsLookingUpCep(true);
    try {
      const address = await fetchResidentAddressByCep(currentCep || "");
      form.setValue("cep", address.cep, { shouldDirty: true, shouldValidate: true });
      form.setValue("address", address.address, { shouldDirty: true, shouldValidate: true });
      form.setValue("neighborhood", address.neighborhood, { shouldDirty: true, shouldValidate: true });
      form.setValue("city", address.city, { shouldDirty: true, shouldValidate: true });
      form.setValue("state", address.state, { shouldDirty: true, shouldValidate: true });
      toast({ title: "Endereço preenchido pelo CEP." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Não foi possível buscar o CEP.",
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
        title: error instanceof Error ? error.message : "Não foi possível carregar a foto.",
      });
    } finally {
      setIsProcessingPhoto(false);
      event.target.value = "";
    }
  }

  function onSubmit(data: ResidentFormInput) {
    const payload: ResidentFormInput = {
      ...data,
      photoUrl: data.photoUrl?.trim() || null,
      careType: data.careType || "residential",
      cep: data.cep?.trim() || null,
      address: data.address?.trim() || null,
      addressNumber: data.addressNumber?.trim() || null,
      addressComplement: data.addressComplement?.trim() || null,
      neighborhood: data.neighborhood?.trim() || null,
      city: data.city?.trim() || null,
      state: data.state?.trim()?.toUpperCase() || null,
    };

    if (resident) {
      updateMutation.mutate({ id: resident.id, ...payload }, {
        onSuccess: () => onOpenChange(false)
      });
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => onOpenChange(false)
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{resident ? "Editar Residente" : "Novo Residente"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Foto do residente</p>
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-xl border border-border overflow-hidden bg-muted flex items-center justify-center">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Foto do residente" className="h-full w-full object-cover" />
                  ) : (
                    <div className="text-2xl font-semibold text-muted-foreground">
                      {(form.getValues("name") || resident?.name || "?").charAt(0)}
                    </div>
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
                    <FormLabel>Nome Completo *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Nascimento *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="roomNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quarto/Leito *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="admissionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Admissão *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bloodType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo sanguineo</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                      value={field.value ?? "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Não informado</SelectItem>
                        {BLOOD_TYPE_OPTIONS.map((item) => (
                          <SelectItem key={item} value={item}>{item}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mobilityStatus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobilidade</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                      value={field.value ?? "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a mobilidade" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Não informado</SelectItem>
                        {MOBILITY_STATUS_OPTIONS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cognitiveStatus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estado cognitivo</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                      value={field.value ?? "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o estado cognitivo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Não informado</SelectItem>
                        {COGNITIVE_STATUS_OPTIONS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsável *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone Responsável *</FormLabel>
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

            <div className="rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">Endereço e atendimento</p>
              </div>

              <FormField
                control={form.control}
                name="careType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de atendimento</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "residential"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="residential">Instituicao</SelectItem>
                        <SelectItem value="home_care">Home Care</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
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
                            onChange={(event) => field.onChange(maskCep(event.target.value))}
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
                      <FormLabel>Logradouro</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_1fr_96px] gap-4">
                <FormField
                  control={form.control}
                  name="addressNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="addressComplement"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Complemento</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="neighborhood"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bairro</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>UF</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          maxLength={2}
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cidade</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="healthNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações de Saúde</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="allergies"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Alergias</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "active"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                      <SelectItem value="deceased">Falecido</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending || isProcessingPhoto}>
                {resident ? "Salvar Alterações" : "Cadastrar"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
