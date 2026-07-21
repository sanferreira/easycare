import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEnvironmentSettings } from "@/hooks/use-environment-settings";
import { useResidents } from "@/hooks/use-residents";
import { useStaff } from "@/hooks/use-staff";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus, FileText, Stethoscope, Heart, Users2,
  Activity, Thermometer, Wind, Smile, Lock, Eye, EyeOff, Globe, Trash2, Pencil, Pill, AlertTriangle, Check, ChevronsUpDown, Printer, MapPin
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { MedicalRecord, Comorbidity, FamilyMember, Medication, MedicationAdministration, Occurrence } from "@shared/schema";
import { maskCpf, maskPhoneBR } from "@/lib/masks";
import { canAccessRoute, canEditRoute } from "@/lib/permissions";
import { toDateInputValue } from "@/lib/date";
import { printHtmlDocument } from "@/lib/print";
import { ResidentMedicationSection } from "@/components/prontuario/ResidentMedicationSection";
import { ResidentOccurrenceSection } from "@/components/prontuario/ResidentOccurrenceSection";
import { cn } from "@/lib/utils";

type ProntuarioTab = "evolution" | "diagnoses" | "medications" | "occurrences" | "family";
type MedicationSectionTab = "medicações" | "agenda" | "historico";
type MedicalRecordWithStaff = MedicalRecord & { staffName?: string | null };
type MedicationWithResident = Medication & { residentName?: string | null };
type MedicationAdministrationWithDetails = MedicationAdministration & {
  medicationName?: string | null;
  residentName?: string | null;
  administeredByName?: string | null;
};
type OccurrenceWithResident = Occurrence & { residentName?: string | null };

const evolutionSchema = z.object({
  date: z.string().min(1, "Data obrigatória"),
  type: z.enum(["evolution", "note", "prescription"]),
  staffId: z.coerce.number().optional().nullable(),
  title: z.string().optional(),
  content: z.string().min(1, "Conteúdo obrigatório"),
  visibility: z.enum(["internal", "shared"]),
  bloodPressure: z.string().optional(),
  heartRate: z.coerce.number().optional().nullable(),
  temperature: z.coerce.number().optional().nullable(),
  oxygenSat: z.coerce.number().optional().nullable(),
  weight: z.coerce.number().optional().nullable(),
  glucoseLevel: z.coerce.number().optional().nullable(),
  mood: z.string().optional(),
  dailyChecklist: z.object({
    feeding: z.boolean().default(false),
    bath: z.boolean().default(false),
    afternoonCoffee: z.boolean().default(false),
    rest: z.boolean().default(false),
  }).optional(),
});

const comorbiditySchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  icd10: z.string().optional(),
  severity: z.enum(["mild", "moderate", "severe"]),
  notes: z.string().optional(),
  diagnosedAt: z.string().optional(),
});

const familySchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  relationship: z.string().min(1, "Parentesco obrigatório"),
  phone: z.string().min(1, "Telefone obrigatório"),
  phone2: z.string().optional(),
  email: z.string().optional(),
  cpf: z.string().optional(),
  address: z.string().optional(),
  isPrimary: z.boolean().default(false),
  portalAccess: z.boolean().default(false),
  portalUsername: z.string().optional(),
  portalPassword: z.string().optional(),
}).refine((d) => {
  if (d.portalAccess) {
    if (!d.portalUsername || d.portalUsername.trim().length < 3) return false;
  }
  return true;
}, { message: "Usuário de acesso (mín. 3 caracteres) é obrigatório para acesso ao portal", path: ["portalUsername"] });

const SEVERITY_MAP = {
  mild: { label: "Leve", color: "#22C55E" },
  moderate: { label: "Moderada", color: "#F59E0B" },
  severe: { label: "Grave", color: "#EF4444" },
};

const TYPE_MAP = {
  evolution: { label: "Evolução Diária", color: "#1F6FEB" },
  note: { label: "Anotação", color: "#8B5CF6" },
  anamnese: { label: "Anamnese", color: "#22D3EE" },
  prescription: { label: "Prescrição", color: "#22C55E" },
};

const MEDICATION_STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
};

const MEDICATION_ADMINISTRATION_STATUS_LABELS: Record<string, string> = {
  given: "Administrado",
  skipped: "Não administrado",
  refused: "Recusado",
  late: "Atrasado",
};

const OCCURRENCE_SEVERITY_LABELS: Record<string, string> = {
  low: "Leve",
  medium: "Moderada",
  high: "Grave",
  critical: "Critica",
};

const OCCURRENCE_STATUS_LABELS: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  resolved: "Resolvida",
};

const MOOD_MAP: Record<string, string> = {
  bom: "😊 Bom",
  regular: "😐 Regular",
  agitado: "😤 Agitado",
  sonolento: "😴 Sonolento",
  ansioso: "😟 Ansioso",
  triste: "😢 Triste",
};

const DAILY_CHECKLIST_OPTIONS = [
  { key: "feeding", label: "Alimentacao" },
  { key: "bath", label: "Banho" },
  { key: "afternoonCoffee", label: "Cafe da tarde" },
  { key: "rest", label: "Descanso" },
] as const;

type DailyChecklistKey = (typeof DAILY_CHECKLIST_OPTIONS)[number]["key"];

function createEmptyDailyChecklist(): Record<DailyChecklistKey, boolean> {
  return {
    feeding: false,
    bath: false,
    afternoonCoffee: false,
    rest: false,
  };
}

function parseDailyChecklist(raw: unknown): Record<DailyChecklistKey, boolean> {
  if (typeof raw !== "string" || raw.trim().length === 0) return createEmptyDailyChecklist();
  try {
    const parsed = JSON.parse(raw) as Partial<Record<DailyChecklistKey, unknown>>;
    return {
      feeding: parsed.feeding === true,
      bath: parsed.bath === true,
      afternoonCoffee: parsed.afternoonCoffee === true,
      rest: parsed.rest === true,
    };
  } catch {
    return createEmptyDailyChecklist();
  }
}

function getResidentAge(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

const RECENT_RESIDENTS_STORAGE_KEY = "easycare:prontuario:recent-residents";
const MAX_RECENT_RESIDENTS = 5;

function loadRecentResidentIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_RESIDENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, MAX_RECENT_RESIDENTS);
  } catch {
    return [];
  }
}

function saveRecentResidentIds(ids: number[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_RESIDENTS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore localStorage failures
  }
}

function getResidentSelectorSubtitle(resident: any): string {
  if (!resident) return "Busque por nome ou quarto";
  const age = getResidentAge(resident.birthDate);
  const parts: string[] = [];
  if (resident.roomNumber) parts.push(`Quarto ${resident.roomNumber}`);
  if (age !== null) parts.push(`${age} anos`);
  return parts.length > 0 ? parts.join(" | ") : "Sem quarto";
}

function ProntuarioResidentAvatar({
  resident,
  size = "sm",
}: {
  resident?: any | null;
  size?: "xs" | "sm" | "lg";
}) {
  const sizeClass = size === "lg"
    ? "h-12 w-12 text-lg"
    : size === "xs"
      ? "h-7 w-7 text-[11px]"
      : "h-8 w-8 text-xs";
  const name = String(resident?.name ?? "?");
  const initial = name.charAt(0).toUpperCase() || "?";

  if (resident?.photoUrl) {
    return (
      <img
        src={resident.photoUrl}
        alt={name}
        className={`${sizeClass} shrink-0 rounded-full border border-border object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full font-bold text-white`}
      style={{ background: "linear-gradient(135deg, #1F6FEB, #22D3EE)" }}
    >
      {initial}
    </div>
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatRecordDate(value?: string | Date | null): string {
  if (!value) return "-";
  const dateText = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00`
    : value;
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("pt-BR");
}

function formatReportDateTime(value?: string | Date | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatOptionalValue(value: unknown, suffix = ""): string {
  if (value === null || value === undefined || value === "") return "-";
  return `${value}${suffix}`;
}

async function fetchReportArray<T>(url: string, fallbackMessage: string): Promise<T[]> {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 403) return [];
  if (!res.ok) throw new Error(fallbackMessage);
  const data = await res.json();
  return Array.isArray(data) ? data as T[] : [];
}

export default function Prontuario() {
  const [selectedResident, setSelectedResident] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<ProntuarioTab>("evolution");
  const [focusedMedicationId, setFocusedMedicationId] = useState<number | null>(null);
  const [focusedMedicationScheduledFor, setFocusedMedicationScheduledFor] = useState<string | null>(null);
  const [medicationInitialTab, setMedicationInitialTab] = useState<MedicationSectionTab | undefined>(undefined);
  const [residentSelectorOpen, setResidentSelectorOpen] = useState(false);
  const [recentResidentIds, setRecentResidentIds] = useState<number[]>(() => loadRecentResidentIds());
  const [evolutionOpen, setEvolutionOpen] = useState(false);
  const [comorbidityOpen, setComorbidityOpen] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [editingFamily, setEditingFamily] = useState<FamilyMember | null>(null);
  const [showPortalPassword, setShowPortalPassword] = useState(false);
  const [routeLocation] = useLocation();
  const routeSearch = useSearch();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: environmentSettings } = useEnvironmentSettings();
  const { data: residents = [], isLoading: residentsLoading } = useResidents({ status: "active" });
  const { data: staffMembers = [] } = useStaff();
  const canViewProntuario = canAccessRoute(user?.role, "/prontuario", environmentSettings?.roleRoutes);
  const canEditProntuario = canEditRoute(
    user?.role,
    "/prontuario",
    environmentSettings?.roleRoutes,
    environmentSettings?.roleEditRoutes,
  );
  const sortedResidents = useMemo(
    () =>
      [...residents].sort((left: any, right: any) =>
        String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "pt-BR"),
      ),
    [residents],
  );
  const recentResidents = useMemo(
    () =>
      recentResidentIds
        .map((id) => sortedResidents.find((item: any) => item.id === id))
        .filter((item): item is any => Boolean(item)),
    [recentResidentIds, sortedResidents],
  );
  const nonRecentResidents = useMemo(() => {
    const recentSet = new Set(recentResidents.map((item) => item.id));
    return sortedResidents.filter((item: any) => !recentSet.has(item.id));
  }, [recentResidents, sortedResidents]);
  const activeStaffMembers = useMemo(
    () =>
      [...staffMembers]
        .filter((member: any) => member.active !== false)
        .sort((left: any, right: any) => String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "pt-BR")),
    [staffMembers],
  );

  const resident = residents.find((r: any) => r.id === selectedResident);
  const residentAge = getResidentAge(resident?.birthDate);

  useEffect(() => {
    const params = new URLSearchParams(routeSearch);
    const requestedResidentId = Number(params.get("residentId"));
    const requestedMedicationId = Number(params.get("medicationId"));
    const requestedTab = params.get("tab");
    const requestedMedicationTab = params.get("medicationTab");
    const requestedScheduledFor = params.get("scheduledFor");

    if (Number.isInteger(requestedResidentId) && requestedResidentId > 0) {
      setSelectedResident(requestedResidentId);
    }
    if (
      requestedTab === "evolution"
      || requestedTab === "diagnoses"
      || requestedTab === "medications"
      || requestedTab === "occurrences"
      || requestedTab === "family"
    ) {
      setActiveTab(requestedTab);
    }
    setFocusedMedicationId(Number.isInteger(requestedMedicationId) && requestedMedicationId > 0 ? requestedMedicationId : null);
    setFocusedMedicationScheduledFor(requestedScheduledFor || null);
    setMedicationInitialTab(
      requestedMedicationTab === "medicações"
      || requestedMedicationTab === "agenda"
      || requestedMedicationTab === "historico"
        ? requestedMedicationTab
        : requestedMedicationId > 0
          ? "agenda"
          : undefined,
    );
  }, [routeLocation, routeSearch]);

  useEffect(() => {
    if (!selectedResident) return;
    setRecentResidentIds((previous) => {
      const next = [selectedResident, ...previous.filter((id) => id !== selectedResident)].slice(0, MAX_RECENT_RESIDENTS);
      saveRecentResidentIds(next);
      return next;
    });
  }, [selectedResident]);

  useEffect(() => {
    const residentIdSet = new Set(residents.map((item: any) => item.id));
    setRecentResidentIds((previous) => {
      const next = previous.filter((id) => residentIdSet.has(id));
      if (next.length !== previous.length) {
        saveRecentResidentIds(next);
      }
      return next;
    });
  }, [residents]);

  const { data: records = [] } = useQuery<MedicalRecordWithStaff[]>({
    queryKey: ["/api/residents", selectedResident, "medical-records"],
    queryFn: async () => {
      const res = await fetch(`/api/residents/${selectedResident}/medical-records`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedResident,
  });

  const { data: comorbidities = [] } = useQuery<Comorbidity[]>({
    queryKey: ["/api/residents", selectedResident, "comorbidities"],
    queryFn: async () => {
      const res = await fetch(`/api/residents/${selectedResident}/comorbidities`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedResident,
  });

  const { data: family = [] } = useQuery<FamilyMember[]>({
    queryKey: ["/api/residents", selectedResident, "family"],
    queryFn: async () => {
      const res = await fetch(`/api/residents/${selectedResident}/family`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedResident,
  });

  const { data: medications = [] } = useQuery<MedicationWithResident[]>({
    queryKey: ["/api/medications", "prontuario-report", selectedResident],
    queryFn: () =>
      fetchReportArray<MedicationWithResident>(
        `/api/medications?residentId=${selectedResident}`,
        "Erro ao carregar medicações.",
      ),
    enabled: !!selectedResident,
  });

  const { data: medicationAdministrations = [] } = useQuery<MedicationAdministrationWithDetails[]>({
    queryKey: ["/api/medication-administrations", "prontuario-report", selectedResident],
    queryFn: () =>
      fetchReportArray<MedicationAdministrationWithDetails>(
        `/api/medication-administrations?residentId=${selectedResident}`,
        "Erro ao carregar historico de medicações.",
      ),
    enabled: !!selectedResident,
  });

  const { data: occurrences = [] } = useQuery<OccurrenceWithResident[]>({
    queryKey: ["/api/occurrences", "prontuario-report", selectedResident],
    queryFn: () =>
      fetchReportArray<OccurrenceWithResident>(
        `/api/occurrences?residentId=${selectedResident}`,
        "Erro ao carregar ocorrências.",
      ),
    enabled: !!selectedResident,
  });

  // Evolution form
  const evolutionForm = useForm<z.infer<typeof evolutionSchema>>({
    resolver: zodResolver(evolutionSchema),
    defaultValues: {
      date: toDateInputValue(),
      type: "evolution",
      staffId: undefined,
      visibility: "internal",
      content: "",
      dailyChecklist: createEmptyDailyChecklist(),
    },
  });

  const createRecord = useMutation({
    mutationFn: async (data: z.infer<typeof evolutionSchema>) => {
      const payload = {
        ...data,
        staffId: data.staffId ? Number(data.staffId) : null,
        dailyChecklist: JSON.stringify(data.dailyChecklist ?? createEmptyDailyChecklist()),
      };
      const res = await fetch(`/api/residents/${selectedResident}/medical-records`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "medical-records"] });
      setEvolutionOpen(false);
      evolutionForm.reset({
        date: toDateInputValue(),
        type: "evolution",
        staffId: undefined,
        visibility: "internal",
        content: "",
        title: "",
        bloodPressure: "",
        heartRate: null,
        temperature: null,
        oxygenSat: null,
        weight: null,
        glucoseLevel: null,
        mood: "",
        dailyChecklist: createEmptyDailyChecklist(),
      });
      toast({ title: "Registro salvo com sucesso" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao salvar registro" }),
  });

  // Comorbidity form
  const comorbidityForm = useForm<z.infer<typeof comorbiditySchema>>({
    resolver: zodResolver(comorbiditySchema),
    defaultValues: { severity: "moderate", name: "" },
  });

  const createComorbidity = useMutation({
    mutationFn: async (data: z.infer<typeof comorbiditySchema>) => {
      const res = await fetch(`/api/residents/${selectedResident}/comorbidities`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "comorbidities"] });
      setComorbidityOpen(false);
      comorbidityForm.reset();
      toast({ title: "Diagnóstico adicionado" });
    },
  });

  // Family form
  const familyForm = useForm<z.infer<typeof familySchema>>({
    resolver: zodResolver(familySchema),
    defaultValues: { isPrimary: false, name: "", relationship: "", phone: "", portalAccess: false, portalUsername: "", portalPassword: "" },
  });
  const portalAccessValue = familyForm.watch("portalAccess");

  const createFamily = useMutation({
    mutationFn: async (data: z.infer<typeof familySchema>) => {
      if (data.portalAccess && (!data.portalPassword || data.portalPassword.length < 4)) {
        throw new Error("Senha obrigatória para acesso ao portal (mín. 4 caracteres)");
      }
      const res = await fetch(`/api/residents/${selectedResident}/family`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erro ao cadastrar familiar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "family"] });
      setFamilyOpen(false);
      setShowPortalPassword(false);
      familyForm.reset();
      toast({ title: "Familiar cadastrado", description: "Acesso ao portal configurado com sucesso." });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: err.message }),
  });

  const updateFamily = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof familySchema> }) => {
      const payload: Record<string, unknown> = { ...data };
      if (!payload.portalPassword) delete payload.portalPassword;
      const res = await fetch(`/api/family/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Erro ao atualizar familiar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "family"] });
      setFamilyOpen(false);
      setEditingFamily(null);
      setShowPortalPassword(false);
      familyForm.reset();
      toast({ title: "Familiar atualizado com sucesso" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: err.message }),
  });

  const deleteRecord = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/medical-records/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir registro");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "medical-records"] });
      toast({ title: "Registro excluído" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir registro" }),
  });

  const deleteComorbidity = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/comorbidities/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir diagnóstico");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "comorbidities"] });
      toast({ title: "Diagnóstico excluído" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir diagnóstico" }),
  });

  const deleteFamily = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/family/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir familiar");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "family"] });
      toast({ title: "Familiar removido" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao remover familiar" }),
  });

  const printEvolutionReport = () => {
    if (!resident) {
      toast({ variant: "destructive", title: "Selecione um paciente." });
      return;
    }

    const reportRecords = records.filter((record) => record.type === "evolution" || record.type === "note");

    const residentAddress = [
      (resident as any).address,
      (resident as any).addressNumber,
      (resident as any).addressComplement,
      (resident as any).neighborhood,
      (resident as any).city,
      (resident as any).state,
    ].filter(Boolean).join(", ");
    const generatedAt = format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
    const emptyHtml = (text: string) => `<p class="empty">${escapeHtml(text)}</p>`;

    const diagnosesHtml = comorbidities.length > 0
      ? `
        <table>
          <thead>
            <tr>
              <th>Diagnostico</th>
              <th>CID-10</th>
              <th>Gravidade</th>
              <th>Data</th>
              <th>Observações</th>
            </tr>
          </thead>
          <tbody>
            ${comorbidities.map((item) => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.icd10 || "-")}</td>
                <td>${escapeHtml(SEVERITY_MAP[item.severity as keyof typeof SEVERITY_MAP]?.label ?? item.severity ?? "-")}</td>
                <td>${escapeHtml(formatRecordDate(item.diagnosedAt))}</td>
                <td>${escapeHtml(item.notes || "-")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : emptyHtml("Nenhum diagnostico/comorbidade registrado.");

    const medicationsHtml = medications.length > 0
      ? `
        <table>
          <thead>
            <tr>
              <th>Medicação</th>
              <th>Dose</th>
              <th>Frequencia</th>
              <th>Horario</th>
              <th>Via</th>
              <th>Status</th>
              <th>Prescritor</th>
            </tr>
          </thead>
          <tbody>
            ${medications.map((item) => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.dosage)}</td>
                <td>${escapeHtml(item.frequency)}</td>
                <td>${escapeHtml(item.scheduleTime || "-")}</td>
                <td>${escapeHtml(item.route || "-")}</td>
                <td>${escapeHtml(MEDICATION_STATUS_LABELS[item.status] ?? item.status ?? "-")}</td>
                <td>${escapeHtml(item.prescribedBy || "-")}</td>
              </tr>
              ${item.notes ? `<tr><td colspan="7" class="notes"><strong>Obs.:</strong> ${escapeHtml(item.notes)}</td></tr>` : ""}
            `).join("")}
          </tbody>
        </table>
      `
      : emptyHtml("Nenhuma medicação registrada.");

    const recentMedicationAdministrations = [...medicationAdministrations]
      .sort((left, right) => {
        const leftTime = new Date(left.administeredAt ?? left.scheduledFor ?? 0).getTime();
        const rightTime = new Date(right.administeredAt ?? right.scheduledFor ?? 0).getTime();
        return rightTime - leftTime;
      })
      .slice(0, 30);
    const medicationAdministrationsHtml = recentMedicationAdministrations.length > 0
      ? `
        <table>
          <thead>
            <tr>
              <th>Medicação</th>
              <th>Previsto</th>
              <th>Registrado</th>
              <th>Status</th>
              <th>Profissional</th>
              <th>Observações</th>
            </tr>
          </thead>
          <tbody>
            ${recentMedicationAdministrations.map((item) => `
              <tr>
                <td>${escapeHtml(item.medicationName || "-")}</td>
                <td>${escapeHtml(formatReportDateTime(item.scheduledFor))}</td>
                <td>${escapeHtml(formatReportDateTime(item.administeredAt))}</td>
                <td>${escapeHtml(MEDICATION_ADMINISTRATION_STATUS_LABELS[item.status] ?? item.status ?? "-")}</td>
                <td>${escapeHtml(item.administeredByName || "-")}</td>
                <td>${escapeHtml(item.notes || "-")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : emptyHtml("Nenhuma administração de medicação registrada.");

    const recentOccurrences = [...occurrences]
      .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
      .slice(0, 30);
    const occurrencesHtml = recentOccurrences.length > 0
      ? `
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Gravidade</th>
              <th>Status</th>
              <th>Descricao</th>
              <th>Resolucao</th>
            </tr>
          </thead>
          <tbody>
            ${recentOccurrences.map((item) => `
              <tr>
                <td>${escapeHtml(formatReportDateTime(item.createdAt))}</td>
                <td>${escapeHtml(item.type)}</td>
                <td>${escapeHtml(OCCURRENCE_SEVERITY_LABELS[item.severity] ?? item.severity ?? "-")}</td>
                <td>${escapeHtml(OCCURRENCE_STATUS_LABELS[item.status] ?? item.status ?? "-")}</td>
                <td>${escapeHtml(item.description)}</td>
                <td>${escapeHtml(item.resolution || "-")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : emptyHtml("Nenhuma ocorrência registrada.");

    const familyHtml = family.length > 0
      ? `
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Parentesco</th>
              <th>Telefone</th>
              <th>E-mail</th>
              <th>Principal</th>
            </tr>
          </thead>
          <tbody>
            ${family.map((item) => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.relationship)}</td>
                <td>${escapeHtml(item.phone || "-")}</td>
                <td>${escapeHtml(item.email || "-")}</td>
                <td>${escapeHtml(item.isPrimary ? "Sim" : "Não")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : emptyHtml("Nenhum familiar cadastrado.");

    const rowsHtml = reportRecords.map((record) => {
      const typeInfo = TYPE_MAP[record.type as keyof typeof TYPE_MAP] ?? { label: record.type, color: "#64748B" };
      const checklist = parseDailyChecklist(record.dailyChecklist);
      const completedChecklistItems = DAILY_CHECKLIST_OPTIONS
        .filter((option) => checklist[option.key])
        .map((option) => option.label)
        .join(", ");
      const professionalName = record.staffName
        ?? activeStaffMembers.find((member: any) => member.id === record.staffId)?.name
        ?? "-";
      const vitals = [
        ["PA", record.bloodPressure],
        ["FC", record.heartRate ? `${record.heartRate} bpm` : null],
        ["Temp.", record.temperature ? `${record.temperature} C` : null],
        ["SpO2", record.oxygenSat ? `${record.oxygenSat}%` : null],
        ["Peso", record.weight ? `${record.weight} kg` : null],
        ["Glicemia", record.glucoseLevel ? `${record.glucoseLevel} mg/dL` : null],
        ["Humor", record.mood ? MOOD_MAP[record.mood] ?? record.mood : null],
      ]
        .filter(([, value]) => Boolean(value))
        .map(([label, value]) => `<span><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`)
        .join("");

      return `
        <section class="record">
          <div class="record-head">
            <div>
              <strong>${escapeHtml(typeInfo.label)}</strong>
              <span>${escapeHtml(formatRecordDate(record.date))}</span>
            </div>
            <span>${escapeHtml(record.visibility === "shared" ? "Compartilhado" : "Interno")}</span>
          </div>
          <div class="meta">
            <span><strong>Profissional:</strong> ${escapeHtml(professionalName)}</span>
            <span><strong>Titulo:</strong> ${escapeHtml(record.title || "-")}</span>
          </div>
          ${vitals ? `<div class="vitals">${vitals}</div>` : ""}
          ${completedChecklistItems ? `<p class="checklist"><strong>Checklist:</strong> ${escapeHtml(completedChecklistItems)}</p>` : ""}
          <p class="content">${escapeHtml(record.content)}</p>
        </section>
      `;
    }).join("");

    const printed = printHtmlDocument(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Relatório Clínico - ${escapeHtml(resident.name)}</title>
          <style>
            body { margin: 28px; color: #111827; font-family: Arial, sans-serif; }
            header { border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 22px; }
            h2 { margin: 22px 0 10px; font-size: 15px; }
            p { margin: 0; }
            .muted { color: #6b7280; font-size: 12px; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; font-size: 12px; margin-top: 12px; }
            .record { break-inside: avoid; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
            .record-head { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; margin-bottom: 8px; }
            .record-head span, .meta span { color: #4b5563; font-size: 12px; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
            .vitals { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
            .vitals span { border: 1px solid #dbeafe; background: #eff6ff; border-radius: 999px; padding: 4px 7px; font-size: 11px; }
            .checklist { margin-bottom: 8px; color: #065f46; font-size: 12px; }
            .content { white-space: pre-wrap; line-height: 1.5; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; }
            th { background: #f3f4f6; color: #374151; text-align: left; }
            th, td { border: 1px solid #d1d5db; padding: 7px; vertical-align: top; }
            .notes { background: #f9fafb; color: #4b5563; }
            .empty { border: 1px dashed #d1d5db; border-radius: 8px; color: #6b7280; padding: 10px; font-size: 12px; margin-bottom: 12px; }
            footer { margin-top: 16px; color: #6b7280; font-size: 11px; }
            @media print { body { margin: 18mm; } }
          </style>
        </head>
        <body>
          <header>
            <h1>Relatório Clínico do Paciente</h1>
            <p class="muted">EasyCare - gerado em ${escapeHtml(generatedAt)}</p>
          </header>

          <h2>Identificacao</h2>
          <div class="grid">
            <div><strong>Paciente:</strong> ${escapeHtml(resident.name)}</div>
            <div><strong>Idade:</strong> ${escapeHtml(residentAge !== null ? `${residentAge} anos` : "-")}</div>
            <div><strong>Quarto/Leito:</strong> ${escapeHtml(resident.roomNumber || "-")}</div>
            <div><strong>Tipo sanguineo:</strong> ${escapeHtml(resident.bloodType || "-")}</div>
            <div><strong>Responsável:</strong> ${escapeHtml(resident.contactName || "-")}</div>
            <div><strong>Telefone:</strong> ${escapeHtml(resident.contactPhone || "-")}</div>
            <div><strong>Atendimento:</strong> ${escapeHtml((resident as any).careType === "home_care" ? "Home Care" : "Instituicao")}</div>
            <div><strong>Endereço:</strong> ${escapeHtml(residentAddress || "-")}</div>
            <div><strong>Alergias:</strong> ${escapeHtml(resident.allergies || "-")}</div>
            <div><strong>Restricoes alimentares:</strong> ${escapeHtml(formatOptionalValue((resident as any).dietaryRestrictions))}</div>
          </div>

          <h2>Diagnosticos e Comorbidades</h2>
          ${diagnosesHtml}

          <h2>Medicações</h2>
          ${medicationsHtml}

          <h2>Administrações de Medicação - ultimos 30 registros</h2>
          ${medicationAdministrationsHtml}

          <h2>Ocorrências - ultimos 30 registros</h2>
          ${occurrencesHtml}

          <h2>Evoluções e Anotações</h2>
          ${rowsHtml || emptyHtml("Nenhuma evolução/anotação registrada.")}

          <h2>Familiares e Contatos</h2>
          ${familyHtml}

          <footer>Na impressão, selecione "Salvar como PDF" para exportar o relatório.</footer>
        </body>
      </html>
    `);
    if (!printed) {
      toast({ variant: "destructive", title: "Não foi possível gerar o PDF." });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
          Prontuário
        </h1>
        <p className="text-muted-foreground mt-1">Histórico médico, evolução diária e informações clínicas dos pacientes</p>
      </div>

      {/* Resident selector */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-[100px,1fr] sm:items-start">
            <p className="text-sm font-medium text-muted-foreground pt-2">Paciente:</p>
            <div className="space-y-3">
              <Popover open={residentSelectorOpen} onOpenChange={setResidentSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={residentSelectorOpen}
                    className="w-full h-auto justify-between px-3 py-2"
                    data-testid="resident-selector-combobox"
                    disabled={residentsLoading || residents.length === 0}
                  >
                    <div className="flex min-w-0 items-center gap-3 text-left">
                      <ProntuarioResidentAvatar resident={resident} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {resident ? resident.name : "Selecionar paciente"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {resident ? getResidentSelectorSubtitle(resident) : "Busque por nome ou quarto"}
                        </p>
                      </div>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar por nome ou quarto..." />
                    <CommandList>
                      <CommandEmpty>Nenhum paciente encontrado.</CommandEmpty>

                      {recentResidents.length > 0 && (
                        <CommandGroup heading="Recentes">
                          {recentResidents.map((item: any) => (
                            <CommandItem
                              key={`recent-${item.id}`}
                              value={`${item.name} ${item.roomNumber ?? ""} ${getResidentAge(item.birthDate) ?? ""}`}
                              onSelect={() => {
                                setSelectedResident(item.id);
                                setResidentSelectorOpen(false);
                              }}
                              data-testid={`resident-selector-recent-${item.id}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedResident === item.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <ProntuarioResidentAvatar resident={item} size="xs" />
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate font-medium">{item.name}</span>
                                <span className="text-xs text-muted-foreground">{getResidentSelectorSubtitle(item)}</span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}

                      <CommandGroup heading="Todos os pacientes">
                        {nonRecentResidents.map((item: any) => (
                          <CommandItem
                            key={item.id}
                            value={`${item.name} ${item.roomNumber ?? ""} ${getResidentAge(item.birthDate) ?? ""}`}
                            onSelect={() => {
                              setSelectedResident(item.id);
                              setResidentSelectorOpen(false);
                            }}
                            data-testid={`resident-selector-${item.id}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedResident === item.id ? "opacity-100" : "opacity-0",
                              )}
                              />
                              <ProntuarioResidentAvatar resident={item} size="xs" />
                              <div className="flex min-w-0 flex-col">
                              <span className="truncate font-medium">{item.name}</span>
                              <span className="text-xs text-muted-foreground">{getResidentSelectorSubtitle(item)}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {residentsLoading
                    ? "Carregando pacientes..."
                    : `${residents.length} paciente${residents.length === 1 ? "" : "s"} ativo${residents.length === 1 ? "" : "s"}`}
                </p>
                {recentResidents.length > 0 && (
                  <>
                    <span className="text-xs text-muted-foreground">|</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Recentes:</span>
                      {recentResidents.map((item: any) => (
                        <Button
                          key={`quick-${item.id}`}
                          size="sm"
                          variant={selectedResident === item.id ? "default" : "outline"}
                          className="h-7 px-2 text-xs"
                          onClick={() => setSelectedResident(item.id)}
                          data-testid={`resident-selector-quick-${item.id}`}
                        >
                          {item.name}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => {
                          setRecentResidentIds([]);
                          saveRecentResidentIds([]);
                        }}
                        data-testid="resident-selector-clear-recents"
                      >
                        Limpar
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedResident ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FileText className="h-14 w-14 text-muted-foreground/30 mb-4" />
          <p className="text-xl font-semibold text-muted-foreground">Selecione um paciente</p>
          <p className="text-sm text-muted-foreground/60 mt-1">para visualizar o prontuário</p>
        </div>
      ) : (
        <>
          {/* Resident info bar */}
          {resident && (
            <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4 rounded-2xl border border-border bg-card shadow-sm">
              <ProntuarioResidentAvatar resident={resident} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-foreground text-lg">{resident.name}</p>
                <div className="flex flex-wrap gap-3 mt-0.5">
                  {residentAge !== null && (
                    <span className="text-xs text-muted-foreground">
                      {residentAge} anos
                    </span>
                  )}
                  {resident.roomNumber && <span className="text-xs text-muted-foreground">Quarto {resident.roomNumber}</span>}
                  {resident.bloodType && <Badge variant="outline" className="text-xs">{resident.bloodType}</Badge>}
                  {resident.mobilityStatus && <Badge variant="secondary" className="text-xs capitalize">{resident.mobilityStatus}</Badge>}
                  {resident.cognitiveStatus && <Badge variant="secondary" className="text-xs capitalize">{resident.cognitiveStatus}</Badge>}
                  {(resident as any).careType === "home_care" || (resident as any).address ? (
                    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {(resident as any).address
                          ? [(resident as any).address, (resident as any).addressNumber, (resident as any).city].filter(Boolean).join(", ")
                          : "Home Care"}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
              {resident.allergies && resident.allergies !== "Nenhuma" && resident.allergies !== "Nenhuma conhecida" && (
                <div className="flex w-full sm:w-auto items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium break-words"
                  style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                  ⚠️ Alergia: {resident.allergies}
                </div>
              )}
            </div>
          )}

          {!canViewProntuario ? (
            <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
              Sem permissão para visualizar o prontuario.
            </div>
          ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ProntuarioTab)}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <TabsList className="w-full sm:w-auto h-auto min-h-10">
                <TabsTrigger value="evolution" data-testid="tab-evolution">
                  <Activity className="h-3.5 w-3.5 mr-1.5" />Evolução
                </TabsTrigger>
                <TabsTrigger value="diagnoses" data-testid="tab-diagnoses">
                  <Stethoscope className="h-3.5 w-3.5 mr-1.5" />Diagnósticos
                </TabsTrigger>
                <TabsTrigger value="medications" data-testid="tab-medications">
                  <Pill className="h-3.5 w-3.5 mr-1.5" />Medicações
                </TabsTrigger>
                <TabsTrigger value="occurrences" data-testid="tab-occurrences">
                  <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />Ocorrências
                </TabsTrigger>
                <TabsTrigger value="family" data-testid="tab-family">
                  <Users2 className="h-3.5 w-3.5 mr-1.5" />Familiares
                </TabsTrigger>
              </TabsList>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto gap-2"
                  onClick={printEvolutionReport}
                  disabled={!resident}
                  data-testid="button-print-evolution-report"
                >
                  <Printer className="h-4 w-4" />
                  Relatório
                </Button>
                {/* Nueva evolución */}
                <Dialog open={evolutionOpen} onOpenChange={setEvolutionOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      className="w-full sm:w-auto gap-2 btn-glow"
                      data-testid="button-add-evolution"
                      disabled={!canEditProntuario}
                    >
                      <Plus className="h-4 w-4" />Nova Evolução
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Registrar Evolução / Anotação</DialogTitle>
                    </DialogHeader>
                    <Form {...evolutionForm}>
                      <form onSubmit={evolutionForm.handleSubmit((d) => createRecord.mutate(d))} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField control={evolutionForm.control} name="date" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Data</FormLabel>
                              <FormControl><Input type="date" {...field} data-testid="input-record-date" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={evolutionForm.control} name="type" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Tipo</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger data-testid="select-record-type"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                  <SelectItem value="evolution">Evolução Diária</SelectItem>
                                  <SelectItem value="note">Anotação</SelectItem>
                                  <SelectItem value="prescription">Prescrição</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>

                        <FormField control={evolutionForm.control} name="staffId" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Profissional responsável</FormLabel>
                            <Select
                              value={field.value ? String(field.value) : "none"}
                              onValueChange={(value) => field.onChange(value === "none" ? undefined : Number(value))}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-record-staff">
                                  <SelectValue placeholder="Selecionar profissional" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">Não informado</SelectItem>
                                {activeStaffMembers.map((member: any) => (
                                  <SelectItem key={member.id} value={String(member.id)}>
                                    {member.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={evolutionForm.control} name="title" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Título (opcional)</FormLabel>
                            <FormControl><Input placeholder="Ex: Evolução matinal" {...field} /></FormControl>
                          </FormItem>
                        )} />

                        <FormField control={evolutionForm.control} name="content" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Conteúdo *</FormLabel>
                            <FormControl><Textarea rows={5} placeholder="Descreva o estado do paciente, procedimentos realizados, observações..." {...field} data-testid="textarea-record-content" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <div className="border border-border rounded-xl p-4 space-y-3">
                          <p className="text-sm font-semibold text-foreground">Checklist do dia</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {DAILY_CHECKLIST_OPTIONS.map((option) => (
                              <FormField
                                key={option.key}
                                control={evolutionForm.control}
                                name={`dailyChecklist.${option.key}`}
                                render={({ field }) => (
                                  <FormItem className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2">
                                    <FormControl>
                                      <Checkbox
                                        checked={Boolean(field.value)}
                                        onCheckedChange={(checked) => field.onChange(checked === true)}
                                      />
                                    </FormControl>
                                    <FormLabel className="m-0 cursor-pointer text-sm font-medium">
                                      {option.label}
                                    </FormLabel>
                                  </FormItem>
                                )}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Vitals section */}
                        <div className="border border-border rounded-xl p-4 space-y-3">
                          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Heart className="h-4 w-4 text-primary" />Sinais Vitais (opcional)
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            <FormField control={evolutionForm.control} name="bloodPressure" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Pressão Arterial</FormLabel>
                                <FormControl><Input placeholder="120/80" {...field} data-testid="input-blood-pressure" /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="heartRate" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">FC (bpm)</FormLabel>
                                <FormControl><Input type="number" placeholder="72" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="temperature" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Temperatura (°C)</FormLabel>
                                <FormControl><Input type="number" step="0.1" placeholder="36.5" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="oxygenSat" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">SpO2 (%)</FormLabel>
                                <FormControl><Input type="number" placeholder="97" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="weight" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Peso (kg)</FormLabel>
                                <FormControl><Input type="number" step="0.1" placeholder="65.0" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="glucoseLevel" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Glicemia (mg/dL)</FormLabel>
                                <FormControl><Input type="number" placeholder="100" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="mood" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Humor</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    {Object.entries(MOOD_MAP).map(([val, label]) => (
                                      <SelectItem key={val} value={val}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )} />
                          </div>
                        </div>

                        <FormField control={evolutionForm.control} name="visibility" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Visibilidade</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger data-testid="select-visibility"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="internal">🔒 Interno (apenas equipe)</SelectItem>
                                <SelectItem value="shared">👁 Compartilhar com familiar</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />

                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => setEvolutionOpen(false)}>Cancelar</Button>
                          <Button type="submit" disabled={createRecord.isPending}>
                            {createRecord.isPending ? "Salvando..." : "Salvar Registro"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* EVOLUTION TAB */}
            <TabsContent value="evolution" className="space-y-3 mt-4">
              {records.length === 0 ? (
                <div className="text-center py-16">
                  <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">Nenhum registro no prontuário.</p>
                  <p className="text-sm text-muted-foreground/60">Clique em "Nova Evolução" para adicionar.</p>
                </div>
              ) : (
                records.map((record: any) => {
                  const typeInfo = TYPE_MAP[record.type as keyof typeof TYPE_MAP] ?? { label: record.type, color: "#888" };
                  const dailyChecklist = parseDailyChecklist(record.dailyChecklist);
                  const completedChecklistItems = DAILY_CHECKLIST_OPTIONS.filter((option) => dailyChecklist[option.key]);
                  const professionalName = record.staffName
                    ?? activeStaffMembers.find((member: any) => member.id === record.staffId)?.name;
                  return (
                    <div key={record.id} className="bg-card rounded-2xl border border-border/60 shadow-sm p-5" data-testid={`record-${record.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                            style={{ background: `${typeInfo.color}18` }}>
                            <Activity className="h-4 w-4" style={{ color: typeInfo.color }} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge className="text-xs" style={{ background: `${typeInfo.color}20`, color: typeInfo.color, border: `1px solid ${typeInfo.color}30` }}>
                                {typeInfo.label}
                              </Badge>
                              {record.visibility === "shared"
                                ? <span className="text-xs text-green-600 flex items-center gap-1"><Eye className="h-3 w-3" />Compartilhado</span>
                                : <span className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />Interno</span>
                              }
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(record.date + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR })}
                              {record.title && ` · ${record.title}`}
                            </p>
                            {professionalName && (
                              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                <Users2 className="h-3 w-3" />
                                Profissional: {professionalName}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Vitals badge row */}
                        {(record.bloodPressure || record.heartRate || record.temperature || record.oxygenSat || record.glucoseLevel) && (
                          <div className="flex flex-wrap gap-2">
                            {record.bloodPressure && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100">
                                <Heart className="h-3 w-3" />{record.bloodPressure}
                              </span>
                            )}
                            {record.heartRate && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-pink-50 text-pink-700 border border-pink-100">
                                {record.heartRate} bpm
                              </span>
                            )}
                            {record.temperature && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-100">
                                <Thermometer className="h-3 w-3" />{record.temperature}°C
                              </span>
                            )}
                            {record.oxygenSat && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
                                <Wind className="h-3 w-3" />{record.oxygenSat}%
                              </span>
                            )}
                            {record.glucoseLevel && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
                                Glicemia {record.glucoseLevel} mg/dL
                              </span>
                            )}
                            {record.mood && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-100">
                                <Smile className="h-3 w-3" />{MOOD_MAP[record.mood] ?? record.mood}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {completedChecklistItems.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {completedChecklistItems.map((item) => (
                            <span key={item.key} className="rounded-lg border border-green-100 bg-green-50 px-2 py-1 text-xs text-green-700">
                              {item.label}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap flex-1">{record.content}</p>
                        <button
                          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          disabled={deleteRecord.isPending}
                          onClick={() => {
                            confirm({
                              title: "Excluir registro",
                              description: "Excluir este registro do prontuário? Esta ação não pode ser desfeita.",
                              confirmText: "Excluir",
                              pendingText: "Excluindo...",
                              variant: "destructive",
                              onConfirm: () => deleteRecord.mutateAsync(record.id),
                            });
                          }}
                          data-testid={`button-delete-record-${record.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </TabsContent>

            {/* DIAGNOSES TAB */}
            <TabsContent value="diagnoses" className="mt-4">
              <div className="flex justify-start sm:justify-end mb-4">
                <Dialog open={comorbidityOpen} onOpenChange={setComorbidityOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="w-full sm:w-auto gap-2" data-testid="button-add-comorbidity">
                      <Plus className="h-4 w-4" />Adicionar Diagnóstico
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Novo Diagnóstico / Comorbidade</DialogTitle>
                    </DialogHeader>
                    <Form {...comorbidityForm}>
                      <form onSubmit={comorbidityForm.handleSubmit((d) => createComorbidity.mutate(d))} className="space-y-4">
                        <FormField control={comorbidityForm.control} name="name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nome do Diagnóstico *</FormLabel>
                            <FormControl><Input placeholder="Ex: Hipertensão Arterial Sistêmica" {...field} data-testid="input-comorbidity-name" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField control={comorbidityForm.control} name="icd10" render={({ field }) => (
                            <FormItem>
                              <FormLabel>CID-10</FormLabel>
                              <FormControl><Input placeholder="Ex: I10" {...field} /></FormControl>
                            </FormItem>
                          )} />
                          <FormField control={comorbidityForm.control} name="severity" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Gravidade</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                  <SelectItem value="mild">Leve</SelectItem>
                                  <SelectItem value="moderate">Moderada</SelectItem>
                                  <SelectItem value="severe">Grave</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )} />
                        </div>
                        <FormField control={comorbidityForm.control} name="diagnosedAt" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Data do Diagnóstico</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={comorbidityForm.control} name="notes" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Observações</FormLabel>
                            <FormControl><Textarea rows={2} {...field} /></FormControl>
                          </FormItem>
                        )} />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => setComorbidityOpen(false)}>Cancelar</Button>
                          <Button type="submit" disabled={createComorbidity.isPending}>Salvar</Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {comorbidities.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">Nenhum diagnóstico registrado.</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {comorbidities.map((c: any) => {
                    const sev = SEVERITY_MAP[c.severity as keyof typeof SEVERITY_MAP] ?? { label: c.severity, color: "#888" };
                    return (
                      <div key={c.id} className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm" data-testid={`comorbidity-${c.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-foreground text-sm">{c.name}</p>
                            {c.icd10 && <p className="text-xs text-muted-foreground mt-0.5">CID-10: {c.icd10}</p>}
                            {c.diagnosedAt && <p className="text-xs text-muted-foreground">Diagnóstico: {format(new Date(c.diagnosedAt + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR })}</p>}
                            {c.notes && <p className="text-xs text-muted-foreground mt-1">{c.notes}</p>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge className="text-xs" style={{ background: `${sev.color}18`, color: sev.color, border: `1px solid ${sev.color}30` }}>
                              {sev.label}
                            </Badge>
                            <button
                              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              disabled={deleteComorbidity.isPending}
                              onClick={() => {
                                confirm({
                                  title: "Excluir diagnóstico",
                                  description: `Excluir diagnóstico "${c.name}"?`,
                                  confirmText: "Excluir",
                                  pendingText: "Excluindo...",
                                  variant: "destructive",
                                  onConfirm: () => deleteComorbidity.mutateAsync(c.id),
                                });
                              }}
                              data-testid={`button-delete-comorbidity-${c.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="medications" className="mt-4">
              <ResidentMedicationSection
                residentId={selectedResident}
                canEdit={canEditProntuario}
                initialTab={medicationInitialTab}
                focusMedicationId={focusedMedicationId}
                focusScheduledFor={focusedMedicationScheduledFor}
              />
            </TabsContent>

            <TabsContent value="occurrences" className="mt-4">
              <ResidentOccurrenceSection
                residentId={selectedResident}
                canEdit={canEditProntuario}
              />
            </TabsContent>

            {/* FAMILY TAB */}
            <TabsContent value="family" className="mt-4">
              <div className="flex justify-start sm:justify-end mb-4">
                <Dialog open={familyOpen} onOpenChange={(open) => {
                  setFamilyOpen(open);
                  if (!open) { setEditingFamily(null); setShowPortalPassword(false); familyForm.reset({ isPrimary: false, name: "", relationship: "", phone: "", portalAccess: false, portalUsername: "", portalPassword: "" }); }
                }}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="w-full sm:w-auto gap-2" data-testid="button-add-family">
                      <Plus className="h-4 w-4" />Adicionar Familiar
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>{editingFamily ? "Editar Familiar / Responsável" : "Cadastrar Familiar / Responsável"}</DialogTitle>
                    </DialogHeader>
                    <Form {...familyForm}>
                      <form onSubmit={familyForm.handleSubmit((d) => {
                        if (editingFamily) updateFamily.mutate({ id: editingFamily.id, data: d });
                        else createFamily.mutate(d);
                      })} className="space-y-4">
                        <FormField control={familyForm.control} name="name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nome Completo *</FormLabel>
                            <FormControl><Input placeholder="Nome do familiar" {...field} data-testid="input-family-name" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField control={familyForm.control} name="relationship" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Parentesco *</FormLabel>
                              <FormControl><Input placeholder="Ex: Filho, Filha, Cônjuge" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={familyForm.control} name="phone" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Telefone *</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="(11) 9xxxx-xxxx"
                                  maxLength={15}
                                  {...field}
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(maskPhoneBR(e.target.value))}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField control={familyForm.control} name="phone2" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Telefone 2</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Alternativo"
                                  maxLength={15}
                                  {...field}
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(maskPhoneBR(e.target.value))}
                                />
                              </FormControl>
                            </FormItem>
                          )} />
                          <FormField control={familyForm.control} name="email" render={({ field }) => (
                            <FormItem>
                              <FormLabel>E-mail</FormLabel>
                              <FormControl><Input type="email" {...field} /></FormControl>
                            </FormItem>
                          )} />
                        </div>
                        <FormField control={familyForm.control} name="cpf" render={({ field }) => (
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
                        )} />
                        <FormField control={familyForm.control} name="address" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Endereço</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                          </FormItem>
                        )} />

                        {/* Portal access section */}
                        <div className="border border-border/60 rounded-xl p-4 space-y-3" style={{ background: "rgba(34,211,238,0.04)" }}>
                          <FormField control={familyForm.control} name="portalAccess" render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Globe className="h-4 w-4" style={{ color: "#22D3EE" }} />
                                  <FormLabel className="text-sm font-semibold cursor-pointer" style={{ color: "#22D3EE" }}>
                                    Acesso ao Portal da Família
                                  </FormLabel>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={field.value}
                                  onClick={() => field.onChange(!field.value)}
                                  className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
                                  style={{ background: field.value ? "#22D3EE" : "#e2e8f0" }}
                                  data-testid="toggle-portal-access"
                                >
                                  <span
                                    className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg transition-transform"
                                    style={{ transform: field.value ? "translateX(20px)" : "translateX(0)" }}
                                  />
                                </button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Ao ativar, o familiar poderá acessar o portal em <strong>/portal</strong> para acompanhar o paciente.
                              </p>
                            </FormItem>
                          )} />

                          {portalAccessValue && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                              <FormField control={familyForm.control} name="portalUsername" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Usuário de acesso *</FormLabel>
                                  <FormControl>
                                    <Input placeholder="ex: joao.silva" {...field} data-testid="input-portal-username" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                              <FormField control={familyForm.control} name="portalPassword" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Senha {editingFamily ? "" : "*"}</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        type={showPortalPassword ? "text" : "password"}
                                        placeholder={editingFamily ? "••••  (deixe em branco para manter)" : "mín. 4 caracteres"}
                                        {...field}
                                        data-testid="input-portal-password"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setShowPortalPassword(!showPortalPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                      >
                                        {showPortalPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                      </button>
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => { setFamilyOpen(false); setEditingFamily(null); }}>Cancelar</Button>
                          <Button type="submit" disabled={createFamily.isPending || updateFamily.isPending}>
                            {editingFamily ? "Salvar alterações" : "Cadastrar"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {family.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">Nenhum familiar cadastrado.</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {family.map((f: any) => (
                    <div key={f.id} className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm" data-testid={`family-${f.id}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                          style={{ background: f.isPrimary ? "linear-gradient(135deg, #1F6FEB, #22D3EE)" : "#94A3B8" }}>
                          {f.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground text-sm truncate">{f.name}</p>
                            {f.isPrimary && <Badge className="text-xs" variant="default">Principal</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{f.relationship}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            onClick={() => {
                              setEditingFamily(f);
                              familyForm.reset({
                                name: f.name,
                                relationship: f.relationship,
                                phone: maskPhoneBR(f.phone),
                                phone2: f.phone2 ? maskPhoneBR(f.phone2) : "",
                                email: f.email ?? "",
                                cpf: f.cpf ? maskCpf(f.cpf) : "",
                                address: f.address ?? "",
                                isPrimary: f.isPrimary ?? false,
                                portalAccess: f.portalAccess ?? false,
                                portalUsername: f.portalUsername ?? "",
                                portalPassword: "",
                              });
                              setFamilyOpen(true);
                            }}
                            data-testid={`button-edit-family-${f.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            disabled={deleteFamily.isPending}
                            onClick={() => {
                              confirm({
                                title: "Remover familiar",
                                description: `Remover "${f.name}" dos familiares? ${f.portalAccess ? "O acesso ao portal desta pessoa também será removido." : ""}`,
                                confirmText: "Remover",
                                pendingText: "Removendo...",
                                variant: "destructive",
                                onConfirm: () => deleteFamily.mutateAsync(f.id),
                              });
                            }}
                            data-testid={`button-delete-family-${f.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        <p>📞 {maskPhoneBR(f.phone)}</p>
                        {f.phone2 && <p>📞 {maskPhoneBR(f.phone2)}</p>}
                        {f.email && <p>✉️ {f.email}</p>}
                      </div>
                      {f.portalAccess && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg w-fit"
                          style={{ background: "rgba(34,211,238,0.1)", color: "#22D3EE" }}>
                          <Globe className="h-3 w-3" />
                          Portal ativo · @{f.portalUsername}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
          )}
        </>
      )}
      {confirmDialog}
    </div>
  );
}
