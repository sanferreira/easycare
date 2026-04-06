import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useResidents, useCreateResident, useUpdateResident } from "@/hooks/use-residents";
import { useAuth } from "@/hooks/use-auth";
import { useEnvironmentSettings } from "@/hooks/use-environment-settings";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { canAccessRoute } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
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
import { Plus, Search, Trash2, Phone, Bed, Pencil, Eye, EyeOff, Globe, Sun, Moon, Timer, ClipboardList } from "lucide-react";
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
  type Contract,
} from "@shared/schema";
import { addDays, format } from "date-fns";
import { maskCpf, maskPhoneBR } from "@/lib/masks";
import { imageFileToDataUrl } from "@/lib/imageUpload";
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
type ResidentDetailsTab = "medications" | "shifts" | "occurrences" | "family" | "contracts";

const familySchema = z.object({
  name: z.string().min(2, "Nome obrigatorio"),
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
  message: "Usuario de portal obrigatorio",
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
  name: z.string().min(2, "Medicacao obrigatoria"),
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
  if (data.shiftType === "avulso") {
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
    return;
  }
  if (!data.date?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["date"],
      message: "Data obrigatoria",
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

const medicationAdministrationStatusLabel: Record<
  MedicationDoseScheduleItem["status"] | MedicationAdministrationWithDetails["status"],
  string
> = {
  pending: "Pendente",
  given: "Administrado",
  skipped: "Nao administrado",
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
    hint: "07:00 - 19:00",
    icon: Sun,
    selectedStyle: "bg-sky-100 text-sky-800 border-sky-200 ring-sky-500/25",
  },
  "12h_noite": {
    label: "12h Noite",
    hint: "19:00 - 07:00",
    icon: Moon,
    selectedStyle: "bg-violet-100 text-violet-800 border-violet-200 ring-violet-500/25",
  },
  "24h": {
    label: "Plantao 24h",
    hint: "07:00 - 07:00",
    icon: Timer,
    selectedStyle: "bg-amber-100 text-amber-800 border-amber-200 ring-amber-500/25",
  },
  avulso: {
    label: "Avulso",
    hint: "horario livre",
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

function getDefaultShiftTimes(
  type: z.infer<typeof residentShiftSchema>["shiftType"],
  date: string,
): { startTime: string; endTime: string } {
  if (!date) return { startTime: "", endTime: "" };
  const [year, month, day] = date.split("-").map(Number);
  const nextDay = new Date(year, month - 1, day + 1);
  const nextDate = format(nextDay, "yyyy-MM-dd");

  switch (type) {
    case "12h_manha":
      return { startTime: `${date}T07:00`, endTime: `${date}T19:00` };
    case "12h_noite":
      return { startTime: `${date}T19:00`, endTime: `${nextDate}T07:00` };
    case "24h":
      return { startTime: `${date}T07:00`, endTime: `${nextDate}T07:00` };
    default:
      return { startTime: `${date}T08:00`, endTime: `${date}T17:00` };
  }
}

function buildShiftRuleHint(rule: ReturnType<typeof getShiftProfileRule>): string | null {
  if (!rule.enabled) return null;
  const parts: string[] = [];
  if (rule.exactShiftHours) parts.push(`somente plantoes de ${rule.exactShiftHours}h`);
  if (rule.minRestHours) parts.push(`descanso minimo de ${rule.minRestHours}h entre escalas`);
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
      throw new Error("Sem permissao para visualizar este conteudo.");
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
  const canManageContracts = canAccessRoute(user?.role, "/financeiro", environmentSettings?.roleRoutes);

  const filteredResidents = residents?.filter(r => 
    r.name.toLowerCase().includes(search.toLowerCase())
  );

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

      <div className="flex items-center gap-2 bg-card p-3 sm:p-4 rounded-xl border border-border shadow-sm">
        <Search className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
        <Input 
          placeholder="Buscar por nome..." 
          value={search} 
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 focus-visible:ring-0 bg-transparent px-0 text-sm sm:text-base"
        />
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
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
                      {resident.photoUrl ? (
                        <img
                          src={resident.photoUrl}
                          alt={resident.name}
                          className="h-10 w-10 rounded-full object-cover border border-border"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-secondary text-primary flex items-center justify-center font-bold">
                          {resident.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{resident.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(resident.birthDate), "dd/MM/yyyy")}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <Bed className="h-4 w-4 text-muted-foreground" />
                      {resident.roomNumber}
                    </div>
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
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border
                      ${resident.status === 'active' 
                        ? 'bg-green-50 text-green-700 border-green-200' 
                        : resident.status === 'deceased'
                        ? 'bg-neutral-100 text-neutral-600 border-neutral-200'
                        : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                      }`}>
                      {resident.status === 'active' ? 'Ativo' : resident.status === 'deceased' ? 'Falecido' : 'Inativo'}
                    </span>
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
    if (tab === "contracts") return canManageContracts;
    return false;
  };

  const defaultTab = initialTab && isTabAllowed(initialTab)
    ? initialTab
    : canViewMedications
    ? "medications"
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
        "Erro ao carregar medicacoes.",
      ),
  });
  const [medicationScheduleRange, setMedicationScheduleRange] = useState(() => {
    const baseDate = new Date();
    return {
      from: format(baseDate, "yyyy-MM-dd"),
      to: format(addDays(baseDate, 6), "yyyy-MM-dd"),
    };
  });
  const [isDoseActionDialogOpen, setIsDoseActionDialogOpen] = useState(false);
  const [selectedDoseItem, setSelectedDoseItem] = useState<MedicationDoseScheduleItem | null>(null);

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

  const medicationAdministrationHistoryQuery = useQuery<MedicationAdministrationWithDetails[]>({
    queryKey: ["/api/medication-administrations", "resident-details", residentId],
    enabled: open && !!resident && canViewMedications,
    queryFn: () =>
      fetchResidentData<MedicationAdministrationWithDetails[]>(
        `/api/medication-administrations?residentId=${residentId}`,
        "Erro ao carregar historico de medicacoes.",
      ),
  });

  const occurrencesQuery = useQuery<OccurrenceWithResident[]>({
    queryKey: ["/api/occurrences", "resident-details", residentId],
    enabled: open && !!resident && canViewOccurrences,
    queryFn: () =>
      fetchResidentData<OccurrenceWithResident[]>(
        `/api/occurrences?residentId=${residentId}`,
        "Erro ao carregar ocorrencias.",
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

  const contractForm = useForm<z.infer<typeof contractSchema>>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      residentId,
      plan: "standard",
      monthlyValue: 3200,
      startDate: new Date().toISOString().split("T")[0],
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
      shiftForm.setValue("shiftType", availableShiftTypes[0] ?? "12h_manha", { shouldDirty: true, shouldValidate: true });
    }
  }, [availableShiftTypes, shiftForm]);

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
        throw new Error("Informe o horario base para esta frequencia.");
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
        let message = "Erro ao cadastrar medicacao.";
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
      toast({ title: "Medicacao cadastrada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao cadastrar medicacao" });
    },
  });

  const updateMedication = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof residentMedicationSchema> }) => {
      const scheduleTime = normalizeScheduleTimeValue(data.scheduleTime);
      if (frequencyNeedsBaseTime(data.frequency) && !scheduleTime) {
        throw new Error("Informe o horario base para esta frequencia.");
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
        let message = "Erro ao atualizar medicacao.";
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
      toast({ title: "Medicacao atualizada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao atualizar medicacao" });
    },
  });

  const deleteMedication = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/medications/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir medicacao.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/medications", "resident-details", residentId] });
      toast({ title: "Medicacao removida" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao excluir medicacao" });
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
        let message = "Erro ao registrar administracao da dose.";
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
        title: error.message || "Erro ao registrar administracao da dose",
      });
    },
  });

  const createShift = useMutation({
    mutationFn: async (data: z.infer<typeof residentShiftSchema>) => {
      const times = data.shiftType !== "avulso"
        ? getDefaultShiftTimes(data.shiftType, data.date || "")
        : { startTime: data.startTime || "", endTime: data.endTime || "" };
      const payload = {
        residentId,
        staffId: Number(data.staffId),
        shiftType: data.shiftType,
        startTime: new Date(times.startTime),
        endTime: new Date(times.endTime),
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
      const times = data.shiftType !== "avulso"
        ? getDefaultShiftTimes(data.shiftType, data.date || "")
        : { startTime: data.startTime || "", endTime: data.endTime || "" };
      const payload = {
        residentId,
        staffId: Number(data.staffId),
        shiftType: data.shiftType,
        startTime: new Date(times.startTime),
        endTime: new Date(times.endTime),
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
        let message = "Erro ao registrar ocorrencia.";
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
      toast({ title: "Ocorrencia registrada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao registrar ocorrencia" });
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
        let message = "Erro ao atualizar ocorrencia.";
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
      toast({ title: "Ocorrencia atualizada com sucesso" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao atualizar ocorrencia" });
    },
  });

  const deleteOccurrence = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/occurrences/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir ocorrencia.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", "resident-details", residentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Ocorrencia removida" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error.message || "Erro ao excluir ocorrencia" });
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
        startDate: new Date().toISOString().split("T")[0],
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
    setEditingShift(null);
    shiftForm.reset({
      staffId: defaultShiftStaffId,
      shiftType: "12h_manha",
      date: format(new Date(), "yyyy-MM-dd"),
      startTime: "",
      endTime: "",
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

  const openCreateContractDialog = () => {
    setEditingContract(null);
    contractForm.reset({
      residentId,
      plan: "standard",
      monthlyValue: 3200,
      startDate: resident?.admissionDate || new Date().toISOString().split("T")[0],
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
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhes do residente</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-center">
            {resident.photoUrl ? (
              <img
                src={resident.photoUrl}
                alt={resident.name}
                className="h-20 w-20 rounded-xl object-cover border border-border"
              />
            ) : (
              <div className="h-20 w-20 rounded-xl bg-secondary text-primary flex items-center justify-center text-2xl font-bold">
                {resident.name.charAt(0)}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Nome</p>
            <p className="font-semibold text-foreground">{resident.name}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Quarto</p>
            <p className="font-semibold text-foreground">{resident.roomNumber || "-"}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Nascimento</p>
            <p className="font-semibold text-foreground">
              {resident.birthDate ? format(new Date(resident.birthDate), "dd/MM/yyyy") : "-"}
            </p>
          </div>
        </div>

        <Tabs defaultValue={defaultTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
            <TabsTrigger value="medications" disabled={!canViewMedications}>
              Medicacoes
            </TabsTrigger>
            <TabsTrigger value="shifts" disabled={!canViewEscalas}>
              Escalas
            </TabsTrigger>
            <TabsTrigger value="occurrences" disabled={!canViewOccurrences}>
              Ocorrencias
            </TabsTrigger>
            <TabsTrigger value="family" disabled={!canManageFamily}>
              Familiares
            </TabsTrigger>
            <TabsTrigger value="contracts" disabled={!canManageContracts}>
              Contratos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="medications" className="mt-0">
            {!canViewMedications ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Sem permissao para visualizar medicacoes.
              </div>
            ) : (
              <>
                <div className="flex justify-end mb-3">
                  <Button size="sm" onClick={openCreateMedicationDialog}>
                    <Plus className="h-4 w-4 mr-1" />
                    Nova Medicacao
                  </Button>
                </div>

                {medicationsQuery.isLoading ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Carregando medicacoes...
                  </div>
                ) : medicationsQuery.error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                    {medicationsQuery.error instanceof Error
                      ? medicationsQuery.error.message
                      : "Erro ao carregar medicacoes."}
                  </div>
                ) : (medicationsQuery.data?.length ?? 0) === 0 ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Nenhuma medicacao cadastrada para este residente.
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Medicamento</TableHead>
                          <TableHead>Dose</TableHead>
                          <TableHead>Frequencia</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Acoes</TableHead>
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
                )}

                <Tabs defaultValue="agenda" className="mt-5 space-y-3">
                  <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2">
                    <TabsTrigger value="agenda">Agenda de doses</TabsTrigger>
                    <TabsTrigger value="historico">Historico de administracoes</TabsTrigger>
                  </TabsList>

                  <TabsContent value="agenda" className="mt-0">
                    <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">Agenda de doses</h4>
                          <p className="text-xs text-muted-foreground">
                            Doses geradas por residente com base nos horarios e periodo das prescricoes.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">De</Label>
                            <Input
                              type="date"
                              value={medicationScheduleRange.from}
                              onChange={(event) =>
                                setMedicationScheduleRange((prev) => ({ ...prev, from: event.target.value }))
                              }
                              className="h-8 w-full sm:w-[148px]"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Ate</Label>
                            <Input
                              type="date"
                              value={medicationScheduleRange.to}
                              onChange={(event) =>
                                setMedicationScheduleRange((prev) => ({ ...prev, to: event.target.value }))
                              }
                              className="h-8 w-full sm:w-[148px]"
                            />
                          </div>
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
                        </div>
                      </div>

                      {medicationDoseScheduleQuery.isLoading ? (
                        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                          Carregando agenda de doses...
                        </div>
                      ) : medicationDoseScheduleQuery.error ? (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                          {medicationDoseScheduleQuery.error instanceof Error
                            ? medicationDoseScheduleQuery.error.message
                            : "Erro ao carregar agenda de doses."}
                        </div>
                      ) : (medicationDoseScheduleQuery.data?.doses.length ?? 0) === 0 ? (
                        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                          Nenhuma dose gerada no periodo selecionado.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-border overflow-hidden">
                          <Table>
                            <TableHeader className="bg-muted/50">
                              <TableRow>
                                <TableHead>Data/Hora</TableHead>
                                <TableHead>Medicacao</TableHead>
                                <TableHead>Dose</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Administrado por</TableHead>
                                <TableHead className="text-right">Acoes</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {medicationDoseScheduleQuery.data?.doses.map((dose) => (
                                <TableRow key={dose.key}>
                                  <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                      <span>{format(new Date(dose.scheduledFor), "dd/MM/yyyy HH:mm")}</span>
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
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="historico" className="mt-0">
                    <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">Historico de administracoes</h4>
                        <p className="text-xs text-muted-foreground">
                          Rastreabilidade completa por dose, com status, observacoes e responsavel.
                        </p>
                      </div>
                      {medicationAdministrationHistoryQuery.isLoading ? (
                        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                          Carregando historico...
                        </div>
                      ) : medicationAdministrationHistoryQuery.error ? (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                          {medicationAdministrationHistoryQuery.error instanceof Error
                            ? medicationAdministrationHistoryQuery.error.message
                            : "Erro ao carregar historico de administracoes."}
                        </div>
                      ) : (medicationAdministrationHistoryQuery.data?.length ?? 0) === 0 ? (
                        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                          Nenhuma administracao registrada para este residente.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-border overflow-hidden">
                          <Table>
                            <TableHeader className="bg-muted/50">
                              <TableRow>
                                <TableHead>Data/Hora da dose</TableHead>
                                <TableHead>Medicacao</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Administrado por</TableHead>
                                <TableHead>Registro em</TableHead>
                                <TableHead>Observacoes</TableHead>
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
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </TabsContent>

          <TabsContent value="shifts" className="mt-0">
            {!canViewEscalas ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Sem permissao para visualizar escalas.
              </div>
            ) : (
              <>
                <div className="flex justify-end mb-3">
                  <Button size="sm" onClick={openCreateShiftDialog}>
                    <Plus className="h-4 w-4 mr-1" />
                    Nova Escala
                  </Button>
                </div>

                {shiftsQuery.isLoading ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Carregando escalas...
                  </div>
                ) : shiftsQuery.error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                    {shiftsQuery.error instanceof Error
                      ? shiftsQuery.error.message
                      : "Erro ao carregar escalas."}
                  </div>
                ) : (shiftsQuery.data?.length ?? 0) === 0 ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Nenhuma escala vinculada a este residente.
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Cuidador</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Inicio</TableHead>
                          <TableHead>Fim</TableHead>
                          <TableHead>Observacoes</TableHead>
                          <TableHead className="text-right">Acoes</TableHead>
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
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="occurrences" className="mt-0">
            {!canViewOccurrences ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Sem permissao para visualizar ocorrencias.
              </div>
            ) : (
              <>
                <div className="flex justify-end mb-3">
                  <Button size="sm" variant="destructive" onClick={openCreateOccurrenceDialog}>
                    <Plus className="h-4 w-4 mr-1" />
                    Nova Ocorrencia
                  </Button>
                </div>

                {occurrencesQuery.isLoading ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Carregando ocorrencias...
                  </div>
                ) : occurrencesQuery.error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                    {occurrencesQuery.error instanceof Error
                      ? occurrencesQuery.error.message
                      : "Erro ao carregar ocorrencias."}
                  </div>
                ) : (occurrencesQuery.data?.length ?? 0) === 0 ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Nenhuma ocorrencia registrada para este residente.
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Gravidade</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Descricao</TableHead>
                          <TableHead className="text-right">Acoes</TableHead>
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
                <DialogTitle>{editingMedication ? "Editar Medicacao" : "Nova Medicacao"}</DialogTitle>
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
                        <FormLabel>Medicacao *</FormLabel>
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
                        <FormLabel>Observacoes</FormLabel>
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
                <DialogTitle>Registrar administracao da dose</DialogTitle>
              </DialogHeader>
              {selectedDoseItem ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Dose selecionada</p>
                    <p className="text-sm font-medium text-foreground">
                      {selectedDoseItem.medicationName} ({selectedDoseItem.dosage})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(selectedDoseItem.scheduledFor), "dd/MM/yyyy HH:mm")}
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
                                <SelectItem value="skipped">Nao administrado</SelectItem>
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
                          <p className="text-xs text-muted-foreground">Profissional responsavel</p>
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
                            <FormLabel>Observacoes</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                value={field.value ?? ""}
                                rows={3}
                                placeholder="Ex: aferido sinais vitais antes da administracao"
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
                        <FormLabel>Cuidador / Funcionario *</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(Number(value))}
                          value={field.value ? String(field.value) : undefined}
                          disabled={isCaregiver}
                        >
                          <FormControl>
                            <SelectTrigger className="mt-1.5" data-testid="resident-shift-select-staff">
                              <SelectValue placeholder="Selecione o funcionario" />
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
                            onClick={() => shiftForm.setValue("shiftType", shiftType, { shouldDirty: true, shouldValidate: true })}
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

                  {selectedShiftType !== "avulso" ? (
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
                              onChange={(event) => field.onChange(event.target.value)}
                              data-testid="resident-shift-date"
                            />
                          </FormControl>
                          {shiftDate && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {(() => {
                                const times = getDefaultShiftTimes(selectedShiftType, shiftDate);
                                const hasCrossDayEnd = selectedShiftType !== "12h_manha";
                                return `Das ${times.startTime.split("T")[1]} as ${times.endTime.split("T")[1]}${hasCrossDayEnd ? " (dia seguinte)" : ""}`;
                              })()}
                            </p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormField
                        control={shiftForm.control}
                        name="startTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Inicio *</FormLabel>
                            <FormControl>
                              <Input type="datetime-local" className="mt-1.5" {...field} value={field.value ?? ""} />
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
                              <Input type="datetime-local" className="mt-1.5" {...field} value={field.value ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  <FormField
                    control={shiftForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Observacoes</FormLabel>
                        <FormControl>
                          <Textarea
                            className="mt-1.5 resize-none"
                            {...field}
                            value={field.value ?? ""}
                            rows={2}
                            placeholder="Anotacoes sobre este plantao..."
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
                <DialogTitle>{editingOccurrence ? "Editar Ocorrencia" : "Nova Ocorrencia"}</DialogTitle>
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
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Sem permissao para gerenciar familiares.
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button size="sm" onClick={openCreateFamilyDialog}>
                    <Plus className="h-4 w-4 mr-1" />
                    Adicionar Familiar
                  </Button>
                </div>

                {familyQuery.isLoading ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Carregando familiares...
                  </div>
                ) : familyQuery.error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                    {familyQuery.error instanceof Error
                      ? familyQuery.error.message
                      : "Erro ao carregar familiares."}
                  </div>
                ) : (familyQuery.data?.length ?? 0) === 0 ? (
                  <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                    Nenhum familiar cadastrado para este residente.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {familyQuery.data?.map((family) => (
                      <div key={family.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-foreground">{family.name}</p>
                            <p className="text-sm text-muted-foreground">{family.relationship}</p>
                            <p className="text-sm text-muted-foreground">{maskPhoneBR(family.phone)}</p>
                            {family.phone2 && (
                              <p className="text-sm text-muted-foreground">{maskPhoneBR(family.phone2)}</p>
                            )}
                            {family.email && <p className="text-xs text-muted-foreground">{family.email}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            {family.isPrimary && (
                              <Badge variant="secondary" className="text-[10px]">Principal</Badge>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => openEditFamilyDialog(family)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {family.portalAccess && (
                          <div className="mt-2 text-xs text-cyan-600 bg-cyan-50 border border-cyan-200 rounded-md px-2 py-1 inline-block">
                            Portal ativo @{family.portalUsername}
                          </div>
                        )}
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
                                <FormLabel>Endereco</FormLabel>
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
                                  <FormLabel>Usuario do portal *</FormLabel>
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
                Sem permissao para gerenciar contratos.
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
                                <FormLabel>Data de inicio *</FormLabel>
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
                              <FormLabel>Observacoes</FormLabel>
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

  const defaultValues: ResidentFormInput = {
    name: "",
    birthDate: "",
    contactName: "",
    contactPhone: "",
    bloodType: null,
    mobilityStatus: null,
    cognitiveStatus: null,
    admissionDate: new Date().toISOString().split('T')[0],
    roomNumber: "",
    healthNotes: "",
    allergies: "",
    photoUrl: "",
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
        birthDate: resident.birthDate ? new Date(resident.birthDate).toISOString().split('T')[0] : "",
        admissionDate: resident.admissionDate ? new Date(resident.admissionDate).toISOString().split('T')[0] : "",
        photoUrl: resident.photoUrl ?? "",
      });
      return;
    }

    form.reset(defaultValues);
  }, [open, resident, form]);

  const photoPreview = form.watch("photoUrl");

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
        title: error instanceof Error ? error.message : "Nao foi possivel carregar a foto.",
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
                    <FormLabel>Nome Completo</FormLabel>
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
                    <FormLabel>Data de Nascimento</FormLabel>
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
                    <FormLabel>Quarto/Leito</FormLabel>
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
                    <FormLabel>Data de Admissão</FormLabel>
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
                        <SelectItem value="none">Nao informado</SelectItem>
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
                        <SelectItem value="none">Nao informado</SelectItem>
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
                        <SelectItem value="none">Nao informado</SelectItem>
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
                    <FormLabel>Responsável</FormLabel>
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
                    <FormLabel>Telefone Responsável</FormLabel>
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
