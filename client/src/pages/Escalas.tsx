import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  format, startOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isToday, isSameDay, differenceInCalendarDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft, ChevronRight, Plus, X, Clock,
  CalendarDays, AlertCircle, Sun, Moon, Timer, ClipboardList, Pencil, RotateCw
} from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useResidents } from "@/hooks/use-residents";
import { useEnvironmentSettings } from "@/hooks/use-environment-settings";
import { useAuth } from "@/hooks/use-auth";
import { canEditRoute } from "@/lib/permissions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { ShiftAssignment } from "@shared/schema";
import { DEFAULT_ENVIRONMENT_SETTINGS, getShiftProfileRule, type ShiftProfileRule } from "@shared/environment";

type ShiftType = "12h_manha" | "12h_noite" | "24h" | "avulso";

interface ShiftWithDetails extends ShiftAssignment {
  staffName?: string;
  staffRole?: string;
  residentName?: string;
}

const normalizeStaffName = (value?: string | null) =>
  (value ?? "").trim().toLocaleLowerCase("pt-BR");

const compareShiftByStartThenName = (left: ShiftWithDetails, right: ShiftWithDetails) => {
  const startDiff = new Date(left.startTime).getTime() - new Date(right.startTime).getTime();
  if (startDiff !== 0) return startDiff;

  const byName = normalizeStaffName(left.staffName).localeCompare(normalizeStaffName(right.staffName), "pt-BR");
  if (byName !== 0) return byName;

  return left.id - right.id;
};

type GenerateMonthResponse = {
  month: string;
  staffProcessed: number;
  staffWithSchedule: number;
  created: number;
  skipped: number;
  skippedByInvalidSlot: number;
  skippedByOverlap: number;
  skippedByValidation: number;
  clearedGenerated: boolean;
  payablesCreated?: number;
  payablesUpdated?: number;
  payablesDeleted?: number;
  payablesSkippedLocked?: number;
};
type ExcludeDayResponse = {
  message: string;
  shiftId: number;
  staffId: number;
  blockedDate: string;
};
type ShiftPayableResponse = {
  shiftId: number;
  linked: boolean;
  payableId: number | null;
  amount: number | null;
  status: string | null;
  title: string | null;
};
const AUTO_MONTH_NOTE_PREFIX = "[AUTO-MONTH:";

// Shift type metadata
const SHIFT_TYPES: Record<ShiftType, {
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  bg: string;
  text: string;
  border: string;
}> = {
  "12h_manha": {
    label: "12h Manha",
    short: "12h D",
    icon: Sun,
    bg: "bg-sky-100 dark:bg-sky-900/40",
    text: "text-sky-800 dark:text-sky-200",
    border: "border-sky-200 dark:border-sky-700",
  },
  "12h_noite": {
    label: "12h Noite",
    short: "12h N",
    icon: Moon,
    bg: "bg-violet-100 dark:bg-violet-900/40",
    text: "text-violet-800 dark:text-violet-200",
    border: "border-violet-200 dark:border-violet-700",
  },
  "24h": {
    label: "Plantao 24h",
    short: "24h",
    icon: Timer,
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-800 dark:text-amber-200",
    border: "border-amber-200 dark:border-amber-700",
  },
  "avulso": {
    label: "Avulso",
    short: "Avulso",
    icon: ClipboardList,
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-800 dark:text-emerald-200",
    border: "border-emerald-200 dark:border-emerald-700",
  },
};

// Color palette for staff (by index)
const STAFF_COLORS = [
  { pill: "bg-blue-500", light: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200" },
  { pill: "bg-violet-500", light: "bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200" },
  { pill: "bg-emerald-500", light: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200" },
  { pill: "bg-amber-500", light: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200" },
  { pill: "bg-rose-500", light: "bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200" },
  { pill: "bg-cyan-500", light: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-200" },
];

function ShiftTypeBadge({ type }: { type: string }) {
  const meta = SHIFT_TYPES[type as ShiftType] ?? SHIFT_TYPES.avulso;
  const Icon = meta.icon;
  return (
    <Badge className={`gap-1 text-xs ${meta.bg} ${meta.text} border ${meta.border} font-medium`} variant="outline">
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function getShiftDurationHours(type: ShiftType, rule?: ShiftProfileRule): number | null {
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

// Sugere horários iniciais, mas início/fim continuam editáveis.
function getDefaultTimes(type: ShiftType, date: string, rule?: ShiftProfileRule): { startTime: string; endTime: string } {
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
  const durationHours = getShiftDurationHours(type, rule) ?? 9;
  return {
    startTime,
    endTime: addHoursToDateTimeInput(startTime, durationHours) ?? `${date}T17:00`,
  };
}

function getShiftTimesForSubmit(form: { startTime: string; endTime: string }) {
  if (!form.startTime || !form.endTime) {
    throw new Error("Informe horário de início e fim do plantão.");
  }
  return {
    startTime: form.startTime,
    endTime: form.endTime,
  };
}

function isAutoMonthShift(shift: ShiftWithDetails): boolean {
  return typeof shift.notes === "string" && shift.notes.startsWith(AUTO_MONTH_NOTE_PREFIX);
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

function parsePayableAmountInput(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  let normalized = trimmed.replace(/\s+/g, "").replace(/[Rr]\$/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(",", ".");
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export default function Escalas() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [openDialog, setOpenDialog] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<number | null>(null);
  const [shiftToExclude, setShiftToExclude] = useState<ShiftWithDetails | null>(null);
  const [regenerateMonthOpen, setRegenerateMonthOpen] = useState(false);
  const [filterStaff, setFilterStaff] = useState<string>("all");
  const [form, setForm] = useState({
    staffId: "",
    residentId: "none",
    shiftType: "12h_manha" as ShiftType,
    date: format(new Date(), "yyyy-MM-dd"),
    ...getDefaultTimes("12h_manha", format(new Date(), "yyyy-MM-dd")),
    notes: "",
    payableAmount: "",
    applyPayableAsDefault: true,
  });
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: environmentSettings } = useEnvironmentSettings();
  const configuredShiftProfiles = environmentSettings?.shiftProfiles
    ?? DEFAULT_ENVIRONMENT_SETTINGS.shiftProfiles;
  const canEditEscalas = canEditRoute(
    user?.role,
    "/escalas",
    environmentSettings?.roleRoutes,
    environmentSettings?.roleEditRoutes,
  );
  const isCaregiver = user?.role === "cuidador";
  const selectedMonth = format(currentDate, "yyyy-MM");
  const monthRange = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    return { start, end };
  }, [selectedMonth]);

  const { data: shifts = [], isLoading: shiftsLoading } = useQuery<ShiftWithDetails[]>({
    queryKey: ["/api/shift-assignments", selectedMonth],
    queryFn: async () => {
      const queryParams = new URLSearchParams({
        start: formatDateTimeInput(monthRange.start),
        end: formatDateTimeInput(monthRange.end),
      });
      const res = await fetch(`/api/shift-assignments?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Erro ao carregar escalas");
      return res.json();
    },
  });

  const { data: staff = [] } = useQuery<any[]>({
    queryKey: ["/api/staff"],
    queryFn: async () => {
      const res = await fetch("/api/staff");
      if (!res.ok) throw new Error("Erro ao carregar equipe");
      return res.json();
    },
  });
  const { data: residents = [] } = useResidents();
  const { data: editingShiftPayable } = useQuery<ShiftPayableResponse | null>({
    queryKey: ["/api/shift-assignments", editingShiftId, "payable"],
    enabled: Boolean(openDialog && editingShiftId),
    queryFn: async () => {
      if (!editingShiftId) return null;
      const res = await fetch(`/api/shift-assignments/${editingShiftId}/payable`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const linkedStaffForCaregiver = useMemo(() => {
    if (!isCaregiver) return null;
    const normalizedUserName = normalizeStaffName(user?.name);
    if (!normalizedUserName) return null;
    return (
      staff.find((member) => normalizeStaffName(member.name) === normalizedUserName)
      ?? null
    );
  }, [isCaregiver, staff, user?.name]);

  const selectableStaff = useMemo(() => {
    if (!isCaregiver) return staff;
    return linkedStaffForCaregiver ? [linkedStaffForCaregiver] : [];
  }, [isCaregiver, linkedStaffForCaregiver, staff]);
  const defaultStaffIdForForm = isCaregiver && linkedStaffForCaregiver
    ? String(linkedStaffForCaregiver.id)
    : "";

  const selectedStaff = useMemo(
    () => selectableStaff.find((member) => String(member.id) === form.staffId),
    [selectableStaff, form.staffId],
  );
  const resolveDefaultPayableAmount = (staffId: string): string => {
    const member = selectableStaff.find((item) => String(item.id) === staffId);
    const value = Number(member?.shiftValue ?? 0);
    if (!Number.isFinite(value) || value <= 0) return "";
    return value.toFixed(2);
  };
  const selectedStaffRule = useMemo(
    () => getShiftProfileRule(selectedStaff?.shift, configuredShiftProfiles),
    [configuredShiftProfiles, selectedStaff?.shift],
  );
  const selectedStaffRuleHint = useMemo(
    () => buildShiftRuleHint(selectedStaffRule),
    [selectedStaffRule],
  );
  const availableShiftTypes = useMemo<ShiftType[]>(
    () => {
      const allShiftTypes: ShiftType[] = ["12h_manha", "12h_noite", "24h", "avulso"];
      if (!selectedStaffRule.enabled || selectedStaffRule.allowedShiftTypes.length === 0) {
        return allShiftTypes;
      }
      const allowed = selectedStaffRule.allowedShiftTypes.filter((item): item is ShiftType =>
        allShiftTypes.includes(item as ShiftType),
      );
      return allowed.length > 0 ? allowed : allShiftTypes;
    },
    [selectedStaffRule],
  );

  useEffect(() => {
    if (!availableShiftTypes.includes(form.shiftType)) {
      setForm((prev) => {
        const nextShiftType = availableShiftTypes[0] ?? "12h_manha";
        const date = prev.date || format(new Date(), "yyyy-MM-dd");
        const suggestedTimes = getDefaultTimes(nextShiftType, date, selectedStaffRule);
        const previousStartClock = prev.startTime.slice(11, 16);
        const startTime = previousStartClock ? `${date}T${previousStartClock}` : suggestedTimes.startTime;
        const durationHours = getShiftDurationHours(nextShiftType, selectedStaffRule);
        return {
          ...prev,
          shiftType: nextShiftType,
          date,
          startTime,
          endTime: durationHours
            ? (addHoursToDateTimeInput(startTime, durationHours) ?? suggestedTimes.endTime)
            : suggestedTimes.endTime,
        };
      });
    }
  }, [availableShiftTypes, form.shiftType, selectedStaffRule]);

  useEffect(() => {
    if (!isCaregiver) return;
    const linkedStaffId = linkedStaffForCaregiver ? String(linkedStaffForCaregiver.id) : "";
    if (!linkedStaffId || form.staffId === linkedStaffId) return;
    setForm((prev) => ({
      ...prev,
      staffId: linkedStaffId,
      payableAmount: editingShiftId ? prev.payableAmount : resolveDefaultPayableAmount(linkedStaffId),
    }));
  }, [isCaregiver, linkedStaffForCaregiver, form.staffId]);

  useEffect(() => {
    if (!isSameMonth(selectedDay, currentDate)) {
      setSelectedDay(startOfMonth(currentDate));
    }
  }, [currentDate, selectedDay]);
  useEffect(() => {
    if (!editingShiftId || !editingShiftPayable) return;
    if (editingShiftPayable.amount === null || editingShiftPayable.amount === undefined) return;
    const value = Number(editingShiftPayable.amount);
    if (!Number.isFinite(value)) return;
    setForm((prev) => {
      if (prev.payableAmount.trim() !== "") return prev;
      return {
        ...prev,
        payableAmount: value.toFixed(2),
      };
    });
  }, [editingShiftId, editingShiftPayable]);

  // Map staffId -> color index
  const staffColorMap = useMemo(() => {
    const map: Record<number, number> = {};
    staff.forEach((s, i) => { map[s.id] = i % STAFF_COLORS.length; });
    return map;
  }, [staff]);

  const createShiftMutation = useMutation({
    mutationFn: async () => {
      const times = getShiftTimesForSubmit(form);
      const parsedPayableAmount = parsePayableAmountInput(form.payableAmount);
      if (form.payableAmount.trim() && parsedPayableAmount === null) {
        throw new Error("Valor do plantão inválido. Use apenas numeros (ex.: 300 ou 300,50).");
      }

      const res = await fetch("/api/shift-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: Number(form.staffId),
          residentId: form.residentId === "none" ? null : Number(form.residentId),
          shiftType: form.shiftType,
          startTime: times.startTime,
          endTime: times.endTime,
          notes: form.notes || null,
          payableAmount: parsedPayableAmount,
          promoteToStaffDefault: form.applyPayableAsDefault,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Erro");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Escala criada com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts-payable"] });
      setOpenDialog(false);
      const defaultStaff = selectableStaff.find((member) => String(member.id) === defaultStaffIdForForm);
      const defaultRule = getShiftProfileRule(defaultStaff?.shift, configuredShiftProfiles);
      setForm({
        staffId: defaultStaffIdForForm,
        residentId: "none",
        shiftType: "12h_manha",
        date: format(new Date(), "yyyy-MM-dd"),
        ...getDefaultTimes("12h_manha", format(new Date(), "yyyy-MM-dd"), defaultRule),
        notes: "",
        payableAmount: resolveDefaultPayableAmount(defaultStaffIdForForm),
        applyPayableAsDefault: true,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const updateShiftMutation = useMutation({
    mutationFn: async (id: number) => {
      const times = getShiftTimesForSubmit(form);
      const parsedPayableAmount = parsePayableAmountInput(form.payableAmount);
      if (form.payableAmount.trim() && parsedPayableAmount === null) {
        throw new Error("Valor do plantão inválido. Use apenas numeros (ex.: 300 ou 300,50).");
      }

      const res = await fetch(`/api/shift-assignments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: Number(form.staffId),
          residentId: form.residentId === "none" ? null : Number(form.residentId),
          shiftType: form.shiftType,
          startTime: times.startTime,
          endTime: times.endTime,
          notes: form.notes || null,
          ...(form.payableAmount.trim() !== "" && parsedPayableAmount !== null
            ? {
              payableAmount: parsedPayableAmount,
              promoteToStaffDefault: form.applyPayableAsDefault,
            }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Erro");
      }
      const updatedShift = await res.json();

      if (form.payableAmount.trim() !== "" && parsedPayableAmount !== null) {
        const syncRes = await fetch(`/api/shift-assignments/${id}/payable`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payableAmount: parsedPayableAmount,
            promoteToStaffDefault: form.applyPayableAsDefault,
          }),
        });
        if (!syncRes.ok) {
          const syncData = await syncRes.json().catch(() => ({}));
          throw new Error(
            (typeof syncData.message === "string" && syncData.message)
              || "Escala salva, mas não foi possível atualizar o contas a pagar deste plantão.",
          );
        }
      }

      return updatedShift;
    },
    onSuccess: (_data, id) => {
      toast({ title: "Escala atualizada!" });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts-payable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments", id, "payable"] });
      setOpenDialog(false);
      setEditingShiftId(null);
      const defaultStaff = selectableStaff.find((member) => String(member.id) === defaultStaffIdForForm);
      const defaultRule = getShiftProfileRule(defaultStaff?.shift, configuredShiftProfiles);
      setForm({
        staffId: defaultStaffIdForForm,
        residentId: "none",
        shiftType: "12h_manha",
        date: format(new Date(), "yyyy-MM-dd"),
        ...getDefaultTimes("12h_manha", format(new Date(), "yyyy-MM-dd"), defaultRule),
        notes: "",
        payableAmount: resolveDefaultPayableAmount(defaultStaffIdForForm),
        applyPayableAsDefault: true,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/shift-assignments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao deletar escala");
    },
    onSuccess: () => {
      toast({ title: "Escala removida" });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts-payable"] });
    },
  });
  const excludeSingleDayMutation = useMutation({
    mutationFn: async (shift: ShiftWithDetails): Promise<ExcludeDayResponse> => {
      const res = await fetch(`/api/shift-assignments/${shift.id}/exclude-day`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Erro ao dispensar dia");
      }
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Dia dispensado",
        description: `${result.blockedDate} foi removido da escala recorrente deste colaborador.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts-payable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });
  const generateMonthMutation = useMutation({
    mutationFn: async (options?: { clearGenerated?: boolean }): Promise<GenerateMonthResponse> => {
      const res = await fetch("/api/shift-assignments/generate-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: selectedMonth,
          clearGenerated: options?.clearGenerated === true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Erro ao gerar agenda do mês");
      }
      return res.json();
    },
    onSuccess: (result) => {
      const parts: string[] = [`${result.created} criado(s)`];
      if (result.skipped > 0) {
        parts.push(`${result.skipped} ignorado(s)`);
      }
      if ((result.payablesCreated ?? 0) > 0 || (result.payablesUpdated ?? 0) > 0) {
        parts.push(
          `${result.payablesCreated ?? 0} conta(s) criada(s), ${result.payablesUpdated ?? 0} atualizada(s)`,
        );
      }
      if ((result.payablesSkippedLocked ?? 0) > 0) {
        parts.push(`${result.payablesSkippedLocked} bloqueada(s) por pagamento já registrado`);
      }
      toast({
        title: result.clearedGenerated
          ? `Agenda de ${result.month} regenerada`
          : `Agenda de ${result.month} atualizada`,
        description: parts.join(" - "),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts-payable"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const monthStart = monthRange.start;
  const monthEnd = monthRange.end;
  const calendarDays = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 0 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
  });
  const calendarWeeks = useMemo(() => {
    const weeks: Date[][] = [];
    for (let index = 0; index < calendarDays.length; index += 7) {
      weeks.push(calendarDays.slice(index, index + 7));
    }
    return weeks;
  }, [calendarDays]);

  const filteredShifts = useMemo(() => {
    if (filterStaff === "all") return shifts;
    return shifts.filter((s) => s.staffId === Number(filterStaff));
  }, [shifts, filterStaff]);

  const shiftTouchesDay = (s: ShiftWithDetails, day: Date) => {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
    const shiftStart = new Date(s.startTime);
    const shiftEnd = new Date(s.endTime);
    return shiftStart <= dayEnd && shiftEnd >= dayStart;
  };

  const weekLayouts = useMemo(() => {
    return calendarWeeks.map((weekDays) => {
      const weekStart = new Date(weekDays[0].getFullYear(), weekDays[0].getMonth(), weekDays[0].getDate(), 0, 0, 0, 0);
      const weekEnd = new Date(weekDays[6].getFullYear(), weekDays[6].getMonth(), weekDays[6].getDate(), 23, 59, 59, 999);

      const candidates = filteredShifts
        .map((shift) => {
          const shiftStart = new Date(shift.startTime);
          const shiftEnd = new Date(shift.endTime);
          if (shiftEnd < weekStart || shiftStart > weekEnd) return null;

          const visibleStart = shiftStart > weekStart ? shiftStart : weekStart;
          const visibleEnd = shiftEnd < weekEnd ? shiftEnd : weekEnd;
          const visibleStartDay = new Date(
            visibleStart.getFullYear(),
            visibleStart.getMonth(),
            visibleStart.getDate(),
            0,
            0,
            0,
            0,
          );
          const visibleEndDay = new Date(
            visibleEnd.getFullYear(),
            visibleEnd.getMonth(),
            visibleEnd.getDate(),
            0,
            0,
            0,
            0,
          );

          const startCol = Math.max(0, Math.min(6, differenceInCalendarDays(visibleStartDay, weekStart)));
          const endCol = Math.max(startCol, Math.min(6, differenceInCalendarDays(visibleEndDay, weekStart)));

          return {
            shift,
            startCol,
            endCol,
            span: endCol - startCol,
            visibleStartMs: visibleStart.getTime(),
            shiftStartMs: shiftStart.getTime(),
          };
        })
        .filter((item): item is {
          shift: ShiftWithDetails;
          startCol: number;
          endCol: number;
          span: number;
          visibleStartMs: number;
          shiftStartMs: number;
        } => !!item)
        .sort((a, b) => {
          if (a.startCol !== b.startCol) return a.startCol - b.startCol;
          if (a.visibleStartMs !== b.visibleStartMs) return a.visibleStartMs - b.visibleStartMs;
          const byName = normalizeStaffName(a.shift.staffName).localeCompare(normalizeStaffName(b.shift.staffName), "pt-BR");
          if (byName !== 0) return byName;
          if (a.span !== b.span) return b.span - a.span;
          return a.shiftStartMs - b.shiftStartMs;
        });

      const occupancy: boolean[][] = [];
      const segments = candidates.map((candidate) => {
        let rowIndex = occupancy.findIndex((row) => {
          for (let col = candidate.startCol; col <= candidate.endCol; col++) {
            if (row[col]) return false;
          }
          return true;
        });

        if (rowIndex === -1) {
          occupancy.push(new Array<boolean>(7).fill(false));
          rowIndex = occupancy.length - 1;
        }

        for (let col = candidate.startCol; col <= candidate.endCol; col++) {
          occupancy[rowIndex][col] = true;
        }

        return {
          ...candidate,
          row: rowIndex,
        };
      });

      return {
        weekDays,
        segments,
        rowCount: occupancy.length,
      };
    });
  }, [calendarWeeks, filteredShifts]);

  const selectedDayShifts = useMemo(() =>
    filteredShifts
      .filter((s) => shiftTouchesDay(s, selectedDay))
      .sort((a, b) => {
        const dayStartMs = new Date(
          selectedDay.getFullYear(),
          selectedDay.getMonth(),
          selectedDay.getDate(),
          0,
          0,
          0,
          0,
        ).getTime();
        const aEffectiveStart = Math.max(new Date(a.startTime).getTime(), dayStartMs);
        const bEffectiveStart = Math.max(new Date(b.startTime).getTime(), dayStartMs);
        if (aEffectiveStart !== bEffectiveStart) {
          return aEffectiveStart - bEffectiveStart;
        }
        return compareShiftByStartThenName(a, b);
      }),
    [filteredShifts, selectedDay]
  );

  // Count shifts currently active
  const now = new Date();
  const activeCount = shifts.filter((s) => now >= new Date(s.startTime) && now <= new Date(s.endTime)).length;

  // Count how many shifts this month
  const monthShiftCount = shifts.length;

  function notifyNoEditPermission() {
    toast({
      title: "Sem permissão de edição",
      description: "Seu perfil pode apenas visualizar as escalas.",
      variant: "destructive",
    });
  }

  function openCreate(day?: Date) {
    if (!canEditEscalas) {
      notifyNoEditPermission();
      return;
    }
    setEditingShiftId(null);
    const date = format(day ?? new Date(), "yyyy-MM-dd");
    const defaultStaff = selectableStaff.find((member) => String(member.id) === defaultStaffIdForForm);
    const defaultRule = getShiftProfileRule(defaultStaff?.shift, configuredShiftProfiles);
    setForm({
      staffId: defaultStaffIdForForm,
      residentId: "none",
      shiftType: "12h_manha",
      date,
      ...getDefaultTimes("12h_manha", date, defaultRule),
      notes: "",
      payableAmount: resolveDefaultPayableAmount(defaultStaffIdForForm),
      applyPayableAsDefault: true,
    });
    setOpenDialog(true);
  }

  function openEdit(shift: ShiftWithDetails) {
    if (!canEditEscalas) {
      notifyNoEditPermission();
      return;
    }
    setEditingShiftId(shift.id);
    queryClient.invalidateQueries({ queryKey: ["/api/shift-assignments", shift.id, "payable"] });
    const startDate = new Date(shift.startTime);
    const endDate = new Date(shift.endTime);
    const shiftType = (shift.shiftType as ShiftType) || "avulso";
    setForm({
      staffId: String(shift.staffId),
      residentId: shift.residentId ? String(shift.residentId) : "none",
      shiftType,
      date: format(startDate, "yyyy-MM-dd"),
      startTime: format(startDate, "yyyy-MM-dd'T'HH:mm"),
      endTime: format(endDate, "yyyy-MM-dd'T'HH:mm"),
      notes: shift.notes || "",
      payableAmount: "",
      applyPayableAsDefault: true,
    });
    setOpenDialog(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-display">Escalas</h1>
          <p className="text-muted-foreground mt-1">Plantões e escalas de trabalho da equipe</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            variant="outline"
            onClick={() => generateMonthMutation.mutate({ clearGenerated: false })}
            disabled={!canEditEscalas || generateMonthMutation.isPending}
            data-testid="button-generate-month"
            className="w-full sm:w-auto gap-2"
          >
            <RotateCw className={`h-4 w-4 ${generateMonthMutation.isPending ? "animate-spin" : ""}`} />
            {generateMonthMutation.isPending ? "Gerando..." : "Gerar Agenda do Mês"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setRegenerateMonthOpen(true)}
            disabled={!canEditEscalas || generateMonthMutation.isPending}
            data-testid="button-regenerate-month"
            className="w-full sm:w-auto gap-2"
          >
            <RotateCw className={`h-4 w-4 ${generateMonthMutation.isPending ? "animate-spin" : ""}`} />
            Regenerar mês
          </Button>
          <Button onClick={() => openCreate()} data-testid="button-add-shift" className="w-full sm:w-auto gap-2 shrink-0" disabled={!canEditEscalas}>
            <Plus className="h-4 w-4" />
            Novo Plantão
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Plantões este mês</p>
          <p className="text-2xl font-bold text-foreground mt-0.5">{monthShiftCount}</p>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${activeCount > 0 ? "border-green-300 bg-green-50 dark:bg-green-950/20" : "border-border bg-card"}`}>
          <p className="text-xs text-muted-foreground">Em andamento agora</p>
          <p className={`text-2xl font-bold mt-0.5 ${activeCount > 0 ? "text-green-700 dark:text-green-400" : "text-foreground"}`}>{activeCount}</p>
        </div>
        {(["12h_manha", "12h_noite"] as ShiftType[]).map(type => {
          const meta = SHIFT_TYPES[type];
          const count = shifts.filter((s) => s.shiftType === type).length;
          return (
            <div key={type} className={`rounded-xl border px-4 py-3 ${meta.bg} ${meta.border} border`}>
              <p className={`text-xs ${meta.text} opacity-80`}>{meta.label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${meta.text}`}>{count}</p>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground font-medium">Tipos:</span>
        {Object.entries(SHIFT_TYPES).map(([key, meta]) => {
          const Icon = meta.icon;
          return (
            <span key={key} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${meta.bg} ${meta.text} border ${meta.border}`}>
              <Icon className="h-3 w-3" />
              {meta.label}
            </span>
          );
        })}
      </div>

      {/* Filter */}
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Label className="text-sm font-medium shrink-0">Ver cuidador:</Label>
        <Select value={filterStaff} onValueChange={setFilterStaff}>
          <SelectTrigger className="w-full sm:w-56" data-testid="select-staff-filter">
            <SelectValue placeholder="Toda equipe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda equipe</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Calendar + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base capitalize">
              {format(currentDate, "MMMM 'de' yyyy", { locale: ptBR })}
            </CardTitle>
            <div className="flex w-full gap-1 sm:w-auto">
              <Button variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}
                data-testid="button-prev-month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 flex-1 text-xs sm:flex-none"
                onClick={() => { setCurrentDate(new Date()); setSelectedDay(new Date()); }}
                data-testid="button-today">
                Hoje
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}
                data-testid="button-next-month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {shiftsLoading ? (
              <div className="text-center py-12 text-muted-foreground text-sm">Carregando escalas...</div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-7 mb-1">
                    {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((d) => (
                      <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
                    ))}
                  </div>
                  <div className="rounded-xl overflow-hidden border border-border/50 bg-border/50">
                    {weekLayouts.map((week, weekIndex) => {
                      const barsHeight = week.rowCount > 0 ? (week.rowCount * 22) + 2 : 0;
                      const weekCellHeight = 86 + barsHeight;
                      return (
                        <div key={`week-${weekIndex}`} className={weekIndex > 0 ? "border-t border-border/50" : ""}>
                          <div className="relative bg-border/50">
                            <div className="grid grid-cols-7 gap-px">
                              {week.weekDays.map((day, dayIndex) => {
                                const inMonth = isSameMonth(day, currentDate);
                                const isCurrentDay = isToday(day);
                                const isSelected = isSameDay(day, selectedDay);
                                return (
                                  <div
                                    key={dayIndex}
                                    onClick={() => setSelectedDay(day)}
                                    className={`p-1.5 cursor-pointer transition-colors
                                      ${inMonth ? "bg-background hover:bg-muted/50" : "bg-muted/20 hover:bg-muted/30"}
                                      ${isSelected ? "ring-2 ring-primary ring-inset" : ""}
                                      ${isCurrentDay && !isSelected ? "bg-primary/5" : ""}
                                    `}
                                    style={{ minHeight: `${weekCellHeight}px` }}
                                    data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                                  >
                                    <div className={`w-6 h-6 flex items-center justify-center rounded-full mb-1 font-medium text-xs
                                      ${isCurrentDay ? "bg-primary text-primary-foreground" : ""}
                                      ${!inMonth ? "text-muted-foreground/50" : "text-foreground"}
                                    `}>
                                      {format(day, "d")}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {week.segments.length > 0 && (
                              <div className="absolute left-1 right-1 top-8 pointer-events-none" style={{ height: `${barsHeight}px` }}>
                                {week.segments.map(({ shift, startCol, endCol, row }) => {
                                  const meta = SHIFT_TYPES[shift.shiftType as ShiftType] ?? SHIFT_TYPES.avulso;
                                  const colorIdx = staffColorMap[shift.staffId] ?? 0;
                                  const staffColor = STAFF_COLORS[colorIdx];
                                  const leftPercent = (startCol / 7) * 100;
                                  const widthPercent = ((endCol - startCol + 1) / 7) * 100;
                                  return (
                                    <button
                                      key={`${shift.id}-${weekIndex}-${row}-${startCol}-${endCol}`}
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setSelectedDay(new Date(shift.startTime));
                                      }}
                                      className={`absolute h-5 rounded px-1.5 leading-none truncate text-[10px] font-medium text-left border border-border/40 pointer-events-auto ${staffColor.light}`}
                                      style={{
                                        top: `${row * 22}px`,
                                        left: `${leftPercent}%`,
                                        width: `${widthPercent}%`,
                                      }}
                                      title={`${shift.staffName} - ${meta.label}${shift.residentName ? ` - ${shift.residentName}` : ""}`}
                                      data-testid={`shift-pill-${shift.id}`}
                                    >
                                      {shift.staffName?.split(" ")[0]} - {meta.short}
                                      {shift.residentName ? ` / ${shift.residentName.split(" ")[0]}` : ""}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Day Detail Panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">
                    {isToday(selectedDay) ? "Hoje" : format(selectedDay, "d 'de' MMMM", { locale: ptBR })}
                  </CardTitle>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                  onClick={() => openCreate(selectedDay)} data-testid="button-add-shift-day" disabled={!canEditEscalas}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground capitalize pl-6">
                {format(selectedDay, "EEEE", { locale: ptBR })}
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              {selectedDayShifts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <AlertCircle className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Nenhum plantão neste dia</p>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto gap-1 text-xs"
                    onClick={() => openCreate(selectedDay)} disabled={!canEditEscalas}>
                    <Plus className="h-3 w-3" />
                    Adicionar plantão
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {selectedDayShifts.length} plantão{selectedDayShifts.length > 1 ? "oes" : ""} agendado{selectedDayShifts.length > 1 ? "s" : ""}
                  </p>
                  {selectedDayShifts.map((shift, i) => {
                    const colorIdx = staffColorMap[shift.staffId] ?? 0;
                    const staffColor = STAFF_COLORS[colorIdx];
                    const isActive = now >= new Date(shift.startTime) && now <= new Date(shift.endTime);

                    return (
                      <div key={shift.id}>
                        {i > 0 && <Separator className="my-3" />}
                        <div className="space-y-2" data-testid={`shift-detail-${shift.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <ShiftTypeBadge type={shift.shiftType || "avulso"} />
                            {canEditEscalas && (
                              <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                                <button
                                  onClick={() => openEdit(shift)}
                                  className="text-muted-foreground hover:text-primary transition-colors p-0.5"
                                  data-testid={`button-edit-shift-${shift.id}`}
                                  title="Editar plantão"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                {isAutoMonthShift(shift) && (
                                  <button
                                    onClick={() => setShiftToExclude(shift)}
                                    className="inline-flex items-center gap-1 text-amber-700 bg-amber-100/80 border border-amber-300/70 hover:bg-amber-200 hover:text-amber-800 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-700/60 dark:hover:bg-amber-900/35 transition-colors px-1.5 py-0.5 text-[10px] font-semibold rounded"
                                    data-testid={`button-exclude-day-shift-${shift.id}`}
                                    title="Dispensar apenas este dia da recorrencia"
                                    disabled={excludeSingleDayMutation.isPending}
                                  >
                                    <AlertCircle className="h-3 w-3" />
                                    Dispensar
                                  </button>
                                )}
                                <button
                                  onClick={() => deleteShiftMutation.mutate(shift.id)}
                                  className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                                  data-testid={`button-delete-shift-${shift.id}`}
                                  title="Remover plantão"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <div className={`h-2 w-2 rounded-full shrink-0 ${staffColor.pill}`} />
                            <div>
                              <p className="text-sm font-semibold leading-tight">{shift.staffName}</p>
                              {shift.staffRole && (
                                <p className="text-xs text-muted-foreground">{shift.staffRole}</p>
                              )}
                              {shift.residentName && (
                                <p className="text-xs text-muted-foreground">Assistido: {shift.residentName}</p>
                              )}
                            </div>
                            {isActive && (
                              <Badge className="sm:ml-auto bg-green-500 text-white text-[10px] px-1.5">Em andamento</Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              {format(new Date(shift.startTime), "HH:mm")} - {format(new Date(shift.endTime), "HH:mm")}
                              {!isSameDay(new Date(shift.startTime), new Date(shift.endTime)) && (
                                <span className="ml-1 text-muted-foreground/60">(+1 dia)</span>
                              )}
                            </span>
                          </div>

                          {shift.notes && (
                            <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 italic leading-relaxed">
                              {shift.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Staff legend */}
          {staff.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Equipe</p>
                <div className="space-y-2">
                  {staff.map((s: any, i: number) => {
                    const color = STAFF_COLORS[i % STAFF_COLORS.length];
                    const monthCount = shifts.filter((sh) => sh.staffId === s.id).length;
                    return (
                      <div key={s.id} className="flex items-center gap-2.5">
                        <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${color.pill}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{s.name}</p>
                          <p className="text-[10px] text-muted-foreground">{s.role}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{monthCount}p</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create / Edit Shift Dialog */}
      <Dialog open={openDialog} onOpenChange={(open) => {
        setOpenDialog(open);
        if (!open) { setEditingShiftId(null); }
      }}>
        <DialogContent data-testid="dialog-create-shift">
          <DialogHeader>
            <DialogTitle>{editingShiftId ? "Editar Plantao" : "Novo Plantao"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {/* Staff */}
            <div>
              <Label className="text-sm font-medium">Cuidador / Funcionário *</Label>
              <Select
                value={form.staffId}
                onValueChange={(v) =>
                  setForm((current) => {
                    const nextStaff = selectableStaff.find((member) => String(member.id) === v);
                    const nextRule = getShiftProfileRule(nextStaff?.shift, configuredShiftProfiles);
                    const allShiftTypes: ShiftType[] = ["12h_manha", "12h_noite", "24h", "avulso"];
                    const allowedShiftTypes = nextRule.enabled && nextRule.allowedShiftTypes.length > 0
                      ? nextRule.allowedShiftTypes.filter((item): item is ShiftType =>
                        allShiftTypes.includes(item as ShiftType),
                      )
                      : allShiftTypes;
                    const nextShiftType = allowedShiftTypes.includes(current.shiftType)
                      ? current.shiftType
                      : (allowedShiftTypes[0] ?? "12h_manha");
                    const date = current.date || format(new Date(), "yyyy-MM-dd");
                    const suggestedTimes = getDefaultTimes(nextShiftType, date, nextRule);
                    const previousStartClock = current.startTime.slice(11, 16);
                    const startTime = previousStartClock ? `${date}T${previousStartClock}` : suggestedTimes.startTime;
                    const durationHours = getShiftDurationHours(nextShiftType, nextRule);
                    return {
                      ...current,
                      staffId: v,
                      shiftType: nextShiftType,
                      date,
                      startTime,
                      endTime: durationHours
                        ? (addHoursToDateTimeInput(startTime, durationHours) ?? suggestedTimes.endTime)
                        : suggestedTimes.endTime,
                      payableAmount: editingShiftId ? current.payableAmount : resolveDefaultPayableAmount(v),
                    };
                  })}
                disabled={isCaregiver}
              >
                <SelectTrigger className="mt-1.5" data-testid="select-staff">
                  <SelectValue placeholder="Selecione o funcionário" />
                </SelectTrigger>
                <SelectContent>
                  {selectableStaff.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      <span>{s.name}</span>
                      <span className="ml-2 text-muted-foreground text-xs">- {s.role}</span>
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
            </div>

            <div>
              <Label className="text-sm font-medium">Residente / Assistido</Label>
              <Select value={form.residentId} onValueChange={(v) => setForm({ ...form, residentId: v })}>
                <SelectTrigger className="mt-1.5" data-testid="select-resident">
                  <SelectValue placeholder="Sem residente vinculado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem residente vinculado</SelectItem>
                  {residents.map((resident) => (
                    <SelectItem key={resident.id} value={String(resident.id)}>
                      {resident.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1.5">
                Vincule quando o plantão for dedicado a um assistido especifico.
              </p>
            </div>

            {/* Shift Type */}
            <div>
              <Label className="text-sm font-medium">Tipo de Plantao *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
                {availableShiftTypes.map((key) => {
                  const meta = SHIFT_TYPES[key];
                  const Icon = meta.icon;
                  const isSelected = form.shiftType === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        const date = form.date || format(new Date(), "yyyy-MM-dd");
                        setForm({
                          ...form,
                          shiftType: key,
                          date,
                          ...getDefaultTimes(key, date, selectedStaffRule),
                        });
                      }}
                      data-testid={`shift-type-${key}`}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left
                        ${isSelected
                          ? `${meta.bg} ${meta.text} ${meta.border} ring-2 ring-offset-1 ring-current/30`
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <div>
                        <p className="leading-none">{meta.label}</p>
                        <p className="text-[10px] opacity-70 mt-0.5">
                          {key === "avulso" ? "horário livre" : "horários editáveis"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date and editable times */}
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Data do Plantao *</Label>
                <Input
                  type="date"
                  className="mt-1.5"
                  value={form.date}
                  onChange={(e) => {
                    const date = e.target.value;
                    const suggestedTimes = getDefaultTimes(form.shiftType, date, selectedStaffRule);
                    const previousStartClock = form.startTime.slice(11, 16);
                    const startTime = previousStartClock ? `${date}T${previousStartClock}` : suggestedTimes.startTime;
                    const durationHours = getShiftDurationHours(form.shiftType, selectedStaffRule);
                    const endTime = durationHours
                      ? (addHoursToDateTimeInput(startTime, durationHours) ?? suggestedTimes.endTime)
                      : suggestedTimes.endTime;
                    setForm({
                      ...form,
                      date,
                      startTime,
                      endTime,
                    });
                  }}
                  data-testid="input-date"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">Inicio *</Label>
                  <Input type="datetime-local" className="mt-1.5"
                    value={form.startTime}
                    onChange={(e) => {
                      const startTime = e.target.value;
                      const durationHours = getShiftDurationHours(form.shiftType, selectedStaffRule);
                      setForm({
                        ...form,
                        date: startTime.slice(0, 10) || form.date,
                        startTime,
                        endTime: durationHours
                          ? (addHoursToDateTimeInput(startTime, durationHours) ?? form.endTime)
                          : form.endTime,
                      });
                    }}
                    data-testid="input-start-time" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Fim *</Label>
                  <Input type="datetime-local" className="mt-1.5"
                    value={form.endTime}
                    onChange={(e) => {
                      const endTime = e.target.value;
                      const durationHours = getShiftDurationHours(form.shiftType, selectedStaffRule);
                      const startTime = durationHours
                        ? (subtractHoursFromDateTimeInput(endTime, durationHours) ?? form.startTime)
                        : form.startTime;
                      setForm({
                        ...form,
                        date: startTime.slice(0, 10) || form.date,
                        startTime,
                        endTime,
                      });
                    }}
                    data-testid="input-end-time" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {getShiftDurationHours(form.shiftType, selectedStaffRule)
                  ? `Inicio e fim sao editaveis; ao alterar um deles, o outro e recalculado para ${getShiftDurationHours(form.shiftType, selectedStaffRule)}h.`
                  : "A data preenche uma sugestão pelo tipo selecionado, mas início e fim podem ser ajustados manualmente."}
              </p>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-sm font-medium">Observações</Label>
              <Textarea className="mt-1.5 resize-none" rows={2}
                placeholder="Anotações sobre este plantão..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                data-testid="textarea-notes" />
            </div>

            <div>
              <Label className="text-sm font-medium">Valor do plantão (R$)</Label>
              <Input
                type="text"
                inputMode="decimal"
                className="mt-1.5"
                value={form.payableAmount}
                onChange={(e) => setForm({ ...form, payableAmount: e.target.value })}
                data-testid="input-payable-amount"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                {editingShiftId
                  ? "No modo edição, informe um valor para atualizar o contas a pagar deste plantão (use 0 para remover)."
                  : "Ao criar o plantão, este valor será lançado automaticamente em contas a pagar."}
              </p>
              <div className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-foreground">Aplicar como valor padrao do colaborador</p>
                    <p className="text-[11px] text-muted-foreground">
                      Quando ligado, esse valor vira base para as próximas gerações de agenda do mês.
                    </p>
                  </div>
                  <Switch
                    checked={form.applyPayableAsDefault}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({ ...current, applyPayableAsDefault: Boolean(checked) }))
                    }
                    data-testid="switch-apply-payable-as-default"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setOpenDialog(false)}>Cancelar</Button>
              {editingShiftId ? (
                <Button className="flex-1"
                  disabled={!canEditEscalas || updateShiftMutation.isPending || !form.staffId}
                  onClick={() => updateShiftMutation.mutate(editingShiftId)}
                  data-testid="button-save-shift">
                  {updateShiftMutation.isPending ? "Salvando..." : "Salvar Alteracoes"}
                </Button>
              ) : (
                <Button className="flex-1"
                  disabled={!canEditEscalas || createShiftMutation.isPending || !form.staffId}
                  onClick={() => createShiftMutation.mutate()}
                  data-testid="button-create-shift">
                  {createShiftMutation.isPending ? "Criando..." : "Criar Plantao"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={regenerateMonthOpen}
        onOpenChange={(open) => {
          if (!open && !generateMonthMutation.isPending) {
            setRegenerateMonthOpen(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerar agenda do mês?</AlertDialogTitle>
            <AlertDialogDescription>
              Os plantões automáticos de {selectedMonth} serão removidos e criados novamente com os horários atuais.
              Plantões manuais, dias dispensados e contas já pagas continuam preservados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generateMonthMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setRegenerateMonthOpen(false);
                generateMonthMutation.mutate({ clearGenerated: true });
              }}
              disabled={generateMonthMutation.isPending}
              data-testid="button-confirm-regenerate-month"
            >
              {generateMonthMutation.isPending ? "Regenerando..." : "Regenerar mês"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!shiftToExclude}
        onOpenChange={(open) => {
          if (!open && !excludeSingleDayMutation.isPending) {
            setShiftToExclude(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dispensar este dia?</AlertDialogTitle>
            <AlertDialogDescription>
              {shiftToExclude ? (
                <>
                  Você vai dispensar apenas o dia <strong>{format(new Date(shiftToExclude.startTime), "dd/MM/yyyy")}</strong> de{" "}
                  <strong>{shiftToExclude.staffName || "colaborador"}</strong>.
                  <br />
                  Esse dia não será recriado na geração automática do mês.
                </>
              ) : (
                "Confirme para dispensar apenas um dia da recorrência."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excludeSingleDayMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!shiftToExclude) return;
                const targetShift = shiftToExclude;
                setShiftToExclude(null);
                excludeSingleDayMutation.mutate(targetShift);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={excludeSingleDayMutation.isPending}
              data-testid="button-confirm-exclude-day"
            >
              {excludeSingleDayMutation.isPending ? "Dispensando..." : "Dispensar dia"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
