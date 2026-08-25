import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useStaff } from "@/hooks/use-staff";
import { useToast } from "@/hooks/use-toast";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "@/hooks/use-environment-settings";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { toMonthInputValue } from "@/lib/date";
import { downloadCsvRows } from "@/lib/csv";
import { printHtmlDocument } from "@/lib/print";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_TIME_CLOCK_SETTINGS,
  normalizeEnvironmentSettings,
  type TimeClockSettings,
} from "@shared/environment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Coffee,
  FileDown,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  Play,
  Printer,
  RotateCcw,
  Save,
  ShieldCheck,
  TimerReset,
  Trash2,
  X,
} from "lucide-react";

type TimeClockLocation = {
  id: number;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  active: boolean | null;
};

type TimeClockEntry = {
  id: number;
  staffId: number;
  staffName?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  eventType: TimeClockEventType;
  eventTime: string | Date;
  distanceMeters?: number | null;
  notes?: string | null;
  status: "valid" | "out_of_range" | "manual_adjusted" | "pending_approval" | "rejected" | "corrected";
};

type TimeClockEventType = "clock_in" | "break_start" | "break_end" | "clock_out";

type TimeClockAdjustmentStatus = "pending" | "approved" | "rejected";

type TimeClockAdjustmentRequest = {
  id: number;
  staffId: number;
  staffName?: string | null;
  requestedByName?: string | null;
  reviewedByName?: string | null;
  entryId?: number | null;
  eventType: TimeClockEventType;
  requestedEventTime: string | Date;
  reason: string;
  notes?: string | null;
  status: TimeClockAdjustmentStatus;
  reviewerNotes?: string | null;
  appliedEntryId?: number | null;
  createdAt: string | Date | null;
};

type TimeClockAuditLog = {
  id: number;
  staffName?: string | null;
  performedByName?: string | null;
  entityType: string;
  action: string;
  reason?: string | null;
  createdAt: string | Date | null;
};

type TimeClockClosure = {
  id: number;
  referenceMonth: string;
  status: "closed" | "reopened";
  notes?: string | null;
  closedAt: string | Date | null;
  reopenedAt: string | Date | null;
};

type TimeClockStatus = {
  staff: { id: number; name: string; role: string } | null;
  current: { state: "closed" | "working" | "on_break"; nextActions: TimeClockEventType[]; message?: string | null };
  todayEntries: TimeClockEntry[];
  hasShiftToday?: boolean;
  shiftCountToday?: number;
  locations: TimeClockLocation[];
};

type DailySummary = {
  key: string;
  date: string;
  staffId: number;
  staffName: string | null;
  expectedMinutes: number;
  workedMinutes: number;
  balanceMinutes: number;
  incomplete: boolean;
  lateMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  absence: boolean;
  expectedStart?: string | null;
  expectedEnd?: string | null;
  firstClockIn?: string | null;
  lastClockOut?: string | null;
};

type TimeClockEntriesResponse = {
  month: string;
  entries: TimeClockEntry[];
  dailySummaries: DailySummary[];
  settings?: TimeClockSettings;
  monthSummary: {
    expectedMinutes: number;
    workedMinutes: number;
    balanceMinutes: number;
    incompleteDays: number;
    lateMinutes: number;
    overtimeMinutes: number;
    nightMinutes: number;
    absences: number;
  };
  closure?: TimeClockClosure | null;
};

type CapturedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  label?: string | null;
};

type ReverseGeocodeResponse = {
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
  displayName: string | null;
};

type GeocodeAddressResponse = ReverseGeocodeResponse;

type CepLookupResponse = {
  cep: string;
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string;
};

type LocationPermissionState = "unknown" | "prompt" | "granted" | "denied" | "unsupported" | "insecure";
type LocationListView = "active" | "inactive";
type EntryStatusFilter = "all" | "valid" | "manual_adjusted" | "pending_approval" | "rejected" | "out_of_range" | "corrected";
type EntryEventFilter = "all" | TimeClockEventType;
type TimeClockReviewTab = "closure" | "mirror" | "log";
type EditingLocationForm = {
  id: number;
  name: string;
  address: string;
  radiusMeters: number;
};

const DEFAULT_LOCATION_NAME = "Unidade principal";
const ENTRY_PAGE_SIZE = 8;
const TIME_CLOCK_REALTIME_INTERVAL_MS = 5_000;
const TIME_CLOCK_SUPPORTING_INTERVAL_MS = 10_000;

const EVENT_LABELS: Record<TimeClockEventType, string> = {
  clock_in: "Entrada",
  break_start: "Pausa",
  break_end: "Retorno",
  clock_out: "Saída",
};

const EVENT_ICONS: Record<TimeClockEventType, typeof LogIn> = {
  clock_in: LogIn,
  break_start: Coffee,
  break_end: Play,
  clock_out: LogOut,
};

const STATE_LABELS: Record<string, { label: string; tone: string }> = {
  closed: { label: "Fora de jornada", tone: "border-slate-200 bg-slate-50 text-slate-700" },
  working: { label: "Em jornada", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  on_break: { label: "Em pausa", tone: "border-amber-200 bg-amber-50 text-amber-700" },
};

const ADJUSTMENT_STATUS_LABELS: Record<TimeClockAdjustmentStatus, { label: string; tone: string }> = {
  pending: { label: "Pendente", tone: "border-amber-200 bg-amber-50 text-amber-700" },
  approved: { label: "Aprovado", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Reprovado", tone: "border-red-200 bg-red-50 text-red-700" },
};

const ENTRY_STATUS_LABELS: Record<TimeClockEntry["status"], { label: string; tone: string }> = {
  valid: { label: "Válido", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  manual_adjusted: { label: "Ajustado", tone: "border-blue-200 bg-blue-50 text-blue-700" },
  corrected: { label: "Corrigido", tone: "border-sky-200 bg-sky-50 text-sky-700" },
  pending_approval: { label: "Pendente", tone: "border-amber-200 bg-amber-50 text-amber-700" },
  rejected: { label: "Reprovado", tone: "border-red-200 bg-red-50 text-red-700" },
  out_of_range: { label: "Fora do raio", tone: "border-red-200 bg-red-50 text-red-700" },
};

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(typeof data?.message === "string" ? data.message : fallback);
  }
  return data as T;
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      reject(new Error("Localização indisponível neste acesso."));
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error("Geolocalização não está disponível neste navegador."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatFullDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const normalizedValue = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00`
    : value;
  const date = normalizedValue instanceof Date ? normalizedValue : new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatMonthLabel(value: string): string {
  const [year, month] = value.split("-").map((part) => Number(part));
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function toDateTimeLocalInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getDateKey(value: string | Date | null | undefined): string {
  if (!value) return "sem-data";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "sem-data";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatMinutes(minutes: number): string {
  const signal = minutes < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(minutes));
  const hours = Math.floor(absolute / 60);
  const mins = absolute % 60;
  return `${signal}${String(hours).padStart(2, "0")}h${String(mins).padStart(2, "0")}`;
}

function formatMeters(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  const meters = Math.round(Number(value));
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")}km`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toCapturedLocation(position: GeolocationPosition): CapturedLocation {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
  };
}

function formatCoordinate(value: number): string {
  return value.toFixed(6).replace(".", ",");
}

export default function PontoEletronico() {
  const [month, setMonth] = useState(toMonthInputValue());
  const [selectedStaffId, setSelectedStaffId] = useState<string>("all");
  const [reviewTab, setReviewTab] = useState<TimeClockReviewTab>("mirror");
  const [focusedEntryId, setFocusedEntryId] = useState<number | null>(null);
  const [focusedAdjustmentId, setFocusedAdjustmentId] = useState<number | null>(null);
  const [locationListView, setLocationListView] = useState<LocationListView>("active");
  const [locationName, setLocationName] = useState(DEFAULT_LOCATION_NAME);
  const [locationCep, setLocationCep] = useState("");
  const [locationNumber, setLocationNumber] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationRadius, setLocationRadius] = useState(200);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryStatusFilter, setEntryStatusFilter] = useState<EntryStatusFilter>("all");
  const [entryEventFilter, setEntryEventFilter] = useState<EntryEventFilter>("all");
  const [entryPage, setEntryPage] = useState(1);
  const [selectedAdjustmentEntryId, setSelectedAdjustmentEntryId] = useState<number | null>(null);
  const [adjustmentEventType, setAdjustmentEventType] = useState<TimeClockEventType>("clock_in");
  const [adjustmentDateTime, setAdjustmentDateTime] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("Esquecimento de marcacao");
  const [adjustmentNotes, setAdjustmentNotes] = useState("");
  const [reviewNotesById, setReviewNotesById] = useState<Record<number, string>>({});
  const [entryReviewNotesById, setEntryReviewNotesById] = useState<Record<number, string>>({});
  const [closureNotes, setClosureNotes] = useState("");
  const [timeClockDraft, setTimeClockDraft] = useState<TimeClockSettings>(DEFAULT_TIME_CLOCK_SETTINGS);
  const [editingLocation, setEditingLocation] = useState<EditingLocationForm | null>(null);
  const [capturedLocation, setCapturedLocation] = useState<CapturedLocation | null>(null);
  const [lastKnownLocation, setLastKnownLocation] = useState<CapturedLocation | null>(null);
  const [locationPermission, setLocationPermission] = useState<LocationPermissionState>("unknown");
  const [isReadingLocation, setIsReadingLocation] = useState(false);
  const [isResolvingLocationName, setIsResolvingLocationName] = useState(false);
  const [isLookingUpCep, setIsLookingUpCep] = useState(false);
  const [isGeocodingAddress, setIsGeocodingAddress] = useState(false);
  const [routeLocation] = useLocation();
  const routeSearch = useSearch();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const latestValidEntryIdRef = useRef<number | null>(null);
  const { play: playNotificationSound } = useNotificationSound();
  const { data: staffMembers = [] } = useStaff();
  const isManager = user?.role === "admin" || user?.role === "administrativo";
  const canConfigureLocations = user?.role === "admin";
  const canConfigureTimeClockRules = user?.role === "admin";
  const { data: environmentSettings } = useEnvironmentSettings({ enabled: isManager });
  const updateEnvironmentSettingsMutation = useUpdateEnvironmentSettings();

  useEffect(() => {
    const params = new URLSearchParams(routeSearch);
    const requestedTab = params.get("tab");
    const requestedMonth = params.get("month");
    const requestedStaffId = Number(params.get("staffId"));
    const requestedEntryId = Number(params.get("entryId"));
    const requestedAdjustmentId = Number(params.get("adjustmentId"));
    const nextFocusedEntryId = Number.isInteger(requestedEntryId) && requestedEntryId > 0 ? requestedEntryId : null;
    const nextFocusedAdjustmentId = Number.isInteger(requestedAdjustmentId) && requestedAdjustmentId > 0 ? requestedAdjustmentId : null;

    if (requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) {
      setMonth(requestedMonth);
    }
    if (isManager && Number.isInteger(requestedStaffId) && requestedStaffId > 0) {
      setSelectedStaffId(String(requestedStaffId));
    }

    setFocusedEntryId(nextFocusedEntryId);
    setFocusedAdjustmentId(nextFocusedAdjustmentId);

    if (nextFocusedEntryId || nextFocusedAdjustmentId) {
      setEntrySearch("");
      setEntryStatusFilter("all");
      setEntryEventFilter("all");
      setReviewTab("log");
      return;
    }

    if (requestedTab === "log" || requestedTab === "mirror" || (requestedTab === "closure" && isManager)) {
      setReviewTab(requestedTab);
      return;
    }

    setReviewTab(isManager ? "closure" : "mirror");
  }, [isManager, routeLocation, routeSearch]);

  const statusQuery = useQuery<TimeClockStatus>({
    queryKey: ["/api/time-clock/status"],
    refetchInterval: TIME_CLOCK_REALTIME_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/time-clock/status", { credentials: "include" });
      return parseJson<TimeClockStatus>(res, "Erro ao carregar ponto.");
    },
  });

  const entriesQuery = useQuery<TimeClockEntriesResponse>({
    queryKey: ["/api/time-clock/entries", month, selectedStaffId],
    refetchInterval: TIME_CLOCK_REALTIME_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () => {
      const params = new URLSearchParams({ month });
      if (isManager && selectedStaffId !== "all") params.set("staffId", selectedStaffId);
      const res = await fetch(`/api/time-clock/entries?${params.toString()}`, { credentials: "include" });
      return parseJson<TimeClockEntriesResponse>(res, "Erro ao carregar banco de horas.");
    },
  });

  const adjustmentsQuery = useQuery<TimeClockAdjustmentRequest[]>({
    queryKey: ["/api/time-clock/adjustments", month, selectedStaffId],
    refetchInterval: TIME_CLOCK_SUPPORTING_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () => {
      const params = new URLSearchParams({ month });
      if (isManager && selectedStaffId !== "all") params.set("staffId", selectedStaffId);
      const res = await fetch(`/api/time-clock/adjustments?${params.toString()}`, { credentials: "include" });
      return parseJson<TimeClockAdjustmentRequest[]>(res, "Erro ao carregar ajustes.");
    },
  });

  const auditQuery = useQuery<TimeClockAuditLog[]>({
    queryKey: ["/api/time-clock/audit", month, selectedStaffId],
    enabled: isManager,
    refetchInterval: TIME_CLOCK_SUPPORTING_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () => {
      const params = new URLSearchParams({ month });
      if (selectedStaffId !== "all") params.set("staffId", selectedStaffId);
      const res = await fetch(`/api/time-clock/audit?${params.toString()}`, { credentials: "include" });
      return parseJson<TimeClockAuditLog[]>(res, "Erro ao carregar auditoria.");
    },
  });

  const locations = statusQuery.data?.locations ?? [];
  const activeLocations = locations.filter((location) => location.active !== false);
  const inactiveLocations = locations.filter((location) => location.active === false);
  const visibleLocations = locationListView === "active" ? activeLocations : inactiveLocations;
  const currentState = statusQuery.data?.current.state ?? "closed";
  const nextActions = statusQuery.data?.current.nextActions ?? [];
  const monthSummary = entriesQuery.data?.monthSummary ?? {
    expectedMinutes: 0,
    workedMinutes: 0,
    balanceMinutes: 0,
    incompleteDays: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    nightMinutes: 0,
    absences: 0,
  };
  const dailySummaries = entriesQuery.data?.dailySummaries ?? [];
  const entries = entriesQuery.data?.entries ?? [];
  const closure = entriesQuery.data?.closure ?? null;
  const monthIsClosed = closure?.status === "closed";
  const adjustments = adjustmentsQuery.data ?? [];
  const pendingAdjustments = adjustments.filter((item) => item.status === "pending");
  const recentAuditLogs = auditQuery.data ?? [];
  const timeClockSettings = entriesQuery.data?.settings ?? environmentSettings?.timeClock ?? DEFAULT_TIME_CLOCK_SETTINGS;
  const filteredEntries = useMemo(() => {
    const normalizedSearch = entrySearch.trim().toLowerCase();
    return entries.filter((entry) => {
      if (entryStatusFilter !== "all" && entry.status !== entryStatusFilter) return false;
      if (entryEventFilter !== "all" && entry.eventType !== entryEventFilter) return false;
      if (!normalizedSearch) return true;
      return [
        entry.staffName,
        entry.locationName,
        entry.locationAddress,
        EVENT_LABELS[entry.eventType],
        formatDateTime(entry.eventTime),
      ].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch));
    });
  }, [entries, entryEventFilter, entrySearch, entryStatusFilter]);
  const entryAuditGroups = useMemo(() => {
    const groups = new Map<string, { key: string; date: string; staffName: string; entries: TimeClockEntry[] }>();
    filteredEntries.forEach((entry) => {
      const date = getDateKey(entry.eventTime);
      const key = `${date}:${entry.staffId}`;
      const group = groups.get(key) ?? {
        key,
        date,
        staffName: entry.staffName ?? "Sem colaborador",
        entries: [],
      };
      group.entries.push(entry);
      groups.set(key, group);
    });
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        entries: group.entries
          .slice()
          .sort((left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime()),
      }))
      .sort((left, right) => {
        if (left.date !== right.date) return right.date.localeCompare(left.date);
        return left.staffName.localeCompare(right.staffName, "pt-BR");
      });
  }, [filteredEntries]);
  const entryPageCount = Math.max(1, Math.ceil(entryAuditGroups.length / ENTRY_PAGE_SIZE));
  const currentEntryPage = Math.min(entryPage, entryPageCount);
  const paginatedEntryGroups = entryAuditGroups.slice(
    (currentEntryPage - 1) * ENTRY_PAGE_SIZE,
    currentEntryPage * ENTRY_PAGE_SIZE,
  );

  useEffect(() => {
    if (!focusedEntryId) return;
    const focusedGroupIndex = entryAuditGroups.findIndex((group) =>
      group.entries.some((entry) => entry.id === focusedEntryId),
    );
    if (focusedGroupIndex < 0) return;
    setEntryPage(Math.floor(focusedGroupIndex / ENTRY_PAGE_SIZE) + 1);
  }, [entryAuditGroups, focusedEntryId]);

  useEffect(() => {
    if (!focusedEntryId) return;
    const handle = window.setTimeout(() => {
      const target = document.getElementById(`time-clock-pending-entry-${focusedEntryId}`)
        ?? document.getElementById(`time-clock-entry-${focusedEntryId}`);
      target?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [currentEntryPage, entries.length, focusedEntryId]);

  useEffect(() => {
    if (!focusedAdjustmentId) return;
    const handle = window.setTimeout(() => {
      document.getElementById(`time-clock-adjustment-${focusedAdjustmentId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [adjustments, focusedAdjustmentId]);

  const validEntries = entries.filter((entry) => entry.status === "valid" || entry.status === "manual_adjusted");
  const adjustableEntries = entries
    .filter((entry) => entry.status !== "out_of_range")
    .slice()
    .sort((left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime())
    .slice(0, 8);
  const selectedAdjustmentEntry = selectedAdjustmentEntryId
    ? entries.find((entry) => entry.id === selectedAdjustmentEntryId) ?? null
    : null;
  const pendingApprovalEntries = entries.filter((entry) => entry.status === "pending_approval");
  const outOfRangeAttempts = recentAuditLogs.filter((log) => log.action === "out_of_range_attempt");

  useEffect(() => {
    latestValidEntryIdRef.current = null;
    setSelectedAdjustmentEntryId(null);
  }, [month, selectedStaffId]);

  useEffect(() => {
    if (!isManager || !entriesQuery.data) return;

    const latestValidEntry = entriesQuery.data.entries.reduce<TimeClockEntry | null>((latest, entry) => {
      const canNotify = entry.status === "valid" || entry.status === "manual_adjusted";
      if (!canNotify) return latest;
      if (!latest || entry.id > latest.id) return entry;
      return latest;
    }, null);
    const latestValidEntryId = latestValidEntry?.id ?? null;
    const previousValidEntryId = latestValidEntryIdRef.current;
    latestValidEntryIdRef.current = latestValidEntryId;

    if (
      previousValidEntryId !== null
      && latestValidEntryId !== null
      && latestValidEntryId > previousValidEntryId
    ) {
      playNotificationSound();
    }
  }, [entriesQuery.data, isManager, playNotificationSound]);

  const hasBlockingIncompleteDays = timeClockSettings.blockCloseWithIncompleteDays && monthSummary.incompleteDays > 0;
  const hasBlockingAbsences = timeClockSettings.blockCloseWithAbsences && monthSummary.absences > 0;
  const hasBlockingOutOfRangeAttempts = timeClockSettings.blockCloseWithOutOfRangeAttempts && outOfRangeAttempts.length > 0;
  const canCloseMonth = isManager
    && !monthIsClosed
    && pendingAdjustments.length === 0
    && pendingApprovalEntries.length === 0
    && dailySummaries.length > 0
    && !hasBlockingIncompleteDays
    && !hasBlockingAbsences
    && !hasBlockingOutOfRangeAttempts;
  const closureStatusView = monthIsClosed
    ? {
      label: "Competência fechada",
      description: `Fechada em ${formatDateTime(closure?.closedAt)}`,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    }
    : {
      label: "Competência aberta",
      description: pendingAdjustments.length > 0
        ? "Ajustes pendentes bloqueiam o fechamento."
        : dailySummaries.length === 0
          ? "Sem registros para fechamento neste mês."
          : "Espelho disponível para revisão.",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
    };
  const closureChecks = [
    {
      label: "Ajustes pendentes",
      value: pendingAdjustments.length,
      ok: pendingAdjustments.length === 0,
    },
    {
      label: "Batidas sem escala",
      value: pendingApprovalEntries.length,
      ok: pendingApprovalEntries.length === 0,
    },
    {
      label: "Jornadas incompletas",
      value: monthSummary.incompleteDays,
      ok: !hasBlockingIncompleteDays,
    },
    {
      label: "Faltas",
      value: monthSummary.absences,
      ok: !hasBlockingAbsences,
    },
    {
      label: "Tentativas fora do raio",
      value: outOfRangeAttempts.length,
      ok: !hasBlockingOutOfRangeAttempts,
    },
  ];
  const activeStaffCount = staffMembers.filter((member: any) => member.active !== false).length;
  const staffWithEntriesCount = new Set(entries.map((entry) => entry.staffId)).size;
  const [now, setNow] = useState(new Date());
  const isLookingUpLocation = isReadingLocation || isResolvingLocationName || isLookingUpCep || isGeocodingAddress;
  const permissionView = {
    unknown: {
      label: "Verificando localização",
      description: "Status do GPS ainda não identificado.",
      tone: "border-slate-200 bg-slate-50 text-slate-700",
    },
    prompt: {
      label: "Localização pendente",
      description: "Ative a permissão antes de registrar o ponto.",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
    },
    granted: {
      label: "Localização ativa",
      description: lastKnownLocation
        ? `${formatCoordinate(lastKnownLocation.latitude)}, ${formatCoordinate(lastKnownLocation.longitude)}`
        : "Permissao concedida para este navegador.",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    denied: {
      label: "Localização bloqueada",
      description: "Libere a permissão de localização nas configurações do navegador.",
      tone: "border-red-200 bg-red-50 text-red-700",
    },
    unsupported: {
      label: "Localização indisponível",
      description: "Este navegador não liberou o recurso de geolocalização.",
      tone: "border-red-200 bg-red-50 text-red-700",
    },
    insecure: {
      label: "Localização indisponível",
      description: "Abra a pagina por um link seguro para ativar o GPS.",
      tone: "border-red-200 bg-red-50 text-red-700",
    },
  }[locationPermission];
  const todayVisibleEntries = useMemo(
    () => (statusQuery.data?.todayEntries ?? []).filter((entry) => entry.status !== "out_of_range"),
    [statusQuery.data?.todayEntries],
  );
  const todayPendingApprovalEntries = todayVisibleEntries.filter((entry) => entry.status === "pending_approval");
  const nextActionText = nextActions.length > 0
    ? nextActions.map((action) => EVENT_LABELS[action]).join(" ou ")
    : statusQuery.data?.current.message ?? "Sem ação pendente";
  const timeClockAlerts = useMemo(() => {
    const alerts: Array<{ title: string; description: string; tone: string }> = [];
    if (isManager) {
      if (pendingApprovalEntries.length > 0) {
        alerts.push({
          title: "Batidas sem escala aguardando aprovação",
          description: `${pendingApprovalEntries.length} batida(s) precisam ser aprovadas ou reprovadas para entrar no fechamento.`,
          tone: "border-amber-200 bg-amber-50 text-amber-800",
        });
      }
      if (pendingAdjustments.length > 0) {
        alerts.push({
          title: "Ajustes de ponto pendentes",
          description: `${pendingAdjustments.length} solicitação(oes) aguardando revisão do gestor.`,
          tone: "border-amber-200 bg-amber-50 text-amber-800",
        });
      }
      if (monthSummary.incompleteDays > 0) {
        alerts.push({
          title: "Jornadas incompletas no período",
          description: `${monthSummary.incompleteDays} jornada(s) sem fechamento completo no espelho.`,
          tone: "border-red-200 bg-red-50 text-red-700",
        });
      }
      if (monthSummary.absences > 0) {
        alerts.push({
          title: "Faltas identificadas",
          description: `${monthSummary.absences} falta(s) aparecem no fechamento do período.`,
          tone: "border-red-200 bg-red-50 text-red-700",
        });
      }
      if (outOfRangeAttempts.length > 0) {
        alerts.push({
          title: "Tentativas fora do raio",
          description: `${outOfRangeAttempts.length} tentativa(s) bloqueadas apareceram na auditoria.`,
          tone: "border-red-200 bg-red-50 text-red-700",
        });
      }
      return alerts;
    }

    if (monthIsClosed) {
      alerts.push({
        title: "Competência fechada",
        description: "Novas batidas e solicitações ficam bloqueadas até reabertura do mês.",
        tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      });
    }
    if (statusQuery.data?.hasShiftToday === false) {
      alerts.push({
        title: "Sem escala prevista hoje",
        description: "Batidas feitas sem escala ficam pendentes até aprovação do admin.",
        tone: "border-amber-200 bg-amber-50 text-amber-800",
      });
    }
    if (todayPendingApprovalEntries.length > 0) {
      alerts.push({
        title: "Batida aguardando aprovação",
        description: `${todayPendingApprovalEntries.length} batida(s) de hoje ainda não contam no banco de horas.`,
        tone: "border-amber-200 bg-amber-50 text-amber-800",
      });
    }
    if (currentState === "working" || currentState === "on_break") {
      alerts.push({
        title: currentState === "on_break" ? "Pausa aberta" : "Jornada aberta",
        description: "Finalize a proxima marcacao para manter o espelho de ponto correto.",
        tone: "border-blue-200 bg-blue-50 text-blue-700",
      });
    }
    return alerts;
  }, [
    currentState,
    isManager,
    monthIsClosed,
    monthSummary.absences,
    monthSummary.incompleteDays,
    outOfRangeAttempts.length,
    pendingAdjustments.length,
    pendingApprovalEntries.length,
    statusQuery.data?.hasShiftToday,
    todayPendingApprovalEntries.length,
  ]);

  useEffect(() => {
    setTimeClockDraft(timeClockSettings);
  }, [
    timeClockSettings.lateToleranceMinutes,
    timeClockSettings.overtimeToleranceMinutes,
    timeClockSettings.breakDurationMinutes,
    timeClockSettings.breakReminderBeforeMinutes,
    timeClockSettings.nightStartTime,
    timeClockSettings.nightEndTime,
    timeClockSettings.blockCloseWithIncompleteDays,
    timeClockSettings.blockCloseWithAbsences,
    timeClockSettings.blockCloseWithOutOfRangeAttempts,
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setLocationPermission("insecure");
      return;
    }
    if (!navigator.geolocation) {
      setLocationPermission("unsupported");
      return;
    }
    if (!navigator.permissions?.query) {
      setLocationPermission("prompt");
      return;
    }

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((permission) => {
        const updatePermission = () => {
          if (!cancelled) setLocationPermission(permission.state as LocationPermissionState);
        };
        updatePermission();
        permission.onchange = updatePermission;
      })
      .catch(() => {
        if (!cancelled) setLocationPermission("prompt");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setEntryPage(1);
  }, [entryEventFilter, entrySearch, entryStatusFilter, month, selectedStaffId]);

  useEffect(() => {
    if (!canConfigureLocations) return;
    const normalizedCep = locationCep.replace(/\D/g, "");
    if (normalizedCep.length !== 8) return;

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setIsLookingUpCep(true);
      try {
        const params = new URLSearchParams({ cep: normalizedCep });
        if (locationNumber.trim()) params.set("number", locationNumber.trim());
        const res = await fetch(`/api/time-clock/lookup-cep?${params.toString()}`, {
          credentials: "include",
        });
        const data = await parseJson<CepLookupResponse>(res, "CEP não encontrado.");
        if (cancelled) return;
        setLocationAddress(data.address);
        if (typeof data.latitude === "number" && typeof data.longitude === "number") {
          setCapturedLocation({
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: null,
            label: data.address,
          });
        } else {
          setCapturedLocation(null);
        }
        if (data.street) {
          setLocationName((current) =>
            !current.trim() || current === "Unidade principal" ? data.street ?? current : current,
          );
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "CEP não encontrado.";
          toast({ variant: "destructive", title: message });
        }
      } finally {
        if (!cancelled) setIsLookingUpCep(false);
      }
    }, 550);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [canConfigureLocations, locationCep, locationNumber, toast]);

  const punchMutation = useMutation({
    mutationFn: async ({ eventType, position }: { eventType: TimeClockEventType; position: GeolocationPosition }) => {
      const res = await fetch("/api/time-clock/punch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      });
      return parseJson<{ message?: string }>(res, "Erro ao registrar ponto.");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/entries"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: data.message || "Ponto registrado" });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/entries"] });
      toast({ variant: "destructive", title: error.message });
    },
  });

  const createLocationMutation = useMutation({
    mutationFn: async ({
      location,
      name,
      address,
      radiusMeters,
    }: {
      location: CapturedLocation;
      name: string;
      address: string;
      radiusMeters: number;
    }) => {
      const res = await fetch("/api/time-clock/locations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Local autorizado",
          address: address.trim() || null,
          latitude: location.latitude,
          longitude: location.longitude,
          radiusMeters,
          active: true,
        }),
      });
      return parseJson(res, "Erro ao salvar local autorizado.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/status"] });
      toast({ title: "Local autorizado salvo" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const updateLocationStatusMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await fetch(`/api/time-clock/locations/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      return parseJson<TimeClockLocation>(res, "Erro ao atualizar local autorizado.");
    },
    onSuccess: (location) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/status"] });
      toast({ title: location.active === false ? "Local removido" : "Local reativado" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const updateLocationMutation = useMutation({
    mutationFn: async (location: EditingLocationForm) => {
      const res = await fetch(`/api/time-clock/locations/${location.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: location.name.trim(),
          address: location.address.trim() || null,
          radiusMeters: location.radiusMeters,
        }),
      });
      return parseJson<TimeClockLocation>(res, "Erro ao salvar local autorizado.");
    },
    onSuccess: () => {
      setEditingLocation(null);
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/status"] });
      toast({ title: "Local atualizado" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const createAdjustmentMutation = useMutation({
    mutationFn: async () => {
      if (!adjustmentDateTime) throw new Error("Informe data e horário do ajuste.");
      const res = await fetch("/api/time-clock/adjustments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: isManager && selectedStaffId !== "all" ? Number(selectedStaffId) : undefined,
          entryId: selectedAdjustmentEntryId,
          eventType: adjustmentEventType,
          requestedEventTime: new Date(adjustmentDateTime).toISOString(),
          reason: adjustmentReason,
          notes: adjustmentNotes.trim() || null,
        }),
      });
      return parseJson<TimeClockAdjustmentRequest>(res, "Erro ao solicitar ajuste.");
    },
    onSuccess: () => {
      setSelectedAdjustmentEntryId(null);
      setAdjustmentNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/audit"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "Solicitação enviada" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const reviewAdjustmentMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: TimeClockAdjustmentStatus }) => {
      const res = await fetch(`/api/time-clock/adjustments/${id}/review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reviewerNotes: reviewNotesById[id]?.trim() || null,
        }),
      });
      return parseJson<TimeClockAdjustmentRequest>(res, "Erro ao revisar ajuste.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/audit"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "Ajuste revisado" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const reviewEntryMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "approved" | "rejected" }) => {
      const res = await fetch(`/api/time-clock/entries/${id}/review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reviewerNotes: entryReviewNotesById[id]?.trim() || null,
        }),
      });
      return parseJson<TimeClockEntry>(res, "Erro ao revisar batida.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/audit"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "Batida revisada" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const closureMutation = useMutation({
    mutationFn: async (action: "close" | "reopen") => {
      const res = await fetch("/api/time-clock/closures", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          action,
          notes: closureNotes.trim() || null,
        }),
      });
      return parseJson<TimeClockClosure>(res, "Erro ao atualizar fechamento.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/audit"] });
      toast({ title: "Fechamento atualizado" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  async function reverseGeocodeLocation(location: CapturedLocation): Promise<ReverseGeocodeResponse | null> {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
    });
    const res = await fetch(`/api/time-clock/reverse-geocode?${params.toString()}`, {
      credentials: "include",
    });
    return parseJson<ReverseGeocodeResponse>(res, "Não foi possível identificar o local.");
  }

  async function geocodeAddressLocation(): Promise<GeocodeAddressResponse> {
    const params = new URLSearchParams();
    if (locationAddress.trim()) params.set("address", locationAddress.trim());
    if (locationCep.trim()) params.set("cep", locationCep.trim());
    if (locationNumber.trim()) params.set("number", locationNumber.trim());
    const res = await fetch(`/api/time-clock/geocode-address?${params.toString()}`, {
      credentials: "include",
    });
    return parseJson<GeocodeAddressResponse>(res, "Não foi possível localizar este endereço.");
  }

  async function resolveAddressLocationFromForm(): Promise<{ location: CapturedLocation; address: string; name: string }> {
    if (!locationAddress.trim() && !locationCep.trim()) {
      throw new Error("Informe um endereço ou CEP.");
    }
    const result = await geocodeAddressLocation();
    const currentName = locationName.trim();
    const hasCustomName = Boolean(currentName && currentName !== DEFAULT_LOCATION_NAME);
    const resolvedAddress = result.address || result.displayName || locationAddress;
    const suggestedName = result.name || result.displayName || "";
    const resolvedName = hasCustomName
      ? currentName
      : suggestedName || currentName || DEFAULT_LOCATION_NAME;
    const location = {
      latitude: result.latitude,
      longitude: result.longitude,
      accuracy: null,
      label: resolvedAddress || resolvedName,
    };
    setCapturedLocation(location);
    if (resolvedAddress) setLocationAddress(resolvedAddress);
    if (!hasCustomName && suggestedName) {
      setLocationName(resolvedName);
    }
    return { location, address: resolvedAddress, name: resolvedName };
  }

  async function withPosition(callback: (position: GeolocationPosition) => void | Promise<void>) {
    setIsReadingLocation(true);
    try {
      const position = await getCurrentPosition();
      setLocationPermission("granted");
      setLastKnownLocation(toCapturedLocation(position));
      await callback(position);
    } catch (error) {
      const positionError = error as GeolocationPositionError;
      if (positionError?.code === 1) {
        setLocationPermission("denied");
      } else if (error instanceof Error && error.message.includes("indisponível neste acesso")) {
        setLocationPermission("insecure");
      }
      const message = error instanceof Error ? error.message : "Não foi possível obter a localização.";
      toast({ variant: "destructive", title: message });
    } finally {
      setIsReadingLocation(false);
    }
  }

  const handlePunch = (eventType: TimeClockEventType) => {
    withPosition((position) => punchMutation.mutate({ eventType, position }));
  };

  const handleEnableLocation = () => {
    withPosition(() => {
      toast({ title: "Localização ativada" });
    });
  };

  const startEditingLocation = (location: TimeClockLocation) => {
    setEditingLocation({
      id: location.id,
      name: location.name,
      address: location.address ?? "",
      radiusMeters: location.radiusMeters,
    });
  };

  const handleFindLocation = () => {
    withPosition(async (position) => {
      const location = toCapturedLocation(position);
      setCapturedLocation(location);
      setIsResolvingLocationName(true);
      try {
        const result = await reverseGeocodeLocation(location);
        const suggestedName = result?.name || result?.displayName;
        const suggestedAddress = result?.address || result?.displayName;
        const nextLocation = { ...location, label: suggestedAddress ?? result?.name ?? null };
        setCapturedLocation(nextLocation);
        const currentName = locationName.trim();
        const hasCustomName = Boolean(currentName && currentName !== DEFAULT_LOCATION_NAME);
        if (suggestedName && !hasCustomName) {
          setLocationName(suggestedName);
        }
        if (suggestedAddress) {
          setLocationAddress(suggestedAddress);
          toast({ title: "Endereço encontrado" });
        } else if (suggestedName) {
          toast({ title: "Local encontrado" });
        } else {
          toast({ title: "Coordenada capturada" });
        }
      } catch {
        toast({ title: "Coordenada capturada" });
      } finally {
        setIsResolvingLocationName(false);
      }
    });
  };

  const handleFindAddressLocation = async () => {
    setIsGeocodingAddress(true);
    try {
      await resolveAddressLocationFromForm();
      toast({ title: "Endereço localizado" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível localizar este endereço.";
      toast({ variant: "destructive", title: message });
    } finally {
      setIsGeocodingAddress(false);
    }
  };

  const handleSaveLocation = async () => {
    if (capturedLocation) {
      createLocationMutation.mutate({
        location: capturedLocation,
        name: locationName,
        address: locationAddress,
        radiusMeters: locationRadius,
      });
      return;
    }

    if (locationAddress.trim() || locationCep.trim()) {
      setIsGeocodingAddress(true);
      try {
        const resolved = await resolveAddressLocationFromForm();
        createLocationMutation.mutate({
          location: resolved.location,
          name: resolved.name,
          address: resolved.address,
          radiusMeters: locationRadius,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível localizar este endereço.";
        toast({ variant: "destructive", title: message });
      } finally {
        setIsGeocodingAddress(false);
      }
      return;
    }

    withPosition((position) => {
      const location = toCapturedLocation(position);
      setCapturedLocation(location);
      createLocationMutation.mutate({
        location,
        name: locationName,
        address: locationAddress,
        radiusMeters: locationRadius,
      });
    });
  };

  const updateTimeClockDraft = <Key extends keyof TimeClockSettings>(
    key: Key,
    value: TimeClockSettings[Key],
  ) => {
    setTimeClockDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSaveTimeClockRules = () => {
    if (!canConfigureTimeClockRules) return;
    const baseSettings = environmentSettings ?? DEFAULT_ENVIRONMENT_SETTINGS;
    const nextSettings = normalizeEnvironmentSettings({
      ...baseSettings,
      timeClock: timeClockDraft,
    });
    updateEnvironmentSettingsMutation.mutate(nextSettings, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/time-clock/entries"] });
      },
    });
  };

  const startNewAdjustmentRequest = () => {
    setSelectedAdjustmentEntryId(null);
    setAdjustmentEventType("clock_in");
    setAdjustmentDateTime("");
    setAdjustmentReason("Esquecimento de marcacao");
    setAdjustmentNotes("");
  };

  const startEntryCorrectionRequest = (entry: TimeClockEntry) => {
    setSelectedAdjustmentEntryId(entry.id);
    setAdjustmentEventType(entry.eventType);
    setAdjustmentDateTime(toDateTimeLocalInputValue(entry.eventTime));
    setAdjustmentReason("Correção de batida registrada");
    setAdjustmentNotes((current) => current.trim() || `Batida original: ${EVENT_LABELS[entry.eventType]} em ${formatDateTime(entry.eventTime)}.`);
  };

  const renderDailySummaryStatus = (summary: DailySummary) => {
    if (summary.absence) {
      return (
        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
          <AlertCircle className="mr-1 h-3 w-3" />
          Falta
        </Badge>
      );
    }
    if (summary.incomplete) {
      return (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
          <AlertCircle className="mr-1 h-3 w-3" />
          Incompleto
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Completo
      </Badge>
    );
  };

  const exportMirrorCsv = () => {
    const selectedStaff = selectedStaffId === "all"
      ? "todos"
      : staffMembers.find((member: any) => String(member.id) === selectedStaffId)?.name ?? selectedStaffId;
    const closureLabel = monthIsClosed ? "Fechado" : "Aberto - previa";
    const generatedAt = new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const rows: Array<unknown[] | string> = [
      ["ESPELHO DE PONTO EASYCARE"],
      ["Empresa", user?.organizationName ?? ""],
      ["Mes", month],
      ["Colaborador", selectedStaffId === "all" ? "Todos" : selectedStaff],
      ["Status do fechamento", closureLabel],
      ["Gerado em", generatedAt],
      [],
      ["REGRAS USADAS NO CALCULO"],
      ["Tolerancia de atraso", formatMinutes(timeClockSettings.lateToleranceMinutes)],
      ["Tolerancia de hora extra", formatMinutes(timeClockSettings.overtimeToleranceMinutes)],
      ["Duracao padrao da pausa", formatMinutes(timeClockSettings.breakDurationMinutes)],
      ["Aviso antes do fim da pausa", formatMinutes(timeClockSettings.breakReminderBeforeMinutes)],
      ["Adicional noturno", `${timeClockSettings.nightStartTime} até ${timeClockSettings.nightEndTime}`],
      ["Bloqueia fechamento com jornadas incompletas", timeClockSettings.blockCloseWithIncompleteDays ? "Sim" : "Não"],
      ["Bloqueia fechamento com faltas", timeClockSettings.blockCloseWithAbsences ? "Sim" : "Não"],
      ["Bloqueia fechamento com tentativa fora do raio", timeClockSettings.blockCloseWithOutOfRangeAttempts ? "Sim" : "Não"],
      [],
      ["RESUMO DO PERIODO"],
      ["Previsto", formatMinutes(monthSummary.expectedMinutes)],
      ["Realizado", formatMinutes(monthSummary.workedMinutes)],
      ["Saldo", formatMinutes(monthSummary.balanceMinutes)],
      ["Atraso", formatMinutes(monthSummary.lateMinutes)],
      ["Hora extra", formatMinutes(monthSummary.overtimeMinutes)],
      ["Adicional noturno", formatMinutes(monthSummary.nightMinutes)],
      ["Faltas", monthSummary.absences],
      ["Jornadas incompletas", monthSummary.incompleteDays],
      ["Ajustes pendentes", pendingAdjustments.length],
      ["Batidas sem escala pendentes", pendingApprovalEntries.length],
      ["Tentativas fora do raio", outOfRangeAttempts.length],
      [],
      ["ESPELHO DIARIO"],
      [
        "Dia",
        "Colaborador",
        "Previsto",
        "Realizado",
        "Saldo",
        "Atraso",
        "Hora extra",
        "Adicional noturno",
        "Falta",
        "Incompleto",
        "Primeira entrada",
        "Última saída",
      ],
      ...dailySummaries.map((summary) => [
        formatDate(summary.date),
        summary.staffName ?? "",
        formatMinutes(summary.expectedMinutes),
        formatMinutes(summary.workedMinutes),
        formatMinutes(summary.balanceMinutes),
        formatMinutes(summary.lateMinutes ?? 0),
        formatMinutes(summary.overtimeMinutes ?? 0),
        formatMinutes(summary.nightMinutes ?? 0),
        summary.absence ? "Sim" : "Não",
        summary.incomplete ? "Sim" : "Não",
        formatDateTime(summary.firstClockIn),
        formatDateTime(summary.lastClockOut),
      ]),
      [],
      ["BATIDAS SEM ESCALA PENDENTES"],
      ["Data/Hora", "Colaborador", "Evento", "Local", "Distância", "Observação"],
      ...pendingApprovalEntries.map((entry) => [
        formatDateTime(entry.eventTime),
        entry.staffName ?? "",
        EVENT_LABELS[entry.eventType],
        entry.locationName ?? "",
        formatMeters(entry.distanceMeters),
        entry.notes ?? "",
      ]),
      [],
      ["LOG DE BATIDAS"],
      ["Data/Hora", "Colaborador", "Evento", "Status", "Local", "Endereço", "Distância", "Observação"],
      ...entries.map((entry) => [
        formatDateTime(entry.eventTime),
        entry.staffName ?? "",
        EVENT_LABELS[entry.eventType],
        ENTRY_STATUS_LABELS[entry.status]?.label ?? entry.status,
        entry.locationName ?? "",
        entry.locationAddress ?? "",
        formatMeters(entry.distanceMeters),
        entry.notes ?? "",
      ]),
    ];
    downloadCsvRows(
      `espelho-ponto-${month}-${String(selectedStaff).replace(/\s+/g, "-").toLowerCase()}.csv`,
      rows,
    );
  };

  const exportMirrorPdf = () => {
    if (dailySummaries.length === 0 && entries.length === 0) {
      toast({
        variant: "destructive",
        title: "Sem dados para exportar",
        description: "Selecione uma competência com batidas ou espelho mensal.",
      });
      return;
    }

    const selectedStaff = selectedStaffId === "all"
      ? "Todos"
      : staffMembers.find((member: any) => String(member.id) === selectedStaffId)?.name ?? selectedStaffId;
    const closureLabel = monthIsClosed ? "Fechado" : "Aberto - previa";
    const generatedAt = new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const reportMonth = formatMonthLabel(month);
    const sortedDailySummaries = dailySummaries
      .slice()
      .sort((left, right) => {
        if (left.date !== right.date) return left.date.localeCompare(right.date);
        return String(left.staffName ?? "").localeCompare(String(right.staffName ?? ""), "pt-BR");
      });
    const sortedEntries = entries
      .slice()
      .sort((left, right) => new Date(left.eventTime).getTime() - new Date(right.eventTime).getTime());
    const sortedPendingAdjustments = pendingAdjustments
      .slice()
      .sort((left, right) => new Date(left.createdAt ?? left.requestedEventTime).getTime() - new Date(right.createdAt ?? right.requestedEventTime).getTime());

    const summaryCards = [
      { label: "Previsto", value: formatMinutes(monthSummary.expectedMinutes), detail: "Jornada prevista" },
      { label: "Realizado", value: formatMinutes(monthSummary.workedMinutes), detail: "Horas trabalhadas" },
      {
        label: "Saldo",
        value: formatMinutes(monthSummary.balanceMinutes),
        detail: monthSummary.balanceMinutes < 0 ? "Debito no período" : "Credito no período",
        tone: monthSummary.balanceMinutes < 0 ? "negative" : monthSummary.balanceMinutes > 0 ? "positive" : "neutral",
      },
      { label: "Atraso", value: formatMinutes(monthSummary.lateMinutes), detail: "Alem da tolerancia" },
      { label: "Hora extra", value: formatMinutes(monthSummary.overtimeMinutes), detail: "Aguardando fechamento" },
      { label: "Adic. noturno", value: formatMinutes(monthSummary.nightMinutes), detail: `${timeClockSettings.nightStartTime} até ${timeClockSettings.nightEndTime}` },
      { label: "Faltas", value: monthSummary.absences, detail: "Dias sem registro" },
      { label: "Incompletas", value: monthSummary.incompleteDays, detail: "Jornadas sem saída" },
    ];

    const summaryCardsHtml = summaryCards.map((item) => `
      <div class="kpi ${item.tone ?? "neutral"}">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </div>
    `).join("");

    const dailyRowsHtml = sortedDailySummaries.length === 0
      ? `<tr><td colspan="12" class="empty">Nenhum espelho diário encontrado para a competência.</td></tr>`
      : sortedDailySummaries.map((summary) => {
        const status = [
          summary.absence ? "Falta" : null,
          summary.incomplete ? "Incompleto" : null,
          summary.lateMinutes > 0 ? "Atraso" : null,
        ].filter(Boolean).join(", ") || "OK";

        return `
          <tr>
            <td>${escapeHtml(formatFullDate(summary.date))}</td>
            <td>${escapeHtml(summary.staffName ?? "-")}</td>
            <td class="num">${escapeHtml(summary.expectedStart ?? "-")}</td>
            <td class="num">${escapeHtml(summary.expectedEnd ?? "-")}</td>
            <td class="num">${escapeHtml(formatMinutes(summary.expectedMinutes))}</td>
            <td class="num">${escapeHtml(formatMinutes(summary.workedMinutes))}</td>
            <td class="num ${summary.balanceMinutes < 0 ? "negative-text" : summary.balanceMinutes > 0 ? "positive-text" : ""}">${escapeHtml(formatMinutes(summary.balanceMinutes))}</td>
            <td class="num">${escapeHtml(formatMinutes(summary.lateMinutes ?? 0))}</td>
            <td class="num">${escapeHtml(formatMinutes(summary.overtimeMinutes ?? 0))}</td>
            <td class="num">${escapeHtml(formatMinutes(summary.nightMinutes ?? 0))}</td>
            <td class="num">${escapeHtml(formatTime(summary.firstClockIn))} / ${escapeHtml(formatTime(summary.lastClockOut))}</td>
            <td>${escapeHtml(status)}</td>
          </tr>
        `;
      }).join("");

    const pendingRowsHtml = pendingApprovalEntries.length === 0
      ? `<tr><td colspan="6" class="empty">Nenhuma batida sem escala pendente.</td></tr>`
      : pendingApprovalEntries.map((entry) => `
          <tr>
            <td>${escapeHtml(formatDateTime(entry.eventTime))}</td>
            <td>${escapeHtml(entry.staffName ?? "-")}</td>
            <td>${escapeHtml(EVENT_LABELS[entry.eventType])}</td>
            <td>${escapeHtml(entry.locationName ?? "-")}</td>
            <td class="num">${escapeHtml(formatMeters(entry.distanceMeters))}</td>
            <td>${escapeHtml(entry.notes ?? "-")}</td>
          </tr>
        `).join("");

    const adjustmentRowsHtml = sortedPendingAdjustments.length === 0
      ? `<tr><td colspan="5" class="empty">Nenhuma solicitação de ajuste pendente.</td></tr>`
      : sortedPendingAdjustments.map((item) => `
          <tr>
            <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
            <td>${escapeHtml(item.staffName ?? "-")}</td>
            <td>${escapeHtml(EVENT_LABELS[item.eventType])}</td>
            <td>${escapeHtml(formatDateTime(item.requestedEventTime))}</td>
            <td>${escapeHtml(item.reason)}</td>
          </tr>
        `).join("");

    const entryRowsHtml = sortedEntries.length === 0
      ? `<tr><td colspan="8" class="empty">Nenhuma batida registrada no período.</td></tr>`
      : sortedEntries.map((entry) => `
          <tr>
            <td>${escapeHtml(formatDateTime(entry.eventTime))}</td>
            <td>${escapeHtml(entry.staffName ?? "-")}</td>
            <td>${escapeHtml(EVENT_LABELS[entry.eventType])}</td>
            <td>${escapeHtml(ENTRY_STATUS_LABELS[entry.status]?.label ?? entry.status)}</td>
            <td>${escapeHtml(entry.locationName ?? "-")}</td>
            <td>${escapeHtml(entry.locationAddress ?? "-")}</td>
            <td class="num">${escapeHtml(formatMeters(entry.distanceMeters))}</td>
            <td>${escapeHtml(entry.notes ?? "-")}</td>
          </tr>
        `).join("");

    const outOfRangeRowsHtml = outOfRangeAttempts.length === 0
      ? `<tr><td colspan="4" class="empty">Nenhuma tentativa bloqueada por distância na competência.</td></tr>`
      : outOfRangeAttempts.map((log) => `
          <tr>
            <td>${escapeHtml(formatDateTime(log.createdAt))}</td>
            <td>${escapeHtml(log.staffName ?? "-")}</td>
            <td>${escapeHtml(log.performedByName ?? "-")}</td>
            <td>${escapeHtml(log.reason ?? "-")}</td>
          </tr>
        `).join("");

    const printed = printHtmlDocument(`
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Espelho de Ponto - ${escapeHtml(reportMonth)}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #f1f5f9;
        color: #0f172a;
        font-family: Arial, Helvetica, sans-serif;
      }
      .toolbar {
        align-items: center;
        background: #0f172a;
        color: #fff;
        display: flex;
        justify-content: space-between;
        padding: 12px 24px;
      }
      .toolbar button {
        background: #2563eb;
        border: 0;
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        font-weight: 700;
        padding: 10px 14px;
      }
      .page { padding: 24px; }
      .sheet {
        background: #fff;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
        padding: 24px;
      }
      .header {
        align-items: flex-start;
        border-bottom: 2px solid #0f172a;
        display: flex;
        gap: 24px;
        justify-content: space-between;
        padding-bottom: 16px;
      }
      .brand small {
        color: #475569;
        display: block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        font-size: 26px;
        margin: 4px 0 0;
      }
      .meta {
        color: #334155;
        font-size: 12px;
        line-height: 1.7;
        text-align: right;
      }
      .meta strong { color: #0f172a; }
      .section {
        margin-top: 18px;
        page-break-inside: avoid;
      }
      .section-title {
        align-items: center;
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      h2 {
        font-size: 15px;
        margin: 0;
      }
      .muted {
        color: #64748b;
        font-size: 11px;
      }
      .grid {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .kpi {
        border: 1px solid #dbe3ef;
        border-radius: 8px;
        min-height: 82px;
        padding: 12px;
      }
      .kpi span {
        color: #475569;
        display: block;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .kpi strong {
        display: block;
        font-size: 20px;
        margin-top: 7px;
      }
      .kpi small {
        color: #64748b;
        display: block;
        margin-top: 4px;
      }
      .kpi.positive { border-color: #bbf7d0; background: #f0fdf4; }
      .kpi.negative { border-color: #fecaca; background: #fff1f2; }
      .rules {
        border: 1px solid #dbe3ef;
        border-radius: 8px;
        display: grid;
        font-size: 12px;
        gap: 0;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        overflow: hidden;
      }
      .rules div {
        border-bottom: 1px solid #e2e8f0;
        border-right: 1px solid #e2e8f0;
        padding: 9px 10px;
      }
      .rules span {
        color: #64748b;
        display: block;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
      }
      table {
        border-collapse: collapse;
        font-size: 10.5px;
        width: 100%;
      }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      th {
        background: #eff6ff;
        border: 1px solid #cbd5e1;
        color: #1e3a8a;
        font-size: 10px;
        padding: 7px 6px;
        text-align: left;
        text-transform: uppercase;
      }
      td {
        border: 1px solid #dbe3ef;
        padding: 6px;
        vertical-align: top;
      }
      tbody tr:nth-child(even) td { background: #f8fafc; }
      .num {
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
      }
      .positive-text { color: #047857; font-weight: 700; }
      .negative-text { color: #dc2626; font-weight: 700; }
      .empty {
        color: #64748b;
        font-style: italic;
        text-align: center;
      }
      .signatures {
        display: grid;
        gap: 24px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 42px;
      }
      .signature {
        border-top: 1px solid #0f172a;
        color: #334155;
        font-size: 11px;
        padding-top: 8px;
        text-align: center;
      }
      @media print {
        body { background: #fff; }
        .no-print { display: none !important; }
        .page { padding: 0; }
        .sheet {
          border: 0;
          border-radius: 0;
          box-shadow: none;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="toolbar no-print">
      <strong>Espelho de ponto pronto para impressão</strong>
      <button type="button" onclick="window.print()">Imprimir / salvar PDF</button>
    </div>
    <main class="page">
      <article class="sheet">
        <header class="header">
          <div class="brand">
            <small>EasyCare Gestão Inteligente</small>
            <h1>Espelho de Ponto</h1>
          </div>
          <div class="meta">
            <div><strong>Empresa:</strong> ${escapeHtml(user?.organizationName ?? "-")}</div>
            <div><strong>Competência:</strong> ${escapeHtml(reportMonth)}</div>
            <div><strong>Colaborador:</strong> ${escapeHtml(selectedStaff)}</div>
            <div><strong>Status:</strong> ${escapeHtml(closureLabel)}</div>
            <div><strong>Gerado em:</strong> ${escapeHtml(generatedAt)}</div>
          </div>
        </header>

        <section class="section">
          <div class="section-title">
            <h2>Resumo do período</h2>
            <span class="muted">Baseado em escalas, batidas validas e ajustes aprovados.</span>
          </div>
          <div class="grid">${summaryCardsHtml}</div>
        </section>

        <section class="section">
          <div class="section-title">
            <h2>Regras usadas no cálculo</h2>
          </div>
          <div class="rules">
            <div><span>Tolerancia de atraso</span>${escapeHtml(formatMinutes(timeClockSettings.lateToleranceMinutes))}</div>
            <div><span>Tolerancia de hora extra</span>${escapeHtml(formatMinutes(timeClockSettings.overtimeToleranceMinutes))}</div>
            <div><span>Pausa padrao</span>${escapeHtml(formatMinutes(timeClockSettings.breakDurationMinutes))}</div>
            <div><span>Aviso fim da pausa</span>${escapeHtml(formatMinutes(timeClockSettings.breakReminderBeforeMinutes))}</div>
            <div><span>Adicional noturno</span>${escapeHtml(`${timeClockSettings.nightStartTime} até ${timeClockSettings.nightEndTime}`)}</div>
            <div><span>Bloqueios de fechamento</span>${escapeHtml([
              timeClockSettings.blockCloseWithIncompleteDays ? "jornadas incompletas" : null,
              timeClockSettings.blockCloseWithAbsences ? "faltas" : null,
              timeClockSettings.blockCloseWithOutOfRangeAttempts ? "fora do raio" : null,
            ].filter(Boolean).join(", ") || "sem bloqueios adicionais")}</div>
          </div>
        </section>

        <section class="section">
          <div class="section-title">
            <h2>Espelho diário</h2>
            <span class="muted">${escapeHtml(sortedDailySummaries.length)} dia(s)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Dia</th>
                <th>Colaborador</th>
                <th>Entrada prev.</th>
                <th>Saída prev.</th>
                <th>Previsto</th>
                <th>Realizado</th>
                <th>Saldo</th>
                <th>Atraso</th>
                <th>Hora extra</th>
                <th>Noturno</th>
                <th>Primeira / ultima</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${dailyRowsHtml}</tbody>
          </table>
        </section>

        <section class="section">
          <div class="section-title">
            <h2>Pendências para fechamento</h2>
            <span class="muted">${escapeHtml(pendingApprovalEntries.length + sortedPendingAdjustments.length)} item(ns)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Colaborador</th>
                <th>Evento</th>
                <th>Local</th>
                <th>Distância</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>${pendingRowsHtml}</tbody>
          </table>
          <table style="margin-top: 10px;">
            <thead>
              <tr>
                <th>Solicitado em</th>
                <th>Colaborador</th>
                <th>Evento</th>
                <th>Horario pedido</th>
                <th>Justificativa</th>
              </tr>
            </thead>
            <tbody>${adjustmentRowsHtml}</tbody>
          </table>
        </section>

        <section class="section">
          <div class="section-title">
            <h2>Registro de batidas</h2>
            <span class="muted">${escapeHtml(sortedEntries.length)} batida(s)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Colaborador</th>
                <th>Evento</th>
                <th>Status</th>
                <th>Local</th>
                <th>Endereço</th>
                <th>Distância</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>${entryRowsHtml}</tbody>
          </table>
        </section>

        <section class="section">
          <div class="section-title">
            <h2>Auditoria de tentativas fora do raio</h2>
            <span class="muted">${escapeHtml(outOfRangeAttempts.length)} tentativa(s)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Colaborador</th>
                <th>Usuario</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>${outOfRangeRowsHtml}</tbody>
          </table>
        </section>

        <section class="signatures">
          <div class="signature">Responsável pela empresa</div>
          <div class="signature">Colaborador</div>
          <div class="signature">Data</div>
        </section>
      </article>
    </main>
  </body>
</html>
    `);
    if (!printed) {
      toast({
        variant: "destructive",
        title: "Não foi possível gerar o relatório",
        description: "Tente novamente pelo navegador principal.",
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            Ponto eletrônico
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isManager ? "Gestão de jornada, locais e banco de horas." : "Registro de jornada e banco de horas."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mes</Label>
            <Input
              type="month"
              className="h-9 w-[150px]"
              value={month}
              onChange={(event) => setMonth(event.target.value || toMonthInputValue())}
            />
          </div>
          {isManager && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Colaborador</Label>
              <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {staffMembers.filter((member: any) => member.active !== false).map((member: any) => (
                    <SelectItem key={member.id} value={String(member.id)}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {timeClockAlerts.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {timeClockAlerts.map((alert) => (
            <div key={alert.title} className={`rounded-lg border px-3 py-2 ${alert.tone}`}>
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="mt-0.5 text-xs opacity-85">{alert.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isManager ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-border/70">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  Locais ativos
                </div>
                <p className="mt-2 text-2xl font-semibold">{activeLocations.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">{inactiveLocations.length} inativo(s)</p>
              </CardContent>
            </Card>
            <Card className="border-border/70">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  Batidas validas
                </div>
                <p className="mt-2 text-2xl font-semibold">{validEntries.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">{staffWithEntriesCount || 0} de {activeStaffCount || 0} colaborador(es)</p>
              </CardContent>
            </Card>
            <Card className="border-border/70">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Fora do raio
                </div>
                <p className={`mt-2 text-2xl font-semibold ${outOfRangeAttempts.length > 0 ? "text-red-600" : "text-foreground"}`}>
                  {outOfRangeAttempts.length}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">tentativas bloqueadas/auditoria</p>
              </CardContent>
            </Card>
            <Card className="border-border/70">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TimerReset className="h-3.5 w-3.5" />
                  Saldo do período
                </div>
                <p className={`mt-2 text-2xl font-semibold ${monthSummary.balanceMinutes < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {formatMinutes(monthSummary.balanceMinutes)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{monthSummary.incompleteDays} jornada(s) incompleta(s)</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Banco de horas</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Previsto
                </div>
                <p className="mt-2 text-xl font-semibold">{formatMinutes(monthSummary.expectedMinutes)}</p>
              </div>
              <div className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  Realizado
                </div>
                <p className="mt-2 text-xl font-semibold">{formatMinutes(monthSummary.workedMinutes)}</p>
              </div>
              <div className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TimerReset className="h-3.5 w-3.5" />
                  Saldo
                </div>
                <p className={`mt-2 text-xl font-semibold ${monthSummary.balanceMinutes < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {formatMinutes(monthSummary.balanceMinutes)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <Card className="border-border/70">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Meu ponto</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {statusQuery.data?.staff?.name ?? "Colaborador não vinculado"}
                  </p>
                </div>
                <Badge variant="outline" className={STATE_LABELS[currentState]?.tone ?? STATE_LABELS.closed.tone}>
                  {STATE_LABELS[currentState]?.label ?? "Sem jornada"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-lg border border-border/70 p-4">
                  <p className="text-xs text-muted-foreground">Horario atual</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums">
                    {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 p-4">
                  <p className="text-xs text-muted-foreground">Proxima marcacao</p>
                  <p className="mt-2 text-xl font-semibold">{nextActionText}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{todayVisibleEntries.length} batida(s) hoje</p>
                </div>
              </div>

              {activeLocations.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Nenhum local autorizado ativo.
                </div>
              ) : null}

              {monthIsClosed ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  Competência fechada. Novas batidas e ajustes ficam bloqueados até reabertura.
                </div>
              ) : null}

              <div className={`rounded-lg border p-3 text-sm ${permissionView.tone}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium">{permissionView.label}</p>
                      <p className="mt-0.5 truncate text-xs opacity-85">{permissionView.description}</p>
                    </div>
                  </div>
                  {(locationPermission === "prompt" || locationPermission === "unknown") && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-2 bg-background/80"
                      disabled={isReadingLocation || punchMutation.isPending}
                      onClick={handleEnableLocation}
                    >
                      <Navigation className="h-4 w-4" />
                      {isReadingLocation ? "Localizando..." : "Ativar localização"}
                    </Button>
                  )}
                </div>
              </div>

              {!statusQuery.data?.staff ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Usuário sem colaborador vinculado.
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                {nextActions.map((eventType) => {
                  const Icon = EVENT_ICONS[eventType];
                  return (
                    <Button
                      key={eventType}
                      className="h-12 justify-start gap-2"
                      disabled={
                        punchMutation.isPending
                        || isReadingLocation
                        || activeLocations.length === 0
                        || !statusQuery.data?.staff
                        || monthIsClosed
                      }
                      onClick={() => handlePunch(eventType)}
                      data-testid={`button-time-clock-${eventType}`}
                    >
                      <Icon className="h-4 w-4" />
                      {isReadingLocation || punchMutation.isPending ? "Localizando..." : EVENT_LABELS[eventType]}
                    </Button>
                  );
                })}
              </div>

            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Banco de horas</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Previsto
                </div>
                <p className="mt-2 text-xl font-semibold">{formatMinutes(monthSummary.expectedMinutes)}</p>
              </div>
              <div className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  Realizado
                </div>
                <p className="mt-2 text-xl font-semibold">{formatMinutes(monthSummary.workedMinutes)}</p>
              </div>
              <div className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TimerReset className="h-3.5 w-3.5" />
                  Saldo
                </div>
                <p className={`mt-2 text-xl font-semibold ${monthSummary.balanceMinutes < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {formatMinutes(monthSummary.balanceMinutes)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">{isManager ? "Pendências de ponto" : "Solicitar correção"}</CardTitle>
              <Badge variant="outline">
                {isManager ? pendingAdjustments.length + pendingApprovalEntries.length : pendingAdjustments.length} pendente(s)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isManager && (
              <div className="space-y-4">
                <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {selectedAdjustmentEntry ? "Corrigindo batida existente" : "Solicitação de batida"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {selectedAdjustmentEntry
                        ? `${EVENT_LABELS[selectedAdjustmentEntry.eventType]} - ${formatDateTime(selectedAdjustmentEntry.eventTime)}`
                        : "Registrar entrada, pausa, retorno ou saída que ficou faltando."}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 sm:w-auto"
                    onClick={startNewAdjustmentRequest}
                  >
                    Nova solicitação
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-[160px_minmax(190px,1fr)]">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Marcacao</Label>
                    <Select value={adjustmentEventType} onValueChange={(value) => setAdjustmentEventType(value as TimeClockEventType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(EVENT_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Data e horário correto</Label>
                    <Input
                      type="datetime-local"
                      value={adjustmentDateTime}
                      onChange={(event) => setAdjustmentDateTime(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs text-muted-foreground">Motivo</Label>
                    <Input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs text-muted-foreground">Observação</Label>
                    <Textarea
                      rows={2}
                      value={adjustmentNotes}
                      onChange={(event) => setAdjustmentNotes(event.target.value)}
                      placeholder="Ex: esqueci de registrar a saída do intervalo."
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Button
                      type="button"
                      className="w-full gap-2 sm:w-auto"
                      disabled={createAdjustmentMutation.isPending || monthIsClosed}
                      onClick={() => createAdjustmentMutation.mutate()}
                    >
                      <Save className="h-4 w-4" />
                      {selectedAdjustmentEntry ? "Enviar correção" : "Enviar solicitação"}
                    </Button>
                  </div>
                </div>

                {adjustableEntries.length > 0 && (
                  <div className="rounded-lg border border-border/70">
                    <div className="border-b border-border/70 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                      Batidas recentes para corrigir
                    </div>
                    <div className="divide-y divide-border/70">
                      {adjustableEntries.map((entry) => {
                        const selected = selectedAdjustmentEntryId === entry.id;
                        const status = ENTRY_STATUS_LABELS[entry.status];
                        return (
                          <div
                            key={entry.id}
                            className={`grid w-full gap-2 px-3 py-2 text-sm transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                              selected ? "bg-blue-50" : ""
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block font-medium">
                                {EVENT_LABELS[entry.eventType]} - {formatDateTime(entry.eventTime)}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {entry.locationName ?? "Sem local"} {entry.locationAddress ? `| ${entry.locationAddress}` : ""}
                              </span>
                            </span>
                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                              <Badge variant="outline" className={`${status.tone} h-8 min-w-[98px] justify-center px-3`}>
                                {status.label}
                              </Badge>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={selected ? "h-8 min-w-[98px] border-blue-200 bg-blue-50 text-blue-700" : "h-8 min-w-[98px]"}
                                onClick={() => startEntryCorrectionRequest(entry)}
                              >
                                {selected ? "Selecionada" : "Corrigir"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isManager && pendingApprovalEntries.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Batidas sem escala</p>
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                    {pendingApprovalEntries.length} aguardando
                  </Badge>
                </div>
                {pendingApprovalEntries.map((entry) => (
                  <div
                    key={entry.id}
                    id={`time-clock-pending-entry-${entry.id}`}
                    className={cn(
                      "rounded-lg border border-amber-200 bg-amber-50/40 p-3",
                      focusedEntryId === entry.id && "border-primary bg-primary/5 shadow-sm ring-2 ring-primary/20",
                    )}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {entry.staffName ?? "Colaborador"} - {EVENT_LABELS[entry.eventType]}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(entry.eventTime)} | {entry.locationName ?? "Sem local"}
                        </p>
                        {entry.notes && <p className="mt-1 text-xs text-muted-foreground">{entry.notes}</p>}
                      </div>
                      <Badge variant="outline" className={ENTRY_STATUS_LABELS.pending_approval.tone}>
                        Pendente
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      <Textarea
                        rows={2}
                        value={entryReviewNotesById[entry.id] ?? ""}
                        onChange={(event) => setEntryReviewNotesById((current) => ({ ...current, [entry.id]: event.target.value }))}
                        placeholder="Observação da revisão"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          disabled={reviewEntryMutation.isPending || monthIsClosed}
                          onClick={() => reviewEntryMutation.mutate({ id: entry.id, status: "rejected" })}
                        >
                          Reprovar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={reviewEntryMutation.isPending || monthIsClosed}
                          onClick={() => reviewEntryMutation.mutate({ id: entry.id, status: "approved" })}
                        >
                          Aprovar hora
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {adjustmentsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : adjustments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma solicitação no período.</p>
              ) : (
                adjustments.slice(0, isManager ? 8 : 5).map((item) => {
                  const statusView = ADJUSTMENT_STATUS_LABELS[item.status] ?? ADJUSTMENT_STATUS_LABELS.pending;
                  const originalEntry = item.entryId
                    ? entries.find((entry) => entry.id === item.entryId) ?? null
                    : null;
                  const appliedEntry = item.appliedEntryId
                    ? entries.find((entry) => entry.id === item.appliedEntryId) ?? null
                    : null;
                  return (
                    <div
                      key={item.id}
                      id={`time-clock-adjustment-${item.id}`}
                      className={cn(
                        "rounded-lg border border-border/70 p-3",
                        focusedAdjustmentId === item.id && "border-primary bg-primary/5 shadow-sm ring-2 ring-primary/20",
                      )}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {EVENT_LABELS[item.eventType]} - {formatDateTime(item.requestedEventTime)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.staffName ?? "Colaborador"} | {item.reason}
                          </p>
                          {item.notes && <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>}
                          {(originalEntry || appliedEntry) && (
                            <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                              {originalEntry && (
                                <p>
                                  Original: {EVENT_LABELS[originalEntry.eventType]} - {formatDateTime(originalEntry.eventTime)}
                                  {" | "}
                                  {originalEntry.locationName ?? "Sem local"}
                                </p>
                              )}
                              {appliedEntry && (
                                <p>
                                  Correção: {EVENT_LABELS[appliedEntry.eventType]} - {formatDateTime(appliedEntry.eventTime)}
                                  {" | "}
                                  {appliedEntry.locationName ?? "Sem local"}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        <Badge variant="outline" className={statusView.tone}>{statusView.label}</Badge>
                      </div>
                      {isManager && item.status === "pending" && (
                        <div className="mt-3 space-y-2">
                          <Textarea
                            rows={2}
                            value={reviewNotesById[item.id] ?? ""}
                            onChange={(event) => setReviewNotesById((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder="Observação da revisão"
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              disabled={reviewAdjustmentMutation.isPending || monthIsClosed}
                              onClick={() => reviewAdjustmentMutation.mutate({ id: item.id, status: "rejected" })}
                            >
                              Reprovar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={reviewAdjustmentMutation.isPending || monthIsClosed}
                              onClick={() => reviewAdjustmentMutation.mutate({ id: item.id, status: "approved" })}
                            >
                              Aprovar
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

      </div>

      {canConfigureLocations && (
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Locais autorizados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.8fr)_120px_100px_110px]">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Nome</Label>
                <Input value={locationName} onChange={(event) => setLocationName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {isLookingUpCep ? "Buscando CEP..." : "CEP"}
                </Label>
                <Input
                  inputMode="numeric"
                  value={locationCep}
                  onChange={(event) => {
                    setLocationCep(event.target.value);
                    setCapturedLocation(null);
                  }}
                  placeholder="00000-000"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Número</Label>
                <Input
                  value={locationNumber}
                  onChange={(event) => {
                    setLocationNumber(event.target.value);
                    setCapturedLocation(null);
                  }}
                  placeholder="123"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Raio</Label>
                <Input
                  type="number"
                  min={25}
                  max={5000}
                  value={locationRadius}
                  onChange={(event) => setLocationRadius(Number(event.target.value || 200))}
                />
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto_auto_auto]">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Endereço</Label>
                <Input
                  value={locationAddress}
                  onChange={(event) => {
                    setLocationAddress(event.target.value);
                    setCapturedLocation(null);
                  }}
                  placeholder="Rua, número, bairro"
                />
              </div>
              <Button
                variant="outline"
                className="mt-auto h-10 gap-2"
                onClick={handleFindAddressLocation}
                disabled={isLookingUpLocation || createLocationMutation.isPending}
              >
                <MapPin className="h-4 w-4" />
                {isGeocodingAddress ? "Buscando..." : "Buscar local pelo endereço"}
              </Button>
              <Button
                variant="outline"
                className="mt-auto h-10 gap-2"
                onClick={handleFindLocation}
                disabled={isLookingUpLocation || createLocationMutation.isPending}
              >
                <Navigation className="h-4 w-4" />
                {isReadingLocation || isResolvingLocationName ? "Buscando..." : "Usar GPS atual"}
              </Button>
              <Button
                className="mt-auto h-10 gap-2"
                onClick={handleSaveLocation}
                disabled={isLookingUpLocation || createLocationMutation.isPending}
              >
                <MapPin className="h-4 w-4" />
                Salvar local
              </Button>
            </div>
            {capturedLocation && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">
                    {locationAddress || capturedLocation.label || locationName || "Local capturado"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatCoordinate(capturedLocation.latitude)}, {formatCoordinate(capturedLocation.longitude)}
                  </span>
                </div>
                {capturedLocation.accuracy !== null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Precisao aproximada: {formatMeters(capturedLocation.accuracy)}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={locationListView === "active" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLocationListView("active")}
                  >
                    Ativos ({activeLocations.length})
                  </Button>
                  <Button
                    type="button"
                    variant={locationListView === "inactive" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLocationListView("inactive")}
                  >
                    Inativos ({inactiveLocations.length})
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {locationListView === "active" ? "Locais usados para validar novas batidas." : "Locais removidos ficam apenas para historico."}
                </p>
              </div>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {locations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Nenhum local cadastrado.
                  </div>
                ) : visibleLocations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    {locationListView === "active" ? "Nenhum local ativo." : "Nenhum local inativo."}
                  </div>
                ) : (
                  visibleLocations.map((location) => (
                    <div key={location.id} className="rounded-lg border border-border/70 p-3">
                      {editingLocation?.id === location.id ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Nome</Label>
                            <Input
                              value={editingLocation.name}
                              onChange={(event) => setEditingLocation((current) =>
                                current ? { ...current, name: event.target.value } : current,
                              )}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Endereço</Label>
                            <Input
                              value={editingLocation.address}
                              onChange={(event) => setEditingLocation((current) =>
                                current ? { ...current, address: event.target.value } : current,
                              )}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Raio</Label>
                            <Input
                              type="number"
                              min={25}
                              max={5000}
                              value={editingLocation.radiusMeters}
                              onChange={(event) => setEditingLocation((current) =>
                                current ? { ...current, radiusMeters: Number(event.target.value || 200) } : current,
                              )}
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-2"
                              disabled={updateLocationMutation.isPending}
                              onClick={() => setEditingLocation(null)}
                            >
                              <X className="h-3.5 w-3.5" />
                              Cancelar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 gap-2"
                              disabled={updateLocationMutation.isPending}
                              onClick={() => editingLocation && updateLocationMutation.mutate(editingLocation)}
                            >
                              <Save className="h-3.5 w-3.5" />
                              Salvar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <MapPin className="h-4 w-4 shrink-0 text-primary" />
                              <p className="truncate text-sm font-medium">{location.name}</p>
                            </div>
                            {location.active !== false ? (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                <ShieldCheck className="mr-1 h-3 w-3" />
                                Ativo
                              </Badge>
                            ) : (
                              <Badge variant="outline">Inativo</Badge>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Raio {formatMeters(location.radiusMeters)}
                          </p>
                          {location.address && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {location.address}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-2"
                              disabled={updateLocationMutation.isPending || updateLocationStatusMutation.isPending}
                              onClick={() => startEditingLocation(location)}
                            >
                              Editar
                            </Button>
                            {location.active !== false ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-2 text-red-600 hover:text-red-700"
                                disabled={updateLocationStatusMutation.isPending}
                                onClick={() => updateLocationStatusMutation.mutate({ id: location.id, active: false })}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remover
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-2"
                                disabled={updateLocationStatusMutation.isPending}
                                onClick={() => updateLocationStatusMutation.mutate({ id: location.id, active: true })}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Reativar
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/70">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">Conferencia mensal</CardTitle>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">{dailySummaries.length} dia(s)</Badge>
                <Badge variant="outline">{entries.length} batida(s)</Badge>
                <Badge variant="outline">{entryAuditGroups.length} grupo(s)</Badge>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="default"
                size="sm"
                className="w-full gap-2 sm:w-auto"
                disabled={dailySummaries.length === 0 && entries.length === 0}
                onClick={exportMirrorPdf}
              >
                <Printer className="h-4 w-4" />
                Exportar PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2 sm:w-auto"
                disabled={dailySummaries.length === 0 && entries.length === 0}
                onClick={exportMirrorCsv}
              >
                <FileDown className="h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={reviewTab} onValueChange={(value) => setReviewTab(value as TimeClockReviewTab)} className="space-y-4">
            <TabsList className={`grid h-auto w-full rounded-lg border border-border/70 bg-muted/60 p-1 shadow-sm sm:w-auto ${isManager ? "grid-cols-3" : "grid-cols-2"}`}>
              {isManager && <TabsTrigger value="closure" className="h-10 px-3 text-xs font-semibold sm:h-9 sm:text-sm">Fechamento</TabsTrigger>}
              <TabsTrigger value="mirror" className="h-10 px-3 text-xs font-semibold sm:h-9 sm:text-sm">Espelho mensal</TabsTrigger>
              <TabsTrigger value="log" className="h-10 px-3 text-xs font-semibold sm:h-9 sm:text-sm">Log</TabsTrigger>
            </TabsList>

            {isManager && (
              <TabsContent value="closure" className="mt-0 space-y-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-4">
                    <div className={`rounded-lg border p-4 ${closureStatusView.tone}`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">{closureStatusView.label}</p>
                          <p className="mt-1 text-xs opacity-85">{closureStatusView.description}</p>
                        </div>
                        <Badge variant="outline" className="w-fit bg-background/70">
                          {month}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-border/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" />
                          Previsto
                        </div>
                        <p className="mt-2 text-xl font-semibold">{formatMinutes(monthSummary.expectedMinutes)}</p>
                      </div>
                      <div className="rounded-lg border border-border/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" />
                          Realizado
                        </div>
                        <p className="mt-2 text-xl font-semibold">{formatMinutes(monthSummary.workedMinutes)}</p>
                      </div>
                      <div className="rounded-lg border border-border/70 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <TimerReset className="h-3.5 w-3.5" />
                          Saldo
                        </div>
                        <p className={`mt-2 text-xl font-semibold ${monthSummary.balanceMinutes < 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {formatMinutes(monthSummary.balanceMinutes)}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/70">
                      <div className="border-b border-border/70 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                        Checklist de fechamento
                      </div>
                      <div className="grid gap-2 p-3 sm:grid-cols-2">
                        {closureChecks.map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {item.ok ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                              ) : (
                                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                              )}
                              <span className="truncate text-sm">{item.label}</span>
                            </div>
                            <Badge variant="outline" className={item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                              {item.value}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/70">
                      <div className="flex flex-col gap-2 border-b border-border/70 bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs font-medium text-muted-foreground">Regras de cálculo</p>
                        {!canConfigureTimeClockRules && (
                          <Badge variant="outline" className="w-fit">Somente admin edita</Badge>
                        )}
                      </div>
                      <div className="space-y-4 p-3">
                        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Atraso tolerado</Label>
                            <Input
                              type="number"
                              min={0}
                              max={240}
                              value={timeClockDraft.lateToleranceMinutes}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onChange={(event) => updateTimeClockDraft("lateToleranceMinutes", Number(event.target.value || 0))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Extra tolerada</Label>
                            <Input
                              type="number"
                              min={0}
                              max={240}
                              value={timeClockDraft.overtimeToleranceMinutes}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onChange={(event) => updateTimeClockDraft("overtimeToleranceMinutes", Number(event.target.value || 0))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Duracao da pausa</Label>
                            <Input
                              type="number"
                              min={0}
                              max={720}
                              value={timeClockDraft.breakDurationMinutes}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onChange={(event) => updateTimeClockDraft("breakDurationMinutes", Number(event.target.value || 0))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Avisar antes</Label>
                            <Input
                              type="number"
                              min={0}
                              max={120}
                              value={timeClockDraft.breakReminderBeforeMinutes}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onChange={(event) => updateTimeClockDraft("breakReminderBeforeMinutes", Number(event.target.value || 0))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Noturno inicia</Label>
                            <Input
                              type="time"
                              value={timeClockDraft.nightStartTime}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onChange={(event) => updateTimeClockDraft("nightStartTime", event.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Noturno termina</Label>
                            <Input
                              type="time"
                              value={timeClockDraft.nightEndTime}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onChange={(event) => updateTimeClockDraft("nightEndTime", event.target.value)}
                            />
                          </div>
                        </div>
                        <div className="grid gap-2 md:grid-cols-3">
                          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
                            <span>Bloquear incompletas</span>
                            <Switch
                              checked={timeClockDraft.blockCloseWithIncompleteDays}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onCheckedChange={(checked) => updateTimeClockDraft("blockCloseWithIncompleteDays", checked)}
                            />
                          </label>
                          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
                            <span>Bloquear faltas</span>
                            <Switch
                              checked={timeClockDraft.blockCloseWithAbsences}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onCheckedChange={(checked) => updateTimeClockDraft("blockCloseWithAbsences", checked)}
                            />
                          </label>
                          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm">
                            <span>Bloquear fora do raio</span>
                            <Switch
                              checked={timeClockDraft.blockCloseWithOutOfRangeAttempts}
                              disabled={!canConfigureTimeClockRules || updateEnvironmentSettingsMutation.isPending}
                              onCheckedChange={(checked) => updateTimeClockDraft("blockCloseWithOutOfRangeAttempts", checked)}
                            />
                          </label>
                        </div>
                        {canConfigureTimeClockRules && (
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              disabled={updateEnvironmentSettingsMutation.isPending}
                              onClick={handleSaveTimeClockRules}
                            >
                              <Save className="h-4 w-4" />
                              Salvar regras
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-lg border border-border/70 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">Ação do mês</p>
                        {monthIsClosed ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Fechado</Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Aberto</Badge>
                        )}
                      </div>
                      <div className="mt-4 space-y-1">
                        <Label className="text-xs text-muted-foreground">Observação</Label>
                        <Textarea
                          rows={4}
                          value={closureNotes}
                          onChange={(event) => setClosureNotes(event.target.value)}
                          placeholder="Ex: fechamento validado com pendências justificadas."
                        />
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                        <Button
                          type="button"
                          className="gap-2"
                          disabled={closureMutation.isPending || !canCloseMonth}
                          onClick={() => closureMutation.mutate("close")}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Fechar mês
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-2"
                          disabled={closureMutation.isPending || !monthIsClosed}
                          onClick={() => closureMutation.mutate("reopen")}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Reabrir mês
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/70">
                      <div className="border-b border-border/70 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                        Auditoria recente
                      </div>
                      {recentAuditLogs.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">Sem eventos no período.</p>
                      ) : (
                        <div className="divide-y divide-border/70">
                          {recentAuditLogs.slice(0, 5).map((log) => (
                            <div key={log.id} className="px-3 py-2 text-sm">
                              <p className="font-medium">{log.action}</p>
                              <p className="text-xs text-muted-foreground">
                                {log.performedByName ?? "-"} - {formatDateTime(log.createdAt)}
                              </p>
                              {log.reason && <p className="mt-1 text-xs text-muted-foreground">{log.reason}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>
            )}

            <TabsContent value="mirror" className="mt-0">
              {entriesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : dailySummaries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados no mês.</p>
              ) : (
                <>
                  <div className="space-y-3 md:hidden">
                    {dailySummaries.map((summary) => (
                      <div key={summary.key} className="rounded-lg border border-border/70 bg-background p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{formatDate(summary.date)}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {summary.staffName ?? "Sem colaborador"}
                            </p>
                          </div>
                          <div className="shrink-0">{renderDailySummaryStatus(summary)}</div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-md bg-muted/35 px-2.5 py-2">
                            <p className="text-[11px] text-muted-foreground">Previsto</p>
                            <p className="mt-1 text-sm font-semibold tabular-nums">{formatMinutes(summary.expectedMinutes)}</p>
                          </div>
                          <div className="rounded-md bg-muted/35 px-2.5 py-2">
                            <p className="text-[11px] text-muted-foreground">Realizado</p>
                            <p className="mt-1 text-sm font-semibold tabular-nums">{formatMinutes(summary.workedMinutes)}</p>
                          </div>
                          <div className="rounded-md bg-muted/35 px-2.5 py-2">
                            <p className="text-[11px] text-muted-foreground">Saldo</p>
                            <p className={`mt-1 text-sm font-semibold tabular-nums ${summary.balanceMinutes < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {formatMinutes(summary.balanceMinutes)}
                            </p>
                          </div>
                          <div className="rounded-md bg-muted/35 px-2.5 py-2">
                            <p className="text-[11px] text-muted-foreground">Atraso</p>
                            <p className="mt-1 text-sm font-semibold tabular-nums">{formatMinutes(summary.lateMinutes ?? 0)}</p>
                          </div>
                          <div className="rounded-md bg-muted/35 px-2.5 py-2">
                            <p className="text-[11px] text-muted-foreground">Extra</p>
                            <p className="mt-1 text-sm font-semibold tabular-nums">{formatMinutes(summary.overtimeMinutes ?? 0)}</p>
                          </div>
                          <div className="rounded-md bg-muted/35 px-2.5 py-2">
                            <p className="text-[11px] text-muted-foreground">Noturno</p>
                            <p className="mt-1 text-sm font-semibold tabular-nums">{formatMinutes(summary.nightMinutes ?? 0)}</p>
                          </div>
                        </div>

                        {(summary.expectedStart || summary.expectedEnd || summary.firstClockIn || summary.lastClockOut) && (
                          <div className="mt-3 rounded-md border border-border/70 px-2.5 py-2 text-xs text-muted-foreground">
                            <div className="flex items-center justify-between gap-3">
                              <span>Escala</span>
                              <span className="font-medium tabular-nums text-foreground">
                                {summary.expectedStart ?? "--:--"} - {summary.expectedEnd ?? "--:--"}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3">
                              <span>Batidas</span>
                              <span className="font-medium tabular-nums text-foreground">
                                {formatTime(summary.firstClockIn)} - {formatTime(summary.lastClockOut)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto rounded-lg border border-border/70 md:block">
                    <table className="w-full min-w-[980px] text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Dia</th>
                          <th className="px-3 py-2 text-left font-medium">Colaborador</th>
                          <th className="px-3 py-2 text-right font-medium">Previsto</th>
                          <th className="px-3 py-2 text-right font-medium">Realizado</th>
                          <th className="px-3 py-2 text-right font-medium">Saldo</th>
                          <th className="px-3 py-2 text-right font-medium">Atraso</th>
                          <th className="px-3 py-2 text-right font-medium">Extra</th>
                          <th className="px-3 py-2 text-right font-medium">Noturno</th>
                          <th className="px-3 py-2 text-left font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailySummaries.map((summary) => (
                          <tr key={summary.key} className="border-t border-border/70">
                            <td className="px-3 py-2">{formatDate(summary.date)}</td>
                            <td className="px-3 py-2">{summary.staffName ?? "-"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(summary.expectedMinutes)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(summary.workedMinutes)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums ${summary.balanceMinutes < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {formatMinutes(summary.balanceMinutes)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(summary.lateMinutes ?? 0)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(summary.overtimeMinutes ?? 0)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(summary.nightMinutes ?? 0)}</td>
                            <td className="px-3 py-2">{renderDailySummaryStatus(summary)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="log" className="mt-0 space-y-4">
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto] md:items-end">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Buscar</Label>
                    <Input
                      value={entrySearch}
                      onChange={(event) => {
                        setEntrySearch(event.target.value);
                        setEntryPage(1);
                      }}
                      placeholder="Colaborador, local ou endereço"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Tipo</Label>
                    <Select
                      value={entryEventFilter}
                      onValueChange={(value) => {
                        setEntryEventFilter(value as EntryEventFilter);
                        setEntryPage(1);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {Object.entries(EVENT_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select
                      value={entryStatusFilter}
                      onValueChange={(value) => {
                        setEntryStatusFilter(value as EntryStatusFilter);
                        setEntryPage(1);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="valid">Válidos</SelectItem>
                        <SelectItem value="manual_adjusted">Ajustados</SelectItem>
                        <SelectItem value="corrected">Corrigidos</SelectItem>
                        <SelectItem value="pending_approval">Pendentes</SelectItem>
                        <SelectItem value="rejected">Reprovados</SelectItem>
                        <SelectItem value="out_of_range">Fora do raio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Badge variant="outline" className="h-9 justify-center px-3">
                    {filteredEntries.length} registro(s)
                  </Badge>
                </div>
              </div>

              {entriesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem batidas no mês.</p>
              ) : filteredEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma batida encontrada com os filtros atuais.</p>
              ) : (
                <div className="space-y-3">
                  {paginatedEntryGroups.map((group) => (
                    <div key={group.key} className="rounded-lg border border-border/70 bg-background">
                      <div className="flex flex-col gap-2 border-b border-border/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{formatDate(group.date)}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {group.staffName} - {group.entries.length} batida(s)
                          </p>
                        </div>
                        {group.entries.some((entry) => entry.status === "out_of_range" || entry.status === "pending_approval" || entry.status === "rejected") ? (
                          <Badge variant="outline" className="w-fit border-red-200 bg-red-50 text-red-700">
                            <AlertCircle className="mr-1 h-3 w-3" />
                            Com alerta
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="w-fit border-emerald-200 bg-emerald-50 text-emerald-700">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Conferido
                          </Badge>
                        )}
                      </div>
                      <div className="divide-y divide-border/70">
                        {group.entries.map((entry) => {
                          const EventIcon = EVENT_ICONS[entry.eventType];
                          const status = ENTRY_STATUS_LABELS[entry.status];
                          return (
                            <div
                              key={entry.id}
                              id={`time-clock-entry-${entry.id}`}
                              className={cn(
                                "grid gap-2 px-3 py-2 text-sm sm:grid-cols-[120px_minmax(0,1fr)_120px_120px] sm:items-center",
                                focusedEntryId === entry.id && "bg-primary/5 ring-1 ring-inset ring-primary/25",
                              )}
                            >
                              <div className="flex items-center gap-2 font-medium tabular-nums">
                                <EventIcon className="h-4 w-4 text-muted-foreground" />
                                {formatTime(entry.eventTime)}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-medium">{EVENT_LABELS[entry.eventType]}</p>
                                <p className="truncate text-xs text-muted-foreground">{entry.locationName ?? "Sem local"}</p>
                                {entry.locationAddress && (
                                  <p className="truncate text-xs text-muted-foreground">{entry.locationAddress}</p>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground sm:text-right">
                                {formatMeters(entry.distanceMeters)}
                              </p>
                              <Badge variant="outline" className={`w-fit sm:ml-auto ${status.tone}`}>
                                {status.label}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="text-xs text-muted-foreground">
                      Pagina {currentEntryPage} de {entryPageCount}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={currentEntryPage <= 1}
                        onClick={() => setEntryPage((page) => Math.max(1, page - 1))}
                      >
                        Anterior
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={currentEntryPage >= entryPageCount}
                        onClick={() => setEntryPage((page) => Math.min(entryPageCount, page + 1))}
                      >
                        Proxima
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
