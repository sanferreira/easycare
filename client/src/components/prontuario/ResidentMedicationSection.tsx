import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { addDays, format } from "date-fns";
import { Calendar as CalendarIcon, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchJsonOrThrow } from "@/lib/fetch-json";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { Medication } from "@shared/schema";

type MedicationWithResident = Medication & { residentName?: string };
type StaffOption = { id: number; name: string; role?: string | null; active?: boolean | null };

type MedicationDoseScheduleItem = {
  key: string;
  medicationId: number;
  medicationName: string;
  dosage: string;
  frequency: string;
  scheduledFor: string;
  scheduledDate?: string;
  scheduledTime?: string;
  status: "pending" | "given" | "skipped" | "refused" | "late";
  isOverdue: boolean;
  notes: string | null;
  administeredByName: string | null;
  administeredByStaffId: number | null;
};

type MedicationDoseScheduleResponse = {
  residentId: number;
  from: string;
  to: string;
  doses: MedicationDoseScheduleItem[];
};

type MedicationAdministrationWithDetails = {
  id: number;
  medicationName?: string;
  scheduledFor: string | null;
  administeredAt: string | null;
  administeredByName?: string | null;
  status: "given" | "skipped" | "refused" | "late";
  notes: string | null;
};

const medicationFormSchema = z.object({
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

const doseActionSchema = z.object({
  status: z.enum(["given", "skipped", "refused", "late"]).default("given"),
  notes: z.string().optional(),
  staffId: z.coerce.number().optional(),
});

const FREQUENCY_OPTIONS = [
  { value: "a cada 4h", label: "A cada 4 horas" },
  { value: "a cada 6h", label: "A cada 6 horas" },
  { value: "a cada 8h", label: "A cada 8 horas" },
  { value: "a cada 12h", label: "A cada 12 horas" },
  { value: "a cada 24h", label: "1x ao dia (24h)" },
  { value: "2x ao dia", label: "2x ao dia" },
  { value: "3x ao dia", label: "3x ao dia" },
  { value: "4x ao dia", label: "4x ao dia" },
  { value: "semanal", label: "Semanal" },
  { value: "sob demanda", label: "Sob demanda" },
] as const;

const MED_STATUS: Record<string, string> = { active: "Ativo", suspended: "Suspenso" };
const DOSE_STATUS: Record<string, string> = {
  pending: "Pendente",
  given: "Administrado",
  skipped: "Nao administrado",
  refused: "Recusado",
  late: "Atrasado",
};
const ALL_MEDICATIONS_FILTER = "__all_medications__";
type MedicationSectionTab = "medicacoes" | "agenda" | "historico";

function getFrequencyLabel(value?: string | null): string {
  if (!value) return "-";
  const normalized = value.trim().toLowerCase();
  return FREQUENCY_OPTIONS.find((option) => option.value.toLowerCase() === normalized)?.label ?? value;
}

function getFrequencyOptions(value?: string | null): Array<{ value: string; label: string }> {
  const current = value?.trim();
  if (!current) return [...FREQUENCY_OPTIONS];
  if (FREQUENCY_OPTIONS.some((option) => option.value.toLowerCase() === current.toLowerCase())) {
    return [...FREQUENCY_OPTIONS];
  }
  return [{ value: current, label: `Personalizado (${current})` }, ...FREQUENCY_OPTIONS];
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

function formatScheduleDoseDateTime(dose: MedicationDoseScheduleItem): string {
  if (dose.scheduledDate && dose.scheduledTime) {
    return `${formatDateLabel(dose.scheduledDate)} ${dose.scheduledTime}`;
  }
  return format(new Date(dose.scheduledFor), "dd/MM/yyyy HH:mm");
}

function isSameScheduledMinute(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return true;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return false;
  return Math.abs(leftDate.getTime() - rightDate.getTime()) < 60 * 1000;
}

function doseStatusClass(status: MedicationDoseScheduleItem["status"]) {
  if (status === "given") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (status === "skipped") return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "refused") return "bg-rose-100 text-rose-800 border-rose-200";
  if (status === "late") return "bg-violet-100 text-violet-800 border-violet-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

type Props = {
  residentId: number;
  canEdit: boolean;
  initialTab?: MedicationSectionTab;
  focusMedicationId?: number | null;
  focusScheduledFor?: string | null;
};

export function ResidentMedicationSection({
  residentId,
  canEdit,
  initialTab,
  focusMedicationId,
  focusScheduledFor,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const queryClient = useQueryClient();
  const isCaregiver = user?.role === "cuidador";

  const [range, setRange] = useState(() => {
    const base = new Date();
    return { from: format(base, "yyyy-MM-dd"), to: format(addDays(base, 6), "yyyy-MM-dd") };
  });
  const [isFromCalendarOpen, setIsFromCalendarOpen] = useState(false);
  const [isToCalendarOpen, setIsToCalendarOpen] = useState(false);
  const [isMedicationDialogOpen, setIsMedicationDialogOpen] = useState(false);
  const [editingMedication, setEditingMedication] = useState<MedicationWithResident | null>(null);
  const [activeTab, setActiveTab] = useState<MedicationSectionTab>(initialTab ?? "medicacoes");
  const [isDoseDialogOpen, setIsDoseDialogOpen] = useState(false);
  const [selectedDose, setSelectedDose] = useState<MedicationDoseScheduleItem | null>(null);
  const [showRegisteredDoses, setShowRegisteredDoses] = useState(false);
  const [selectedDoseMedicationFilter, setSelectedDoseMedicationFilter] = useState(ALL_MEDICATIONS_FILTER);

  const medicationForm = useForm<z.infer<typeof medicationFormSchema>>({
    resolver: zodResolver(medicationFormSchema),
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
  const watchedFrequency = medicationForm.watch("frequency");

  const doseActionForm = useForm<z.infer<typeof doseActionSchema>>({
    resolver: zodResolver(doseActionSchema),
    defaultValues: { status: "given", notes: "", staffId: undefined },
  });

  const medicationsQuery = useQuery<MedicationWithResident[]>({
    queryKey: ["/api/medications", "prontuario", residentId],
    enabled: residentId > 0,
    queryFn: () => fetchJsonOrThrow(`/api/medications?residentId=${residentId}`, "Erro ao carregar medicacoes."),
  });

  const scheduleQuery = useQuery<MedicationDoseScheduleResponse>({
    queryKey: ["/api/residents", residentId, "medication-dose-schedule", range.from, range.to],
    enabled: residentId > 0,
    queryFn: () =>
      fetchJsonOrThrow(
        `/api/residents/${residentId}/medication-dose-schedule?from=${range.from}&to=${range.to}`,
        "Erro ao carregar agenda de doses.",
      ),
  });

  const historyQuery = useQuery<MedicationAdministrationWithDetails[]>({
    queryKey: ["/api/medication-administrations", "prontuario", residentId],
    enabled: residentId > 0,
    queryFn: () =>
      fetchJsonOrThrow(
        `/api/medication-administrations?residentId=${residentId}`,
        "Erro ao carregar historico de medicacoes.",
      ),
  });

  const staffQuery = useQuery<StaffOption[]>({
    queryKey: ["/api/staff", "prontuario", residentId],
    enabled: residentId > 0 && canEdit,
    queryFn: async () => {
      const response = await fetch("/api/staff", { credentials: "include" });
      if (response.status === 403) return [];
      const rawBody = await response.text();
      let payload: unknown = null;
      if (rawBody.trim()) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = null;
        }
      }
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && payload !== null && "message" in payload
            ? String((payload as { message?: unknown }).message ?? "")
            : "";
        throw new Error(message || "Erro ao carregar equipe.");
      }
      return Array.isArray(payload) ? (payload as StaffOption[]) : [];
    },
  });

  const normalizeName = (value?: string | null) => (value ?? "").trim().toLocaleLowerCase("pt-BR");
  const linkedCaregiverStaff = useMemo(() => {
    if (!isCaregiver) return null;
    const userName = normalizeName(user?.name);
    if (!userName) return null;
    return staffQuery.data?.find((item) => normalizeName(item.name) === userName) ?? null;
  }, [isCaregiver, staffQuery.data, user?.name]);

  const staffAdministrators = useMemo(
    () => (staffQuery.data ?? []).filter((item) => item.active !== false),
    [staffQuery.data],
  );
  const visibleScheduleDoses = useMemo(() => {
    const doses = scheduleQuery.data?.doses ?? [];
    if (showRegisteredDoses) return doses;
    return doses.filter((dose) => dose.status === "pending");
  }, [scheduleQuery.data?.doses, showRegisteredDoses]);
  const scheduleMedicationOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        (scheduleQuery.data?.doses ?? [])
          .map((dose) => (dose.medicationName ?? "").trim())
          .filter((name) => name.length > 0),
      ),
    );
    return names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [scheduleQuery.data?.doses]);
  const filteredVisibleScheduleDoses = useMemo(() => {
    if (selectedDoseMedicationFilter === ALL_MEDICATIONS_FILTER) {
      return visibleScheduleDoses;
    }
    return visibleScheduleDoses.filter((dose) => dose.medicationName === selectedDoseMedicationFilter);
  }, [selectedDoseMedicationFilter, visibleScheduleDoses]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (!focusMedicationId) return;
    setActiveTab("agenda");
    setShowRegisteredDoses(true);

    if (focusScheduledFor) {
      const scheduledForDate = new Date(focusScheduledFor);
      if (!Number.isNaN(scheduledForDate.getTime())) {
        const scheduledDate = formatDateOnly(scheduledForDate);
        setRange({ from: scheduledDate, to: scheduledDate });
      }
    }
  }, [focusMedicationId, focusScheduledFor]);

  useEffect(() => {
    if (!focusMedicationId) return;
    const focusedMedicationName =
      medicationsQuery.data?.find((item) => item.id === focusMedicationId)?.name
      ?? scheduleQuery.data?.doses.find((dose) => dose.medicationId === focusMedicationId)?.medicationName;
    if (focusedMedicationName) {
      setSelectedDoseMedicationFilter(focusedMedicationName);
    }
  }, [focusMedicationId, medicationsQuery.data, scheduleQuery.data?.doses]);

  useEffect(() => {
    if (!focusMedicationId) return;
    const focusedDose = filteredVisibleScheduleDoses.find((dose) =>
      dose.medicationId === focusMedicationId && isSameScheduledMinute(dose.scheduledFor, focusScheduledFor),
    );
    const handle = window.setTimeout(() => {
      const elementId = focusedDose
        ? `medication-dose-${residentId}-${focusedDose.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`
        : `medication-row-${residentId}-${focusMedicationId}`;
      document.getElementById(elementId)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [filteredVisibleScheduleDoses, focusMedicationId, focusScheduledFor, residentId]);

  const applyTodayRange = () => {
    const today = formatDateOnly(new Date());
    setRange({ from: today, to: today });
  };

  const handleFromDateSelect = (selected?: Date) => {
    if (!selected) return;
    const selectedValue = formatDateOnly(selected);
    setRange((prev) => {
      const currentTo = parseDateOnly(prev.to);
      if (currentTo && selected > currentTo) {
        return { from: selectedValue, to: selectedValue };
      }
      return { ...prev, from: selectedValue };
    });
    setIsFromCalendarOpen(false);
  };

  const handleToDateSelect = (selected?: Date) => {
    if (!selected) return;
    const selectedValue = formatDateOnly(selected);
    setRange((prev) => {
      const currentFrom = parseDateOnly(prev.from);
      if (currentFrom && selected < currentFrom) {
        return { from: selectedValue, to: selectedValue };
      }
      return { ...prev, to: selectedValue };
    });
    setIsToCalendarOpen(false);
  };

  useEffect(() => {
    if (!selectedDose) return;
    const defaultStatus = selectedDose.status === "pending" ? "given" : selectedDose.status;
    doseActionForm.reset({
      status: defaultStatus,
      notes: selectedDose.notes ?? "",
      staffId: selectedDose.administeredByStaffId ?? staffAdministrators[0]?.id,
    });
  }, [doseActionForm, selectedDose, staffAdministrators]);

  const invalidateMedicationQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/medications"] });
    queryClient.invalidateQueries({ queryKey: ["/api/medications", "prontuario", residentId] });
    queryClient.invalidateQueries({ queryKey: ["/api/residents", residentId, "medication-dose-schedule"] });
    queryClient.invalidateQueries({ queryKey: ["/api/medication-administrations", "prontuario", residentId] });
  };

  const createMedication = useMutation({
    mutationFn: async (data: z.infer<typeof medicationFormSchema>) => {
      const scheduleTime = normalizeScheduleTimeValue(data.scheduleTime);
      if (frequencyNeedsBaseTime(data.frequency) && !scheduleTime) {
        throw new Error("Informe o horario base para esta frequencia.");
      }
      return fetchJsonOrThrow("/api/medications", "Erro ao cadastrar medicacao.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
    },
    onSuccess: () => {
      invalidateMedicationQueries();
      setIsMedicationDialogOpen(false);
      setEditingMedication(null);
      medicationForm.reset();
      toast({ title: "Medicacao cadastrada com sucesso" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const updateMedication = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof medicationFormSchema> }) => {
      const scheduleTime = normalizeScheduleTimeValue(data.scheduleTime);
      if (frequencyNeedsBaseTime(data.frequency) && !scheduleTime) {
        throw new Error("Informe o horario base para esta frequencia.");
      }
      return fetchJsonOrThrow(`/api/medications/${id}`, "Erro ao atualizar medicacao.", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
    },
    onSuccess: () => {
      invalidateMedicationQueries();
      setIsMedicationDialogOpen(false);
      setEditingMedication(null);
      toast({ title: "Medicacao atualizada com sucesso" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const deleteMedication = useMutation({
    mutationFn: (id: number) =>
      fetchJsonOrThrow(`/api/medications/${id}`, "Erro ao excluir medicacao.", { method: "DELETE" }),
    onSuccess: () => {
      invalidateMedicationQueries();
      toast({ title: "Medicacao removida" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const registerDose = useMutation({
    mutationFn: async (data: z.infer<typeof doseActionSchema>) => {
      if (!selectedDose) throw new Error("Nenhuma dose selecionada.");
      return fetchJsonOrThrow(`/api/residents/${residentId}/medication-dose-records`, "Erro ao registrar dose.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          medicationId: selectedDose.medicationId,
          scheduledFor: selectedDose.scheduledFor,
          status: data.status,
          notes: data.notes?.trim() || null,
          staffId: isCaregiver ? undefined : data.staffId ?? undefined,
          administeredAt: new Date().toISOString(),
        }),
      });
    },
    onSuccess: () => {
      invalidateMedicationQueries();
      setIsDoseDialogOpen(false);
      setSelectedDose(null);
      toast({ title: "Administracao registrada com sucesso" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const openCreateMedication = () => {
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

  const exportMedicationHistory = () => {
    const rows = (historyQuery.data ?? []).map((item) => [
      item.scheduledFor ? format(new Date(item.scheduledFor), "dd/MM/yyyy HH:mm") : "",
      item.medicationName || "",
      DOSE_STATUS[item.status] ?? item.status,
      item.administeredByName || "",
      item.administeredAt ? format(new Date(item.administeredAt), "dd/MM/yyyy HH:mm") : "",
      item.notes || "",
    ]);

    downloadCsv(
      `historico-medicacoes-residente-${residentId}.csv`,
      ["Data/Hora da dose", "Medicacao", "Status", "Administrado por", "Registro em", "Observacoes"],
      rows,
    );
  };

  const openEditMedication = (medication: MedicationWithResident) => {
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

  return (
    <div className="space-y-4">
      {!canEdit ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/40 px-4 py-3 text-xs text-muted-foreground">
          Modo somente leitura para este perfil.
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MedicationSectionTab)} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-1 rounded-lg border border-border/70 bg-muted/60 p-1 shadow-sm sm:grid-cols-3">
          <TabsTrigger value="medicacoes" className="h-10 font-semibold">Medicacoes</TabsTrigger>
          <TabsTrigger value="agenda" className="h-10 font-semibold">Agenda de doses</TabsTrigger>
          <TabsTrigger value="historico" className="h-10 font-semibold">Historico</TabsTrigger>
        </TabsList>

        <TabsContent value="medicacoes" className="space-y-3">
          {canEdit ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={openCreateMedication}>
                <Plus className="h-4 w-4 mr-1" />
                Nova Medicacao
              </Button>
            </div>
          ) : null}

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
                    <TableRow
                      key={medication.id}
                      id={`medication-row-${residentId}-${medication.id}`}
                      className={cn(
                        focusMedicationId === medication.id && "bg-primary/5 ring-1 ring-inset ring-primary/25",
                      )}
                    >
                      <TableCell className="font-medium">{medication.name}</TableCell>
                      <TableCell>{medication.dosage}</TableCell>
                      <TableCell>{getFrequencyLabel(medication.frequency)}</TableCell>
                      <TableCell>{MED_STATUS[medication.status] ?? medication.status}</TableCell>
                      <TableCell className="text-right">
                        {canEdit ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => openEditMedication(medication)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                confirm({
                                  title: "Excluir medicacao",
                                  description: `Excluir a medicacao "${medication.name}"?`,
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
                        ) : (
                          <span className="text-xs text-muted-foreground">Somente leitura</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="agenda" className="space-y-3">
          <div className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">Agenda de doses</h4>
                <p className="text-xs text-muted-foreground">
                  Doses previstas para o periodo selecionado.
                </p>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={showRegisteredDoses}
                    onCheckedChange={setShowRegisteredDoses}
                    id={`show-registered-doses-${residentId}`}
                  />
                  <Label
                    htmlFor={`show-registered-doses-${residentId}`}
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Mostrar registradas
                  </Label>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">De</Label>
                  <Popover open={isFromCalendarOpen} onOpenChange={setIsFromCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 w-full min-w-[148px] justify-between px-2 font-normal"
                      >
                        <span>{formatDateLabel(range.from)}</span>
                        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <Calendar
                        mode="single"
                        selected={parseDateOnly(range.from) ?? undefined}
                        onSelect={handleFromDateSelect}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Ate</Label>
                  <Popover open={isToCalendarOpen} onOpenChange={setIsToCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 w-full min-w-[148px] justify-between px-2 font-normal"
                      >
                        <span>{formatDateLabel(range.to)}</span>
                        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <Calendar
                        mode="single"
                        selected={parseDateOnly(range.to) ?? undefined}
                        onSelect={handleToDateSelect}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={applyTodayRange}>
                  Hoje
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    queryClient.invalidateQueries({
                      queryKey: ["/api/residents", residentId, "medication-dose-schedule", range.from, range.to],
                    })
                  }
                >
                  Atualizar
                </Button>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Medicamento</Label>
                  <Select value={selectedDoseMedicationFilter} onValueChange={setSelectedDoseMedicationFilter}>
                    <SelectTrigger className="h-8 min-w-[210px]">
                      <SelectValue placeholder="Todos os medicamentos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_MEDICATIONS_FILTER}>Todos os medicamentos</SelectItem>
                      {scheduleMedicationOptions.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {scheduleQuery.isLoading ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Carregando agenda...
              </div>
            ) : scheduleQuery.error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                {scheduleQuery.error instanceof Error
                  ? scheduleQuery.error.message
                  : "Erro ao carregar agenda de doses."}
              </div>
            ) : (scheduleQuery.data?.doses.length ?? 0) === 0 ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Nenhuma dose no periodo selecionado.
              </div>
            ) : visibleScheduleDoses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Todas as doses deste periodo ja foram registradas. Ative "Mostrar registradas" para visualizar.
              </div>
            ) : filteredVisibleScheduleDoses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Nenhuma dose encontrada para o medicamento selecionado.
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
                    {filteredVisibleScheduleDoses.map((dose) => {
                      const doseIsFocused =
                        focusMedicationId === dose.medicationId
                        && isSameScheduledMinute(dose.scheduledFor, focusScheduledFor);
                      return (
                        <TableRow
                          key={dose.key}
                          id={`medication-dose-${residentId}-${dose.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                          className={cn(doseIsFocused && "bg-primary/5 ring-1 ring-inset ring-primary/25")}
                        >
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>{formatScheduleDoseDateTime(dose)}</span>
                              {dose.isOverdue && dose.status === "pending" ? (
                                <span className="text-[11px] text-rose-600">Dose em atraso</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{dose.medicationName}</span>
                              <span className="text-xs text-muted-foreground">{getFrequencyLabel(dose.frequency)}</span>
                            </div>
                          </TableCell>
                          <TableCell>{dose.dosage}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={doseStatusClass(dose.status)}>
                              {DOSE_STATUS[dose.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {dose.administeredByName || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {canEdit ? (
                              <Button size="sm" variant="outline" onClick={() => { setSelectedDose(dose); setIsDoseDialogOpen(true); }}>
                                {dose.status === "pending" ? "Registrar" : "Editar"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Somente leitura</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="historico">
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            <div className="mb-3 flex items-center justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={exportMedicationHistory}
                disabled={(historyQuery.data?.length ?? 0) === 0}
              >
                <Download className="h-4 w-4" />
                Exportar
              </Button>
            </div>
            {historyQuery.isLoading ? (
              <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
                Carregando historico...
              </div>
            ) : historyQuery.error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
                {historyQuery.error instanceof Error
                  ? historyQuery.error.message
                  : "Erro ao carregar historico de administracoes."}
              </div>
            ) : (historyQuery.data?.length ?? 0) === 0 ? (
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
                    {historyQuery.data?.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.scheduledFor ? format(new Date(item.scheduledFor), "dd/MM/yyyy HH:mm") : "-"}</TableCell>
                        <TableCell className="font-medium">{item.medicationName || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={doseStatusClass(item.status)}>
                            {DOSE_STATUS[item.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.administeredByName || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.administeredAt ? format(new Date(item.administeredAt), "dd/MM/yyyy HH:mm") : "-"}
                        </TableCell>
                        <TableCell className="max-w-[260px] text-sm text-muted-foreground">{item.notes || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isMedicationDialogOpen} onOpenChange={setIsMedicationDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingMedication ? "Editar Medicacao" : "Nova Medicacao"}</DialogTitle>
          </DialogHeader>
          <Form {...medicationForm}>
            <form
              onSubmit={medicationForm.handleSubmit((data) => {
                if (editingMedication) updateMedication.mutate({ id: editingMedication.id, data });
                else createMedication.mutate(data);
              })}
              className="space-y-4"
            >
              <FormField control={medicationForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Medicacao *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={medicationForm.control} name="dosage" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dose *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={medicationForm.control} name="frequency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequencia *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecionar frequencia" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {getFrequencyOptions(field.value).map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={medicationForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="suspended">Suspenso</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={medicationForm.control} name="route" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Via</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={medicationForm.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Inicio</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={medicationForm.control} name="endDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fim</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={medicationForm.control} name="scheduleTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Horario base {frequencyNeedsBaseTime(watchedFrequency) ? "*" : "(opcional)"}
                    </FormLabel>
                    <FormControl>
                      <Input type="time" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Ex: a cada 6h + 08:00 = 08:00, 14:00, 20:00, 02:00.
                    </p>
                  </FormItem>
                )} />
                <FormField control={medicationForm.control} name="prescribedBy" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prescrito por</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                  </FormItem>
                )} />
              </div>

              <FormField control={medicationForm.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Observacoes</FormLabel>
                  <FormControl><Textarea {...field} value={field.value ?? ""} rows={3} /></FormControl>
                </FormItem>
              )} />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsMedicationDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMedication.isPending || updateMedication.isPending}>
                  {editingMedication ? "Salvar" : "Adicionar"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDoseDialogOpen} onOpenChange={setIsDoseDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar administracao da dose</DialogTitle>
          </DialogHeader>
          {selectedDose ? (
            <Form {...doseActionForm}>
              <form
                onSubmit={doseActionForm.handleSubmit((data) => {
                  if (!isCaregiver && !data.staffId) {
                    doseActionForm.setError("staffId", { type: "manual", message: "Profissional obrigatorio." });
                    return;
                  }
                  registerDose.mutate(data);
                })}
                className="space-y-4"
              >
                <FormField control={doseActionForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status da dose</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="given">Administrado</SelectItem>
                        <SelectItem value="skipped">Nao administrado</SelectItem>
                        <SelectItem value="refused">Recusado</SelectItem>
                        <SelectItem value="late">Atrasado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {isCaregiver ? (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    {linkedCaregiverStaff?.name || user?.name || "Cuidador logado"}
                  </div>
                ) : (
                  <FormField control={doseActionForm.control} name="staffId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Profissional que administrou *</FormLabel>
                      <Select onValueChange={(value) => field.onChange(Number(value))} value={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecionar profissional" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {staffAdministrators.map((member) => (
                            <SelectItem key={member.id} value={String(member.id)}>
                              {member.name}{member.role ? ` - ${member.role}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}

                <FormField control={doseActionForm.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observacoes</FormLabel>
                    <FormControl><Textarea {...field} value={field.value ?? ""} rows={3} /></FormControl>
                  </FormItem>
                )} />

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsDoseDialogOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={registerDose.isPending}>
                    {registerDose.isPending ? "Salvando..." : "Salvar dose"}
                  </Button>
                </div>
              </form>
            </Form>
          ) : null}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
