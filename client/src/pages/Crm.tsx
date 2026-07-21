import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { toDateInputValue } from "@/lib/date";
import { fetchJsonOrThrow } from "@/lib/fetch-json";
import { printHtmlDocument } from "@/lib/print";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, ArrowDown, ArrowUp, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Columns3, DollarSign, FileText, FilterX, GripVertical, List, Plus, Search, Settings2, Trash2 } from "lucide-react";

type CrmStagePayload = {
  value: string;
  label: string;
  color?: string | null;
};

type CrmStageConfig = CrmStagePayload & {
  color: string;
  badgeStyle: CSSProperties;
};

type CrmOpportunity = {
  id: number;
  organizationId: number;
  title: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  source: string | null;
  stage: string;
  amount: number | null;
  expectedCloseDate: string | null;
  ownerId: number | null;
  ownerStaffId: number | null;
  ownerName?: string | null;
  ownerStaffName?: string | null;
  notes: string | null;
  followUpTasks?: string | null;
  lostReason: string | null;
  position: number | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

type CrmOpportunityPageResponse = {
  items: CrmOpportunity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalAmount: number;
  stageCounts?: Array<{ stage: string; count: number; amount: number }>;
};

type CrmOpportunityListResponse = CrmOpportunity[] | CrmOpportunityPageResponse;

type CrmSourceMetric = {
  source: string;
  count: number;
  totalAmount: number;
  wonCount: number;
  wonAmount: number;
  conversionRate: number;
};

type CrmFollowUpTask = {
  id: string;
  title: string;
  dueDate: string;
  done: boolean;
  notes: string | null;
  assigneeName: string | null;
  createdAt: string;
  completedAt: string | null;
};

type OrganizationOption = {
  id: number;
  name: string;
  status?: string | null;
};

type CrmResponsibleOption = {
  id: number;
  name: string;
  role?: string | null;
  active?: boolean | null;
};

type CrmStagesApiResponse = {
  stages: CrmStagePayload[];
  migratedCount?: number;
};

type CrmViewMode = "list" | "kanban";
type CrmFollowUpFilter = "all" | "pending" | "overdue" | "today" | "none";
type ProposalPresetKey = "ilpi" | "home_care" | "complete" | "custom";

type ProposalOfferItem = {
  id: string;
  title: string;
  description: string;
};

const DEFAULT_CRM_STAGES: CrmStagePayload[] = [
  { value: "lead", label: "Lead", color: "#64748B" },
  { value: "qualified", label: "Qualificado", color: "#0EA5E9" },
  { value: "proposal", label: "Proposta", color: "#F59E0B" },
  { value: "negotiation", label: "Negociacao", color: "#8B5CF6" },
  { value: "won", label: "Ganho", color: "#10B981" },
  { value: "no_interest", label: "Não tem interesse", color: "#F97316" },
];

const PROPOSAL_OFFER_ITEMS: ProposalOfferItem[] = [
  {
    id: "initial_assessment",
    title: "Avalia??o inicial do paciente",
    description: "Levantamento do perfil, rotina, grau de dependência e necessidades assistenciais.",
  },
  {
    id: "care_plan",
    title: "Plano de cuidados individualizado",
    description: "Organização da rotina, cuidados diarios, sinais de alerta e orientacoes para a equipe.",
  },
  {
    id: "assisted_living",
    title: "Hospedagem e cuidados em residencia assistida",
    description: "Acompanhamento diário em ambiente estruturado para segurança, higiene, alimentação e bem-estar.",
  },
  {
    id: "home_care",
    title: "Atendimento Home Care",
    description: "Cuidado no domic?lio conforme jornada combinada, perfil do paciente e escala aprovada.",
  },
  {
    id: "medication_management",
    title: "Controle e administração de medicamentos",
    description: "Organização de horários, registro de administração e acompanhamento de doses pendentes.",
  },
  {
    id: "daily_evolution",
    title: "Evolução diária e registros assistenciais",
    description: "Registro de evoluções, anotações, sinais vitais, glicemia, checklist e intercorrências.",
  },
  {
    id: "hygiene_routine",
    title: "Rotina de higiene, banho e conforto",
    description: "Apoio nas atividades de vida di?ria conforme autonomia e necessidade do paciente.",
  },
  {
    id: "nutrition",
    title: "Acompanhamento alimentar",
    description: "Organização das refeicoes, restrições alimentares e registro de aceitação quando aplicavel.",
  },
  {
    id: "family_reports",
    title: "Comunicacao e relatórios para a familia",
    description: "Compartilhamento de informações relevantes sobre rotina, cuidados e evolução do paciente.",
  },
  {
    id: "technical_supervision",
    title: "Supervisao tecnica da equipe",
    description: "Acompanhamento operacional da escala, orientacoes e apoio para padronizacao do cuidado.",
  },
  {
    id: "therapies",
    title: "Terapias e atendimentos complementares",
    description: "Possibilidade de incluir fisioterapia, enfermagem, medico, nutricionista ou outros profissionais.",
  },
  {
    id: "documents",
    title: "Organização documental",
    description: "Armazenamento de documentos, exames, anamneses, contratos e arquivos vinculados ao paciente.",
  },
];

const PROPOSAL_PRESETS: Record<ProposalPresetKey, { label: string; itemIds: string[] }> = {
  ilpi: {
    label: "ILPI / residencia assistida",
    itemIds: [
      "initial_assessment",
      "care_plan",
      "assisted_living",
      "medication_management",
      "daily_evolution",
      "hygiene_routine",
      "nutrition",
      "family_reports",
      "technical_supervision",
      "documents",
    ],
  },
  home_care: {
    label: "Home Care",
    itemIds: [
      "initial_assessment",
      "care_plan",
      "home_care",
      "medication_management",
      "daily_evolution",
      "hygiene_routine",
      "family_reports",
      "technical_supervision",
    ],
  },
  complete: {
    label: "Completo",
    itemIds: PROPOSAL_OFFER_ITEMS.map((item) => item.id),
  },
  custom: {
    label: "Personalizado",
    itemIds: [],
  },
};

const STAGE_FALLBACK_COLORS = [
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
const STAGE_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const toStageKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeLegacyStage = (stage: string | null | undefined): string => {
  const normalized = toStageKey(String(stage ?? ""));
  if (normalized === "lost") return "no_interest";
  return normalized;
};

const resolveDefaultStageColor = (stageValue: string, index: number): string => {
  const normalized = normalizeLegacyStage(stageValue);
  const defaultMatch = DEFAULT_CRM_STAGES.find((stage) => stage.value === normalized)?.color;
  return (defaultMatch ?? STAGE_FALLBACK_COLORS[index % STAGE_FALLBACK_COLORS.length]).toUpperCase();
};
const normalizeStageColor = (color: unknown, fallback: string): string => {
  if (typeof color !== "string") return fallback;
  const normalized = color.trim();
  if (!STAGE_COLOR_REGEX.test(normalized)) return fallback;
  return normalized.toUpperCase();
};
const withHexAlpha = (hex: string, alphaHex: string) =>
  `${normalizeStageColor(hex, "#64748B")}${alphaHex}`;
const buildStageBadgeStyle = (color: string): CSSProperties => ({
  borderColor: withHexAlpha(color, "55"),
  backgroundColor: withHexAlpha(color, "1A"),
  color,
});
const buildStageChipStyle = (color: string): CSSProperties => ({
  borderColor: withHexAlpha(color, "55"),
  backgroundColor: withHexAlpha(color, "12"),
});
const stageLabel = (stage: string, stages: CrmStageConfig[]) =>
  stages.find((item) => item.value === normalizeLegacyStage(stage))?.label ?? stage;

const opportunitySchema = z.object({
  title: z.string().trim().min(2, "Titulo obrigatorio"),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
  source: z.string().optional(),
  stage: z.string().trim().min(1, "Etapa obrigatoria"),
  amount: z.coerce.number().min(0, "Valor inválido"),
  expectedCloseDate: z.string().optional(),
  ownerStaffId: z.preprocess(
    (value) => {
      if (value === "" || value === "none" || value === null || value === undefined) return null;
      return Number(value);
    },
    z.number().int().positive().nullable().optional(),
  ),
  notes: z.string().optional(),
  lostReason: z.string().optional(),
});

const stageUsesLostReason = (stage?: string | null) =>
  normalizeLegacyStage(stage ?? null) === "no_interest";

const FOLLOW_UP_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0][1-9]|[12]\d|3[01])$/;
const normalizeDateKey = (value: string): string | null => {
  if (!FOLLOW_UP_DATE_REGEX.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return value;
};
const parseCrmFollowUpTasks = (raw: unknown): CrmFollowUpTask[] => {
  const source = (() => {
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(raw) ? raw : [];
  })();

  const nowIso = new Date().toISOString();
  const tasks: CrmFollowUpTask[] = [];
  source.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const candidate = item as Record<string, unknown>;
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    const dueDateRaw = typeof candidate.dueDate === "string" ? candidate.dueDate.trim() : "";
    const dueDate = normalizeDateKey(dueDateRaw);
    if (!title || !dueDate) return;
    const createdAtRaw = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
    const createdAt = Number.isNaN(new Date(createdAtRaw).getTime()) ? nowIso : new Date(createdAtRaw).toISOString();
    const done = Boolean(candidate.done);
    const completedAtRaw = typeof candidate.completedAt === "string" ? candidate.completedAt : "";
    const completedAt = done && !Number.isNaN(new Date(completedAtRaw).getTime())
      ? new Date(completedAtRaw).toISOString()
      : done
        ? nowIso
        : null;
    tasks.push({
      id: typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim()
        : `fu_${Date.now()}_${index + 1}`,
      title,
      dueDate,
      done,
      notes: typeof candidate.notes === "string" && candidate.notes.trim() ? candidate.notes.trim() : null,
      assigneeName: typeof candidate.assigneeName === "string" && candidate.assigneeName.trim()
        ? candidate.assigneeName.trim()
        : null,
      createdAt,
      completedAt,
    });
  });
  return tasks;
};
const sortFollowUpTasks = (tasks: CrmFollowUpTask[]) =>
  tasks.slice().sort((left, right) => {
    if (left.done !== right.done) return left.done ? 1 : -1;
    return left.dueDate.localeCompare(right.dueDate);
  });
const todayDateKey = () => toDateInputValue();
const formatDateKeyPtBr = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
};

function asNullableText(value?: string | null): string | null {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function formatCurrencyBRL(value?: number | null): string {
  if (!Number.isFinite(Number(value ?? 0))) return "R$ 0,00";
  return Number(value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 100)}%`;
}

function getOpportunityFollowUpSummary(opportunity: CrmOpportunity) {
  const followUpTasks = parseCrmFollowUpTasks(opportunity.followUpTasks);
  const pendingFollowUps = followUpTasks.filter((task) => !task.done);
  const currentDateKey = todayDateKey();
  const overdueCount = pendingFollowUps.filter((task) => task.dueDate < currentDateKey).length;
  const dueTodayCount = pendingFollowUps.filter((task) => task.dueDate === currentDateKey).length;
  const nextFollowUp = sortFollowUpTasks(pendingFollowUps)[0] ?? null;

  return {
    pendingFollowUps,
    overdueCount,
    dueTodayCount,
    nextFollowUp,
    hasAlert: overdueCount > 0 || dueTodayCount > 0,
  };
}

function buildCrmUrl(basePath: string, params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || `${value}`.trim() === "") return;
    query.set(key, String(value));
  });
  const suffix = query.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export default function CrmPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [followUpFilter, setFollowUpFilter] = useState<CrmFollowUpFilter>("all");
  const [expectedCloseFrom, setExpectedCloseFrom] = useState("");
  const [expectedCloseTo, setExpectedCloseTo] = useState("");
  const [viewMode, setViewMode] = useState<CrmViewMode>("list");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOpportunity, setEditingOpportunity] = useState<CrmOpportunity | null>(null);
  const [draggingOpportunityId, setDraggingOpportunityId] = useState<number | null>(null);
  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [followUpOpportunity, setFollowUpOpportunity] = useState<CrmOpportunity | null>(null);
  const [followUpTasksDraft, setFollowUpTasksDraft] = useState<CrmFollowUpTask[]>([]);
  const [newFollowUpTitle, setNewFollowUpTitle] = useState("");
  const [newFollowUpDueDate, setNewFollowUpDueDate] = useState(todayDateKey());
  const [newFollowUpAssignee, setNewFollowUpAssignee] = useState("");
  const [newFollowUpNotes, setNewFollowUpNotes] = useState("");
  const [stagesDialogOpen, setStagesDialogOpen] = useState(false);
  const [stagesDraft, setStagesDraft] = useState<CrmStagePayload[]>([]);
  const [newStageLabel, setNewStageLabel] = useState("");
  const [draggingStageIndex, setDraggingStageIndex] = useState<number | null>(null);
  const [dragOverStageIndex, setDragOverStageIndex] = useState<number | null>(null);
  const [proposalDialogOpen, setProposalDialogOpen] = useState(false);
  const [proposalOpportunity, setProposalOpportunity] = useState<CrmOpportunity | null>(null);
  const [proposalPreset, setProposalPreset] = useState<ProposalPresetKey>("ilpi");
  const [selectedProposalItemIds, setSelectedProposalItemIds] = useState<string[]>(PROPOSAL_PRESETS.ilpi.itemIds);
  const [proposalValidityDays, setProposalValidityDays] = useState(7);
  const [proposalPaymentTerms, setProposalPaymentTerms] = useState("Mensalidade com vencimento a combinar. Valores sujeitos a ajuste apos avaliacao inicial e definicao final do plano.");
  const [proposalExtraNotes, setProposalExtraNotes] = useState("");

  const form = useForm<z.infer<typeof opportunitySchema>>({
    resolver: zodResolver(opportunitySchema),
    defaultValues: {
      title: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      source: "",
      stage: "",
      amount: 0,
      expectedCloseDate: "",
      ownerStaffId: null,
      notes: "",
      lostReason: "",
    },
  });
  const watchedStage = form.watch("stage");

  const organizationsQuery = useQuery<OrganizationOption[]>({
    queryKey: ["/api/organizations", "crm"],
    enabled: !!user?.isSuperAdmin,
    queryFn: () => fetchJsonOrThrow("/api/organizations", "Erro ao carregar organizacoes."),
  });

  useEffect(() => {
    if (!user?.isSuperAdmin) return;
    const firstOrg = organizationsQuery.data?.[0];
    if (!selectedOrganizationId && firstOrg?.id) {
      setSelectedOrganizationId(firstOrg.id);
    }
  }, [organizationsQuery.data, selectedOrganizationId, user?.isSuperAdmin]);

  const scopedOrganizationId = user?.isSuperAdmin ? selectedOrganizationId : user?.organizationId ?? null;

  const stagesQuery = useQuery<CrmStagesApiResponse>({
    queryKey: ["/api/crm/stages", scopedOrganizationId],
    enabled: !!scopedOrganizationId,
    queryFn: async () => {
      try {
        return await fetchJsonOrThrow(
          buildCrmUrl("/api/crm/stages", { organizationId: scopedOrganizationId }),
          "Erro ao carregar etapas do CRM.",
        );
      } catch (error) {
        if (
          error instanceof Error
          && (
            error.message.includes("Resposta inválida do servidor")
            || error.message.includes("Erro ao carregar etapas do CRM.")
          )
        ) {
          return { stages: DEFAULT_CRM_STAGES };
        }
        throw error;
      }
    },
  });

  const crmResponsiblesQuery = useQuery<CrmResponsibleOption[]>({
    queryKey: ["/api/crm/responsibles", scopedOrganizationId],
    enabled: !!scopedOrganizationId,
    queryFn: () =>
      fetchJsonOrThrow(
        buildCrmUrl("/api/crm/responsibles", { organizationId: scopedOrganizationId }),
        "Erro ao carregar responsáveis do CRM.",
      ),
  });

  const crmStages = useMemo<CrmStageConfig[]>(() => {
    const source = (stagesQuery.data?.stages?.length ? stagesQuery.data.stages : DEFAULT_CRM_STAGES)
      .map((stage, index) => ({
        value: normalizeLegacyStage(stage.value),
        label: stage.label.trim(),
        color: normalizeStageColor(stage.color, resolveDefaultStageColor(stage.value, index)),
      }))
      .filter((stage) => stage.value && stage.label)
      .filter((stage, index, collection) =>
        collection.findIndex((current) => current.value === stage.value) === index,
      );

    const normalized = source.length > 0 ? source : DEFAULT_CRM_STAGES;
    return normalized.map((stage, index) => ({
      ...stage,
      color: normalizeStageColor(stage.color, resolveDefaultStageColor(stage.value, index)),
      badgeStyle: buildStageBadgeStyle(normalizeStageColor(stage.color, resolveDefaultStageColor(stage.value, index))),
    }));
  }, [stagesQuery.data?.stages]);

  const stageValues = useMemo(() => crmStages.map((stage) => stage.value), [crmStages]);
  const defaultStageValue = stageValues[0] ?? "lead";

  useEffect(() => {
    if (stageFilter === "all") return;
    if (!stageValues.includes(stageFilter)) {
      setStageFilter("all");
    }
  }, [stageFilter, stageValues]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    search,
    stageFilter,
    sourceFilter,
    ownerFilter,
    followUpFilter,
    expectedCloseFrom,
    expectedCloseTo,
    scopedOrganizationId,
    pageSize,
    viewMode,
  ]);

  useEffect(() => {
    if (!dialogOpen) return;
    const currentStage = normalizeLegacyStage(form.getValues("stage"));
    if (!stageValues.includes(currentStage)) {
      form.setValue("stage", defaultStageValue);
    }
  }, [dialogOpen, form, stageValues, defaultStageValue]);

  const opportunitiesQuery = useQuery<CrmOpportunityListResponse>({
    queryKey: [
      "/api/crm/opportunities",
      scopedOrganizationId,
      search,
      stageFilter,
      sourceFilter,
      ownerFilter,
      followUpFilter,
      expectedCloseFrom,
      expectedCloseTo,
      viewMode,
      currentPage,
      pageSize,
      stageValues.join("|"),
    ],
    enabled: !!scopedOrganizationId && crmStages.length > 0,
    queryFn: () =>
      fetchJsonOrThrow(
        buildCrmUrl("/api/crm/opportunities", {
          organizationId: scopedOrganizationId,
          search: search.trim() || undefined,
          stage: stageFilter !== "all" ? stageFilter : undefined,
          source: sourceFilter !== "all" ? sourceFilter : undefined,
          ownerStaffId: ownerFilter !== "all" ? ownerFilter : undefined,
          followUpStatus: followUpFilter !== "all" ? followUpFilter : undefined,
          expectedCloseFrom: expectedCloseFrom || undefined,
          expectedCloseTo: expectedCloseTo || undefined,
          page: viewMode === "list" ? currentPage : undefined,
          pageSize: viewMode === "list" ? pageSize : undefined,
        }),
        "Erro ao carregar oportunidades do CRM.",
      ),
  });

  const analyticsQuery = useQuery<CrmOpportunity[]>({
    queryKey: ["/api/crm/opportunities", "analytics", scopedOrganizationId, stageValues.join("|")],
    enabled: !!scopedOrganizationId && crmStages.length > 0,
    queryFn: () =>
      fetchJsonOrThrow(
        buildCrmUrl("/api/crm/opportunities", {
          organizationId: scopedOrganizationId,
        }),
        "Erro ao carregar analitico do CRM.",
      ),
  });

  const opportunitiesResponse = opportunitiesQuery.data;
  const paginatedResponse = opportunitiesResponse && !Array.isArray(opportunitiesResponse)
    ? opportunitiesResponse
    : null;
  const loadedOpportunities = Array.isArray(opportunitiesResponse)
    ? opportunitiesResponse
    : paginatedResponse?.items ?? [];

  const grouped = useMemo(() => {
    const buckets: Record<string, CrmOpportunity[]> = {};
    crmStages.forEach((stage) => {
      buckets[stage.value] = [];
    });

    for (const opportunity of loadedOpportunities) {
      const normalizedStage = normalizeLegacyStage(opportunity.stage);
      const stage = stageValues.includes(normalizedStage) ? normalizedStage : defaultStageValue;
      if (!buckets[stage]) buckets[stage] = [];
      buckets[stage].push(opportunity);
    }

    Object.keys(buckets).forEach((stage) => {
      buckets[stage].sort((left, right) => {
        const leftPos = Number(left.position ?? 0);
        const rightPos = Number(right.position ?? 0);
        if (leftPos !== rightPos) return leftPos - rightPos;
        return Number(left.id) - Number(right.id);
      });
    });

    return buckets;
  }, [crmStages, loadedOpportunities, stageValues, defaultStageValue]);

  const totalAmount = useMemo(
    () => paginatedResponse?.totalAmount
      ?? loadedOpportunities.reduce((accumulator, item) => accumulator + Number(item.amount ?? 0), 0),
    [loadedOpportunities, paginatedResponse?.totalAmount],
  );

  const sourceAnalytics = useMemo<CrmSourceMetric[]>(() => {
    const buckets = new Map<string, CrmSourceMetric>();

    for (const opportunity of analyticsQuery.data ?? []) {
      const source = (opportunity.source ?? "").trim() || "Sem origem";
      const metric = buckets.get(source) ?? {
        source,
        count: 0,
        totalAmount: 0,
        wonCount: 0,
        wonAmount: 0,
        conversionRate: 0,
      };
      const amount = Number(opportunity.amount ?? 0);
      const isWon = normalizeLegacyStage(opportunity.stage) === "won";
      metric.count += 1;
      metric.totalAmount += Number.isFinite(amount) ? amount : 0;
      if (isWon) {
        metric.wonCount += 1;
        metric.wonAmount += Number.isFinite(amount) ? amount : 0;
      }
      buckets.set(source, metric);
    }

    return Array.from(buckets.values())
      .map((metric) => ({
        ...metric,
        conversionRate: metric.count > 0 ? metric.wonCount / metric.count : 0,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return right.wonAmount - left.wonAmount;
      });
  }, [analyticsQuery.data]);

  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(
        (analyticsQuery.data ?? [])
          .map((opportunity) => (opportunity.source ?? "").trim())
          .filter((source) => source.length > 0),
      )).sort((left, right) => left.localeCompare(right)),
    [analyticsQuery.data],
  );
  const bestVolumeSource = sourceAnalytics[0] ?? null;
  const bestReturnSource = useMemo(
    () =>
      sourceAnalytics.reduce<CrmSourceMetric | null>((best, current) => {
        if (!best) return current;
        if (current.wonAmount !== best.wonAmount) return current.wonAmount > best.wonAmount ? current : best;
        return current.conversionRate > best.conversionRate ? current : best;
      }, null),
    [sourceAnalytics],
  );
  const maxSourceCount = Math.max(1, ...sourceAnalytics.map((metric) => metric.count));
  const maxSourceWonAmount = Math.max(1, ...sourceAnalytics.map((metric) => metric.wonAmount));
  const sourceChartData = useMemo(
    () =>
      sourceAnalytics.slice(0, 6).map((metric) => ({
        source: metric.source.length > 18 ? `${metric.source.slice(0, 18)}...` : metric.source,
        fullSource: metric.source,
        opportunities: metric.count,
        wonAmount: metric.wonAmount,
        conversionRate: metric.conversionRate,
      })),
    [sourceAnalytics],
  );

  const visibleOpportunities = loadedOpportunities;
  const totalOpportunityCount = paginatedResponse?.total ?? visibleOpportunities.length;
  const stageSummary = useMemo(
    () => {
      const stageCountRows = paginatedResponse?.stageCounts ?? null;
      return crmStages.map((stage) => {
        const apiStageCount = stageCountRows?.find((item) => normalizeLegacyStage(item.stage) === stage.value);
        if (apiStageCount) {
          return {
            stage,
            count: Number(apiStageCount.count ?? 0),
            amount: Number(apiStageCount.amount ?? 0),
          };
        }
        const items = visibleOpportunities.filter((opportunity) =>
          normalizeLegacyStage(opportunity.stage) === stage.value,
        );
        return {
          stage,
          count: items.length,
          amount: items.reduce((total, opportunity) => total + Number(opportunity.amount ?? 0), 0),
        };
      });
    },
    [crmStages, paginatedResponse?.stageCounts, visibleOpportunities],
  );
  const sortedOpportunities = useMemo(() => {
    if (paginatedResponse) return visibleOpportunities;

    const stageOrder = new Map(crmStages.map((stage, index) => [stage.value, index]));
    const alertPriority = (opportunity: CrmOpportunity) => {
      const summary = getOpportunityFollowUpSummary(opportunity);
      if (summary.overdueCount > 0) return 0;
      if (summary.dueTodayCount > 0) return 1;
      if (summary.nextFollowUp) return 2;
      return 3;
    };

    return [...visibleOpportunities].sort((left, right) => {
      const leftPriority = alertPriority(left);
      const rightPriority = alertPriority(right);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftStage = stageOrder.get(normalizeLegacyStage(left.stage)) ?? 999;
      const rightStage = stageOrder.get(normalizeLegacyStage(right.stage)) ?? 999;
      if (leftStage !== rightStage) return leftStage - rightStage;

      const leftDate = left.expectedCloseDate || "9999-12-31";
      const rightDate = right.expectedCloseDate || "9999-12-31";
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

      return Number(right.id) - Number(left.id);
    });
  }, [crmStages, paginatedResponse, visibleOpportunities]);
  const totalPages = paginatedResponse?.totalPages ?? Math.max(1, Math.ceil(sortedOpportunities.length / pageSize));
  const normalizedPage = paginatedResponse?.page ?? Math.min(currentPage, totalPages);
  const effectivePageSize = paginatedResponse?.pageSize ?? pageSize;
  const pageStart = (normalizedPage - 1) * effectivePageSize;
  const paginatedOpportunities = paginatedResponse
    ? sortedOpportunities
    : sortedOpportunities.slice(pageStart, pageStart + pageSize);
  const pageStartDisplay = totalOpportunityCount === 0 ? 0 : pageStart + 1;
  const pageEnd = Math.min(pageStart + paginatedOpportunities.length, totalOpportunityCount);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const hasCrmFilters =
    search.trim().length > 0
    || stageFilter !== "all"
    || sourceFilter !== "all"
    || ownerFilter !== "all"
    || followUpFilter !== "all"
    || expectedCloseFrom.length > 0
    || expectedCloseTo.length > 0;

  const clearCrmFilters = () => {
    setSearch("");
    setStageFilter("all");
    setSourceFilter("all");
    setOwnerFilter("all");
    setFollowUpFilter("all");
    setExpectedCloseFrom("");
    setExpectedCloseTo("");
  };

  const invalidateCrm = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/stages"] });
  };

  const createOpportunity = useMutation({
    mutationFn: async (data: z.infer<typeof opportunitySchema>) => {
      if (!scopedOrganizationId) {
        throw new Error("Selecione uma organização para continuar.");
      }
      return fetchJsonOrThrow("/api/crm/opportunities", "Erro ao criar oportunidade.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: scopedOrganizationId,
          title: data.title,
          contactName: asNullableText(data.contactName),
          contactPhone: asNullableText(data.contactPhone),
          contactEmail: asNullableText(data.contactEmail),
          source: asNullableText(data.source),
          stage: data.stage,
          amount: Number(data.amount ?? 0),
          expectedCloseDate: asNullableText(data.expectedCloseDate),
          ownerStaffId: data.ownerStaffId ?? null,
          notes: asNullableText(data.notes),
          lostReason: stageUsesLostReason(data.stage) ? asNullableText(data.lostReason) : null,
        }),
      });
    },
    onSuccess: () => {
      invalidateCrm();
      setDialogOpen(false);
      setEditingOpportunity(null);
      form.reset();
      toast({ title: "Oportunidade criada" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const updateOpportunity = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof opportunitySchema> }) => {
      if (!scopedOrganizationId) {
        throw new Error("Selecione uma organização para continuar.");
      }
      return fetchJsonOrThrow(`/api/crm/opportunities/${id}`, "Erro ao atualizar oportunidade.", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: scopedOrganizationId,
          title: data.title,
          contactName: asNullableText(data.contactName),
          contactPhone: asNullableText(data.contactPhone),
          contactEmail: asNullableText(data.contactEmail),
          source: asNullableText(data.source),
          stage: data.stage,
          amount: Number(data.amount ?? 0),
          expectedCloseDate: asNullableText(data.expectedCloseDate),
          ownerStaffId: data.ownerStaffId ?? null,
          notes: asNullableText(data.notes),
          lostReason: stageUsesLostReason(data.stage) ? asNullableText(data.lostReason) : null,
        }),
      });
    },
    onSuccess: () => {
      invalidateCrm();
      setDialogOpen(false);
      setEditingOpportunity(null);
      form.reset();
      toast({ title: "Oportunidade atualizada" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const moveOpportunity = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: string }) => {
      if (!scopedOrganizationId) throw new Error("Selecione uma organização para continuar.");
      return fetchJsonOrThrow(`/api/crm/opportunities/${id}/stage`, "Erro ao mover oportunidade.", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: scopedOrganizationId, stage }),
      });
    },
    onSuccess: () => {
      invalidateCrm();
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const deleteOpportunity = useMutation({
    mutationFn: async (id: number) => {
      if (!scopedOrganizationId) throw new Error("Selecione uma organização para continuar.");
      return fetchJsonOrThrow(
        buildCrmUrl(`/api/crm/opportunities/${id}`, { organizationId: scopedOrganizationId }),
        "Erro ao excluir oportunidade.",
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      invalidateCrm();
      toast({ title: "Oportunidade removida" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const saveFollowUps = useMutation({
    mutationFn: async ({ id, tasks }: { id: number; tasks: CrmFollowUpTask[] }) => {
      if (!scopedOrganizationId) throw new Error("Selecione uma organização para continuar.");
      return fetchJsonOrThrow(`/api/crm/opportunities/${id}/follow-ups`, "Erro ao salvar follow-ups.", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: scopedOrganizationId,
          followUpTasks: tasks,
        }),
      });
    },
    onSuccess: () => {
      invalidateCrm();
      toast({ title: "Follow-ups atualizados" });
      setFollowUpDialogOpen(false);
      setFollowUpOpportunity(null);
      setFollowUpTasksDraft([]);
      setNewFollowUpTitle("");
      setNewFollowUpDueDate(todayDateKey());
      setNewFollowUpAssignee("");
      setNewFollowUpNotes("");
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const saveStages = useMutation({
    mutationFn: async (stages: Array<{ value: string; label: string; color: string }>) => {
      if (!scopedOrganizationId) throw new Error("Selecione uma organização para continuar.");
      try {
        return await fetchJsonOrThrow("/api/crm/stages", "Erro ao salvar etapas do CRM.", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: scopedOrganizationId,
            stages,
          }),
        }) as CrmStagesApiResponse;
      } catch (error) {
        if (
          error instanceof Error
          && error.message.includes("Resposta inválida do servidor")
        ) {
          throw new Error("API do CRM ainda não foi atualizada no servidor. Reinicie e atualize o backend.");
        }
        throw error;
      }
    },
    onSuccess: (payload) => {
      invalidateCrm();
      setStagesDialogOpen(false);
      setStagesDraft([]);
      setNewStageLabel("");
      setDraggingStageIndex(null);
      setDragOverStageIndex(null);
      const migratedCount = Number(payload?.migratedCount ?? 0);
      if (migratedCount > 0) {
        toast({
          title: "Etapas atualizadas",
          description: `${migratedCount} oportunidade(s) migrada(s) para a nova etapa inicial.`,
        });
      } else {
        toast({ title: "Etapas atualizadas" });
      }
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const buildUniqueStageValue = (label: string, currentStages: CrmStagePayload[]): string => {
    const base = toStageKey(label).slice(0, 40) || `etapa_${currentStages.length + 1}`;
    const used = new Set(currentStages.map((stage) => stage.value.toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    let count = 2;
    while (count < 999) {
      const suffix = `_${count}`;
      const candidate = `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
      if (!used.has(candidate.toLowerCase())) return candidate;
      count++;
    }
    return `${base.slice(0, 36)}_${Date.now().toString().slice(-3)}`;
  };

  const openStagesDialog = () => {
    setStagesDraft(crmStages.map((stage) => ({ value: stage.value, label: stage.label, color: stage.color })));
    setNewStageLabel("");
    setDraggingStageIndex(null);
    setDragOverStageIndex(null);
    setStagesDialogOpen(true);
  };

  const updateStageDraftLabel = (index: number, label: string) => {
    setStagesDraft((current) =>
      current.map((stage, currentIndex) => (
        currentIndex === index
          ? { ...stage, label }
          : stage
      )),
    );
  };
  const updateStageDraftColor = (index: number, color: string) => {
    setStagesDraft((current) =>
      current.map((stage, currentIndex) => {
        if (currentIndex !== index) return stage;
        return {
          ...stage,
          color: normalizeStageColor(color, resolveDefaultStageColor(stage.value, index)),
        };
      }),
    );
  };

  const moveStageDraft = (index: number, direction: "up" | "down") => {
    setStagesDraft((current) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const removeStageDraft = (index: number) => {
    setStagesDraft((current) => {
      if (current.length <= 1) return current;
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  };

  const addStageDraft = () => {
    const label = newStageLabel.trim();
    if (!label) {
      toast({ variant: "destructive", title: "Informe o nome da etapa." });
      return;
    }
    if (stagesDraft.length >= 20) {
      toast({ variant: "destructive", title: "Limite de 20 etapas atingido." });
      return;
    }
    setStagesDraft((current) => {
      const value = buildUniqueStageValue(label, current);
      const color = resolveDefaultStageColor(value, current.length);
      return [...current, { value, label, color }];
    });
    setNewStageLabel("");
  };
  const reorderStageDraft = (fromIndex: number, toIndex: number) => {
    setStagesDraft((current) => {
      if (fromIndex < 0 || fromIndex >= current.length) return current;
      if (toIndex < 0 || toIndex >= current.length) return current;
      if (fromIndex === toIndex) return current;
      const next = [...current];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  };
  const onStageDragStart = (index: number) => {
    setDraggingStageIndex(index);
    setDragOverStageIndex(index);
  };
  const onStageDragEnter = (index: number) => {
    if (draggingStageIndex === null) return;
    if (dragOverStageIndex === index) return;
    setDragOverStageIndex(index);
  };
  const onStageDrop = (index: number) => {
    if (draggingStageIndex === null) return;
    reorderStageDraft(draggingStageIndex, index);
    setDraggingStageIndex(null);
    setDragOverStageIndex(null);
  };
  const onStageDragEnd = () => {
    setDraggingStageIndex(null);
    setDragOverStageIndex(null);
  };

  const openCreateDialog = () => {
    setEditingOpportunity(null);
    form.reset({
      title: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      source: "",
      stage: defaultStageValue,
      amount: 0,
      expectedCloseDate: "",
      ownerStaffId: null,
      notes: "",
      lostReason: "",
    });
    setDialogOpen(true);
  };

  const openEditDialog = (opportunity: CrmOpportunity) => {
    setEditingOpportunity(opportunity);
    form.reset({
      title: opportunity.title,
      contactName: opportunity.contactName ?? "",
      contactPhone: opportunity.contactPhone ?? "",
      contactEmail: opportunity.contactEmail ?? "",
      source: opportunity.source ?? "",
      stage: stageValues.includes(normalizeLegacyStage(opportunity.stage))
        ? normalizeLegacyStage(opportunity.stage)
        : defaultStageValue,
      amount: Number(opportunity.amount ?? 0),
      expectedCloseDate: opportunity.expectedCloseDate ?? "",
      ownerStaffId: opportunity.ownerStaffId ?? null,
      notes: opportunity.notes ?? "",
      lostReason: opportunity.lostReason ?? "",
    });
    setDialogOpen(true);
  };

  const openFollowUpDialog = (opportunity: CrmOpportunity) => {
    setFollowUpOpportunity(opportunity);
    setFollowUpTasksDraft(sortFollowUpTasks(parseCrmFollowUpTasks(opportunity.followUpTasks)));
    setNewFollowUpTitle("");
    setNewFollowUpDueDate(todayDateKey());
    setNewFollowUpAssignee("");
    setNewFollowUpNotes("");
    setFollowUpDialogOpen(true);
  };

  const openProposalDialog = (opportunity: CrmOpportunity) => {
    setProposalOpportunity(opportunity);
    setProposalPreset("ilpi");
    setSelectedProposalItemIds(PROPOSAL_PRESETS.ilpi.itemIds);
    setProposalValidityDays(7);
    setProposalPaymentTerms("Mensalidade com vencimento a combinar. Valores sujeitos a ajuste apos avaliacao inicial e definicao final do plano.");
    setProposalExtraNotes(opportunity.notes ?? "");
    setProposalDialogOpen(true);
  };

  const toggleProposalItem = (itemId: string, checked: boolean) => {
    setProposalPreset("custom");
    setSelectedProposalItemIds((current) => {
      if (checked) {
        return current.includes(itemId) ? current : [...current, itemId];
      }
      return current.filter((id) => id !== itemId);
    });
  };

  const printProposalDocument = (
    opportunity: CrmOpportunity,
    config?: {
      offerItems?: ProposalOfferItem[];
      validityDays?: number;
      paymentTerms?: string;
      extraNotes?: string;
    },
  ) => {
    const generatedAt = new Date().toLocaleString("pt-BR");
    const expectedClose = opportunity.expectedCloseDate
      ? formatDateKeyPtBr(opportunity.expectedCloseDate)
      : "-";
    const offerItems = config?.offerItems?.length
      ? config.offerItems
      : PROPOSAL_OFFER_ITEMS.filter((item) => PROPOSAL_PRESETS.ilpi.itemIds.includes(item.id));
    const offerItemsHtml = offerItems.map((item) => `
      <li>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.description)}</span>
      </li>
    `).join("");
    const commercialNotes = (config?.extraNotes ?? opportunity.notes ?? "").trim();
    const paymentTerms = (config?.paymentTerms ?? "").trim();
    const validityDays = Math.max(1, Math.min(90, Number(config?.validityDays ?? 7) || 7));
    const printed = printHtmlDocument(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Proposta - ${escapeHtml(opportunity.title)}</title>
          <style>
            body { margin: 28px; color: #111827; font-family: Arial, sans-serif; line-height: 1.55; }
            header { border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 22px; }
            h1 { margin: 0; font-size: 22px; }
            h2 { margin: 22px 0 10px; font-size: 15px; }
            p { margin: 0 0 10px; font-size: 13px; }
            .muted { color: #6b7280; font-size: 12px; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; margin-bottom: 18px; font-size: 12px; }
            .box { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; margin: 14px 0; }
            .value { font-size: 18px; font-weight: 700; }
            .hero { background: #f8fafc; border: 1px solid #dbe4ef; border-radius: 10px; padding: 14px; margin: 14px 0 18px; }
            ul { margin: 8px 0 0; padding-left: 18px; }
            li { margin-bottom: 10px; font-size: 12px; }
            li strong { display: block; color: #111827; }
            li span { color: #4b5563; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 12px; }
            th { background: #f3f4f6; color: #374151; text-align: left; }
            th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
            .signature { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; margin-top: 56px; font-size: 12px; }
            .line { border-top: 1px solid #111827; padding-top: 8px; text-align: center; }
            @media print { body { margin: 18mm; } }
          </style>
        </head>
        <body>
          <header>
            <h1>Proposta Comercial</h1>
            <p class="muted">${escapeHtml(user?.organizationName ?? "EasyCare")} - gerada em ${escapeHtml(generatedAt)}</p>
          </header>

          <section class="hero">
            <h2>Resumo da proposta</h2>
            <p>Esta proposta apresenta uma solucao assistencial configurada conforme as necessidades informadas pelo cliente e os itens selecionados no CRM.</p>
          </section>

          <h2>Cliente / oportunidade</h2>
          <div class="grid">
            <div><strong>Titulo:</strong> ${escapeHtml(opportunity.title)}</div>
            <div><strong>Etapa:</strong> ${escapeHtml(stageLabel(opportunity.stage, crmStages))}</div>
            <div><strong>Contato:</strong> ${escapeHtml(opportunity.contactName || "-")}</div>
            <div><strong>Telefone:</strong> ${escapeHtml(opportunity.contactPhone || "-")}</div>
            <div><strong>E-mail:</strong> ${escapeHtml(opportunity.contactEmail || "-")}</div>
            <div><strong>Origem:</strong> ${escapeHtml(opportunity.source || "-")}</div>
            <div><strong>Responsável:</strong> ${escapeHtml(opportunity.ownerStaffName || opportunity.ownerName || "-")}</div>
            <div><strong>Previsão:</strong> ${escapeHtml(expectedClose)}</div>
          </div>

          <div class="box">
            <p class="muted">Valor estimado</p>
            <p class="value">${escapeHtml(formatCurrencyBRL(opportunity.amount))}</p>
          </div>

          <h2>Itens inclusos</h2>
          <div class="box">
            <ul>${offerItemsHtml}</ul>
          </div>

          <h2>Condicoes comerciais</h2>
          <table>
            <tbody>
              <tr>
                <th>Investimento estimado</th>
                <td>${escapeHtml(formatCurrencyBRL(opportunity.amount))}</td>
              </tr>
              <tr>
                <th>Validade da proposta</th>
                <td>${escapeHtml(String(validityDays))} dia(s)</td>
              </tr>
              <tr>
                <th>Forma de pagamento</th>
                <td>${escapeHtml(paymentTerms || "A combinar.")}</td>
              </tr>
            </tbody>
          </table>

          <h2>Observações e alinhamentos</h2>
          <div class="box">
            <p>${escapeHtml(commercialNotes || "Proposta de servicos assistenciais conforme necessidades alinhadas com o cliente.")}</p>
            <p>Os detalhes finais de plano, vigencia, equipe, rotina e condicoes comerciais devem ser confirmados antes da assinatura do contrato.</p>
          </div>

          <h2>Próximos passos</h2>
          <div class="box">
            <p>1. Validacao da proposta pelo cliente.</p>
            <p>2. Confirma??o dos dados do paciente e respons?veis.</p>
            <p>3. Definição da data de início e formalização contratual.</p>
          </div>

          <h2>Assinaturas</h2>
          <div class="signature">
            <div class="line">Cliente</div>
            <div class="line">Representante comercial</div>
          </div>

        </body>
      </html>
    `);
    if (!printed) {
      toast({ variant: "destructive", title: "Não foi possível gerar a proposta." });
    }
  };

  const generateSelectedProposal = () => {
    if (!proposalOpportunity) return;
    const offerItems = PROPOSAL_OFFER_ITEMS.filter((item) => selectedProposalItemIds.includes(item.id));
    if (offerItems.length === 0) {
      toast({ variant: "destructive", title: "Selecione ao menos um item da proposta." });
      return;
    }
    printProposalDocument(proposalOpportunity, {
      offerItems,
      validityDays: proposalValidityDays,
      paymentTerms: proposalPaymentTerms,
      extraNotes: proposalExtraNotes,
    });
    setProposalDialogOpen(false);
  };

  const handleAddFollowUpTask = () => {
    const title = newFollowUpTitle.trim();
    const dueDate = normalizeDateKey(newFollowUpDueDate);
    if (!title) {
      toast({ variant: "destructive", title: "Informe o titulo da tarefa." });
      return;
    }
    if (!dueDate) {
      toast({ variant: "destructive", title: "Informe uma data valida para o lembrete." });
      return;
    }
    const nowIso = new Date().toISOString();
    const newTask: CrmFollowUpTask = {
      id: `fu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      dueDate,
      done: false,
      notes: newFollowUpNotes.trim() ? newFollowUpNotes.trim() : null,
      assigneeName: newFollowUpAssignee.trim() ? newFollowUpAssignee.trim() : null,
      createdAt: nowIso,
      completedAt: null,
    };
    setFollowUpTasksDraft((prev) => sortFollowUpTasks([...prev, newTask]));
    setNewFollowUpTitle("");
    setNewFollowUpDueDate(todayDateKey());
    setNewFollowUpAssignee("");
    setNewFollowUpNotes("");
  };

  const toggleFollowUpTaskDone = (taskId: string) => {
    setFollowUpTasksDraft((prev) =>
      sortFollowUpTasks(
        prev.map((task) =>
          task.id !== taskId
            ? task
            : {
                ...task,
                done: !task.done,
                completedAt: task.done ? null : new Date().toISOString(),
              },
        ),
      ),
    );
  };

  const removeFollowUpTask = (taskId: string) => {
    setFollowUpTasksDraft((prev) => prev.filter((task) => task.id !== taskId));
  };

  const handleDropOnStage = (stage: string) => {
    if (!draggingOpportunityId) return;
    moveOpportunity.mutate({ id: draggingOpportunityId, stage });
    setDraggingOpportunityId(null);
  };

  const renderOpportunityList = () => (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base">Oportunidades</CardTitle>
            <CardDescription>
              {totalOpportunityCount} resultado(s) | Total {formatCurrencyBRL(totalAmount)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {stageSummary.map((item) => (
              <Badge key={item.stage.value} variant="outline" style={item.stage.badgeStyle}>
                {item.stage.label}: {item.count}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {totalOpportunityCount === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
            Nenhuma oportunidade encontrada.
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {paginatedOpportunities.map((opportunity) => {
                const followUpSummary = getOpportunityFollowUpSummary(opportunity);
                return (
                  <div key={opportunity.id} className={`rounded-lg border bg-background p-3 ${followUpSummary.hasAlert ? "border-red-300" : "border-border"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{opportunity.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{opportunity.contactName || "Sem contato"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{opportunity.source || "Sem origem"}</p>
                        <p className="text-xs text-muted-foreground">{opportunity.ownerStaffName || opportunity.ownerName || "Sem responsável"}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-foreground">{formatCurrencyBRL(opportunity.amount)}</p>
                    </div>

                    <div className="mt-3 grid gap-2">
                      <Select
                        value={stageValues.includes(normalizeLegacyStage(opportunity.stage))
                          ? normalizeLegacyStage(opportunity.stage)
                          : defaultStageValue}
                        onValueChange={(nextStage) => {
                          if (nextStage === normalizeLegacyStage(opportunity.stage)) return;
                          moveOpportunity.mutate({ id: opportunity.id, stage: nextStage });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue>{stageLabel(opportunity.stage, crmStages)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {crmStages.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                          <Clock3 className="h-3 w-3" />
                          {followUpSummary.pendingFollowUps.length} pendente(s)
                        </span>
                        {followUpSummary.overdueCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
                            <AlertCircle className="h-3 w-3" />
                            {followUpSummary.overdueCount} atrasado(s)
                          </span>
                        ) : null}
                        {followUpSummary.dueTodayCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                            <Clock3 className="h-3 w-3" />
                            {followUpSummary.dueTodayCount} hoje
                          </span>
                        ) : null}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {followUpSummary.nextFollowUp
                          ? `Proximo: ${formatDateKeyPtBr(followUpSummary.nextFollowUp.dueDate)} - ${followUpSummary.nextFollowUp.title}`
                          : "Sem follow-up agendado."}
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openProposalDialog(opportunity)}>
                        <FileText className="mr-1 h-3.5 w-3.5" />
                        Proposta
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openFollowUpDialog(opportunity)}>
                        Follow-up
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openEditDialog(opportunity)}>
                        Editar
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteOpportunity.mutate(opportunity.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-hidden rounded-lg border border-border md:block">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Oportunidade</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Follow-up</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Previsão</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedOpportunities.map((opportunity) => {
                    const followUpSummary = getOpportunityFollowUpSummary(opportunity);
                    return (
                      <TableRow key={opportunity.id} className={followUpSummary.hasAlert ? "bg-red-50/40" : undefined}>
                        <TableCell className="max-w-[280px]">
                          <p className="truncate text-sm font-semibold text-foreground">{opportunity.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{opportunity.contactName || "Sem contato"}</p>
                          {opportunity.contactPhone || opportunity.contactEmail ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {[opportunity.contactPhone, opportunity.contactEmail].filter(Boolean).join(" | ")}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{opportunity.source || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{opportunity.ownerStaffName || opportunity.ownerName || "-"}</TableCell>
                        <TableCell className="min-w-[170px]">
                          <Select
                            value={stageValues.includes(normalizeLegacyStage(opportunity.stage))
                              ? normalizeLegacyStage(opportunity.stage)
                              : defaultStageValue}
                            onValueChange={(nextStage) => {
                              if (nextStage === normalizeLegacyStage(opportunity.stage)) return;
                              moveOpportunity.mutate({ id: opportunity.id, stage: nextStage });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue>{stageLabel(opportunity.stage, crmStages)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {crmStages.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <div className="flex flex-wrap gap-1">
                            {followUpSummary.overdueCount > 0 ? (
                              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                                {followUpSummary.overdueCount} atrasado(s)
                              </Badge>
                            ) : null}
                            {followUpSummary.dueTodayCount > 0 ? (
                              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                {followUpSummary.dueTodayCount} hoje
                              </Badge>
                            ) : null}
                            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                              {followUpSummary.pendingFollowUps.length} pendente(s)
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {followUpSummary.nextFollowUp
                              ? `${formatDateKeyPtBr(followUpSummary.nextFollowUp.dueDate)} - ${followUpSummary.nextFollowUp.title}`
                              : "Sem follow-up"}
                          </p>
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">
                          {formatCurrencyBRL(opportunity.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {opportunity.expectedCloseDate ? formatDateKeyPtBr(opportunity.expectedCloseDate) : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openProposalDialog(opportunity)}>
                              <FileText className="mr-1 h-3.5 w-3.5" />
                              Proposta
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openFollowUpDialog(opportunity)}>
                              Follow-up
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => openEditDialog(opportunity)}>
                              Editar
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteOpportunity.mutate(opportunity.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Mostrando {pageStartDisplay} a {pageEnd} de {totalOpportunityCount}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                  <SelectTrigger className="h-8 w-[118px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 por pagina</SelectItem>
                    <SelectItem value="20">20 por pagina</SelectItem>
                    <SelectItem value="50">50 por pagina</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  disabled={normalizedPage <= 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  {normalizedPage} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  disabled={normalizedPage >= totalPages}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                >
                  Proxima
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );

  const renderCrmAnalytics = () => {
    if (!scopedOrganizationId) return null;

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Analitico por canal</CardTitle>
              <CardDescription>Origem das oportunidades e retorno comercial.</CardDescription>
            </div>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {analyticsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando analitico...</p>
          ) : sourceAnalytics.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem oportunidades com origem para analisar.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Mais oportunidades</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{bestVolumeSource?.source ?? "-"}</p>
                  <p className="text-xs text-muted-foreground">{bestVolumeSource?.count ?? 0} oportunidade(s)</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Melhor retorno</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{bestReturnSource?.source ?? "-"}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrencyBRL(bestReturnSource?.wonAmount ?? 0)} ganho(s)</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Conversao do melhor retorno</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{formatPercent(bestReturnSource?.conversionRate ?? 0)}</p>
                  <p className="text-xs text-muted-foreground">{bestReturnSource?.wonCount ?? 0} de {bestReturnSource?.count ?? 0} ganho(s)</p>
                </div>
              </div>

              <div className="h-64 rounded-lg border border-border bg-background p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceChartData} margin={{ top: 8, right: 12, left: -24, bottom: 12 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="source" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <RechartsTooltip
                      formatter={(value) => [String(value), "Oportunidades"]}
                      labelFormatter={(_, payload) => {
                        const item = payload?.[0]?.payload as { fullSource?: string; wonAmount?: number; conversionRate?: number } | undefined;
                        if (!item) return "";
                        return `${item.fullSource ?? ""} | Retorno ${formatCurrencyBRL(item.wonAmount ?? 0)} | Conversao ${formatPercent(item.conversionRate ?? 0)}`;
                      }}
                    />
                    <Bar dataKey="opportunities" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-3">
                {sourceAnalytics.slice(0, 8).map((metric) => (
                  <div key={metric.source} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-foreground">{metric.source}</span>
                      <span className="text-muted-foreground">
                        {metric.count} lead(s) | {formatCurrencyBRL(metric.wonAmount)} ganhos
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <div className="space-y-1">
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-sky-500"
                            style={{ width: `${Math.max(4, (metric.count / maxSourceCount) * 100)}%` }}
                          />
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-emerald-500"
                            style={{ width: `${Math.max(metric.wonAmount > 0 ? 4 : 0, (metric.wonAmount / maxSourceWonAmount) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-12 text-right text-xs text-muted-foreground">{formatPercent(metric.conversionRate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CRM</h1>
          <p className="text-sm text-muted-foreground">Oportunidades, follow-ups e analise de canais em uma visao simples.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={openStagesDialog}
            disabled={!scopedOrganizationId}
          >
            <Settings2 className="mr-1.5 h-4 w-4" />
            Configurar etapas
          </Button>
          <Button onClick={openCreateDialog} disabled={!scopedOrganizationId}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nova oportunidade
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>
            {totalOpportunityCount} oportunidade(s) | Total {formatCurrencyBRL(totalAmount)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {user?.isSuperAdmin ? (
            <div className="space-y-1">
              <Label>Organização</Label>
              <Select
                value={selectedOrganizationId ? String(selectedOrganizationId) : undefined}
                onValueChange={(value) => setSelectedOrganizationId(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a organização" />
                </SelectTrigger>
                <SelectContent>
                  {(organizationsQuery.data ?? []).map((organization) => (
                    <SelectItem key={organization.id} value={String(organization.id)}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-1">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Titulo, contato ou origem"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Etapa</Label>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as etapas</SelectItem>
                  {crmStages.map((stage) => (
                    <SelectItem key={stage.value} value={stage.value}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1">
              <Label>Origem</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as origens</SelectItem>
                  {sourceOptions.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Responsável da equipe</Label>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {(crmResponsiblesQuery.data ?? []).map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}{item.role ? ` - ${item.role}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Follow-up</Label>
              <Select value={followUpFilter} onValueChange={(value) => setFollowUpFilter(value as CrmFollowUpFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="overdue">Atrasados</SelectItem>
                  <SelectItem value="today">Vencem hoje</SelectItem>
                  <SelectItem value="pending">Com pendência</SelectItem>
                  <SelectItem value="none">Sem pendência</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Previsão de</Label>
              <Input
                type="date"
                value={expectedCloseFrom}
                onChange={(event) => setExpectedCloseFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Previsão ate</Label>
              <Input
                type="date"
                value={expectedCloseTo}
                onChange={(event) => setExpectedCloseTo(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label>Visualização</Label>
              <p className="text-xs text-muted-foreground">
                Use lista para volume e Kanban para acompanhar o funil.
              </p>
            </div>
            <ToggleGroup
              aria-label="Visualização do CRM"
              type="single"
              value={viewMode}
              onValueChange={(value) => {
                if (value === "list" || value === "kanban") setViewMode(value);
              }}
              className="justify-start rounded-lg border border-border bg-background p-1 sm:justify-center"
            >
              <ToggleGroupItem value="list" size="sm" className="gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <List className="h-4 w-4" />
                Lista
              </ToggleGroupItem>
              <ToggleGroupItem value="kanban" size="sm" className="gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <Columns3 className="h-4 w-4" />
                Kanban
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {hasCrmFilters ? (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={clearCrmFilters}>
                <FilterX className="mr-1.5 h-4 w-4" />
                Limpar filtros
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {false && scopedOrganizationId ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Analitico por canal</CardTitle>
                <CardDescription>Origem das oportunidades e retorno comercial.</CardDescription>
              </div>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {analyticsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando analitico...</p>
            ) : sourceAnalytics.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem oportunidades com origem para analisar.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Mais oportunidades</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{bestVolumeSource?.source ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">{bestVolumeSource?.count ?? 0} oportunidade(s)</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Melhor retorno</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{bestReturnSource?.source ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">{formatCurrencyBRL(bestReturnSource?.wonAmount ?? 0)} ganho(s)</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Conversao do melhor retorno</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{formatPercent(bestReturnSource?.conversionRate ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">{bestReturnSource?.wonCount ?? 0} de {bestReturnSource?.count ?? 0} ganho(s)</p>
                  </div>
                </div>

                <div className="h-64 rounded-lg border border-border bg-background p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sourceChartData} margin={{ top: 8, right: 12, left: -24, bottom: 12 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="source" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <RechartsTooltip
                        formatter={(value) => [String(value), "Oportunidades"]}
                        labelFormatter={(_, payload) => {
                          const item = payload?.[0]?.payload as { fullSource?: string; wonAmount?: number; conversionRate?: number } | undefined;
                          if (!item) return "";
                          return `${item.fullSource ?? ""} | Retorno ${formatCurrencyBRL(item.wonAmount ?? 0)} | Conversao ${formatPercent(item.conversionRate ?? 0)}`;
                        }}
                      />
                      <Bar dataKey="opportunities" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-3">
                  {sourceAnalytics.slice(0, 8).map((metric) => (
                    <div key={metric.source} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-foreground">{metric.source}</span>
                        <span className="text-muted-foreground">
                          {metric.count} lead(s) · {formatCurrencyBRL(metric.wonAmount)} ganhos
                        </span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <div className="space-y-1">
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-sky-500"
                              style={{ width: `${Math.max(4, (metric.count / maxSourceCount) * 100)}%` }}
                            />
                          </div>
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-emerald-500"
                              style={{ width: `${Math.max(metric.wonAmount > 0 ? 4 : 0, (metric.wonAmount / maxSourceWonAmount) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-12 text-right text-xs text-muted-foreground">{formatPercent(metric.conversionRate)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!scopedOrganizationId ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Selecione uma organização para carregar o CRM.
          </CardContent>
        </Card>
      ) : stagesQuery.isLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">Carregando etapas do Kanban...</CardContent>
        </Card>
      ) : stagesQuery.error ? (
        <Card>
          <CardContent className="py-8 text-sm text-destructive">
            {stagesQuery.error instanceof Error
              ? stagesQuery.error.message
              : "Erro ao carregar etapas do CRM."}
          </CardContent>
        </Card>
      ) : opportunitiesQuery.isLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">Carregando funil...</CardContent>
        </Card>
      ) : opportunitiesQuery.error ? (
        <Card>
          <CardContent className="py-8 text-sm text-destructive">
            {opportunitiesQuery.error instanceof Error
              ? opportunitiesQuery.error.message
              : "Erro ao carregar CRM."}
          </CardContent>
        </Card>
      ) : viewMode === "kanban" ? null : renderOpportunityList()}

      {viewMode === "kanban"
      && scopedOrganizationId
      && !stagesQuery.isLoading
      && !stagesQuery.error
      && !opportunitiesQuery.isLoading
      && !opportunitiesQuery.error ? (
        <div className={`grid grid-cols-1 gap-3 ${crmStages.length <= 3 ? "xl:grid-cols-3" : "xl:grid-cols-3 2xl:grid-cols-6"}`}>
          {crmStages.map((stage) => {
            const stageItems = grouped[stage.value] ?? [];
            return (
              <Card
                key={stage.value}
                className="min-h-[280px]"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDropOnStage(stage.value);
                }}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm">{stage.label}</CardTitle>
                    <Badge variant="outline" className="border" style={stage.badgeStyle}>
                      {stageItems.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stageItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      Sem oportunidades
                    </div>
                  ) : (
                    stageItems.map((opportunity) => {
                      const followUpTasks = parseCrmFollowUpTasks(opportunity.followUpTasks);
                      const pendingFollowUps = followUpTasks.filter((task) => !task.done);
                      const currentDateKey = todayDateKey();
                      const overdueCount = pendingFollowUps.filter((task) => task.dueDate < currentDateKey).length;
                      const dueTodayCount = pendingFollowUps.filter((task) => task.dueDate === currentDateKey).length;
                      const nextFollowUp = sortFollowUpTasks(pendingFollowUps)[0];
                      const hasFollowUpAlert = overdueCount > 0 || dueTodayCount > 0;

                      return (
                        <div
                          key={opportunity.id}
                          className={`rounded-lg border bg-background p-3 space-y-2 ${hasFollowUpAlert ? "border-red-300" : "border-border"}`}
                          draggable
                          onDragStart={() => setDraggingOpportunityId(opportunity.id)}
                          onDragEnd={() => setDraggingOpportunityId(null)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{opportunity.title}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {opportunity.contactName || "Sem contato"}
                              </p>
                            </div>
                            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </div>

                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <DollarSign className="h-3.5 w-3.5" />
                            <span>{formatCurrencyBRL(opportunity.amount)}</span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                              <Clock3 className="h-3 w-3" />
                              {pendingFollowUps.length} pendente(s)
                            </span>
                            {overdueCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
                                <AlertCircle className="h-3 w-3" />
                                {overdueCount} atrasado(s)
                              </span>
                            ) : null}
                            {dueTodayCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                                <Clock3 className="h-3 w-3" />
                                {dueTodayCount} vence(m) hoje
                              </span>
                            ) : null}
                          </div>

                          {nextFollowUp ? (
                            <p className="text-[11px] text-muted-foreground">
                              Próximo: {formatDateKeyPtBr(nextFollowUp.dueDate)} - {nextFollowUp.title}
                            </p>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">Sem follow-up agendado.</p>
                          )}

                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Mover para</Label>
                            <Select
                              value={stageValues.includes(normalizeLegacyStage(opportunity.stage))
                                ? normalizeLegacyStage(opportunity.stage)
                                : defaultStageValue}
                              onValueChange={(nextStage) => {
                                if (nextStage === normalizeLegacyStage(opportunity.stage)) return;
                                moveOpportunity.mutate({ id: opportunity.id, stage: nextStage });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue>{stageLabel(opportunity.stage, crmStages)}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {crmStages.map((item) => (
                                  <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <Button size="sm" variant="outline" className="h-8 min-w-0 px-2 text-xs" onClick={() => openProposalDialog(opportunity)}>
                              <FileText className="mr-1 h-3.5 w-3.5" />
                              Proposta
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 min-w-0 px-2 text-xs" onClick={() => openFollowUpDialog(opportunity)}>
                              Follow-up
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 min-w-0 px-2 text-xs" onClick={() => openEditDialog(opportunity)}>
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 min-w-0 px-2 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteOpportunity.mutate(opportunity.id)}
                              aria-label="Excluir oportunidade"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {renderCrmAnalytics()}

      <Dialog
        open={stagesDialogOpen}
        onOpenChange={(open) => {
          setStagesDialogOpen(open);
          if (!open) {
            setStagesDraft([]);
            setNewStageLabel("");
            setDraggingStageIndex(null);
            setDragOverStageIndex(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurar etapas do Kanban</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Edite nomes, cores, arraste para reordenar e crie novas colunas para o funil desta organização.
            </p>

            <div className="space-y-2">
              {stagesDraft.map((stage, index) => (
                <div
                  key={stage.value}
                  className={`rounded-lg border p-2 transition-colors ${dragOverStageIndex === index ? "border-primary" : "border-border"}`}
                  draggable
                  onDragStart={() => onStageDragStart(index)}
                  onDragEnter={() => onStageDragEnter(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => onStageDrop(index)}
                  onDragEnd={onStageDragEnd}
                >
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_100px_120px_auto] sm:items-center">
                    <div
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground"
                      title="Arraste para reordenar"
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <Input
                      value={stage.label}
                      onChange={(event) => updateStageDraftLabel(index, event.target.value)}
                      placeholder="Nome da etapa"
                    />
                    <Input
                      type="color"
                      value={normalizeStageColor(stage.color, resolveDefaultStageColor(stage.value, index))}
                      onChange={(event) => updateStageDraftColor(index, event.target.value)}
                      className="h-9 w-full p-1"
                      title="Cor da etapa"
                    />
                    <span
                      className="truncate rounded border px-2 py-1 text-xs"
                      style={buildStageChipStyle(normalizeStageColor(stage.color, resolveDefaultStageColor(stage.value, index)))}
                    >
                      {stage.value}
                    </span>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        onClick={() => moveStageDraft(index, "up")}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        onClick={() => moveStageDraft(index, "down")}
                        disabled={index === stagesDraft.length - 1}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeStageDraft(index)}
                        disabled={stagesDraft.length <= 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
              <Label>Nova etapa</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={newStageLabel}
                  onChange={(event) => setNewStageLabel(event.target.value)}
                  placeholder="Ex: Visita agendada"
                />
                <Button type="button" variant="outline" onClick={addStageDraft}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Adicionar
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setStagesDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={saveStages.isPending}
                onClick={() => {
                  const hasEmptyLabel = stagesDraft.some((stage) => stage.label.trim().length === 0);
                  if (hasEmptyLabel) {
                    toast({ variant: "destructive", title: "Nenhuma etapa pode ficar com nome vazio." });
                    return;
                  }
                  const normalizedStages = stagesDraft
                    .map((stage, index) => ({
                      value: stage.value,
                      label: stage.label.trim(),
                      color: normalizeStageColor(stage.color, resolveDefaultStageColor(stage.value, index)),
                    }))
                    .filter((stage) => stage.value && stage.label);
                  if (normalizedStages.length === 0) {
                    toast({ variant: "destructive", title: "Informe ao menos uma etapa valida." });
                    return;
                  }
                  saveStages.mutate(normalizedStages);
                }}
              >
                Salvar etapas
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={proposalDialogOpen} onOpenChange={setProposalDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Montar proposta comercial</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {proposalOpportunity ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-sm font-semibold text-foreground">{proposalOpportunity.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[proposalOpportunity.contactName, proposalOpportunity.contactPhone, proposalOpportunity.contactEmail]
                    .filter(Boolean)
                    .join(" | ") || "Sem contato informado"}
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{formatCurrencyBRL(proposalOpportunity.amount)}</p>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-2">
                <Label>Modelo</Label>
                <Select
                  value={proposalPreset}
                  onValueChange={(value) => {
                    const presetKey = value as ProposalPresetKey;
                    setProposalPreset(presetKey);
                    if (presetKey !== "custom") {
                      setSelectedProposalItemIds(PROPOSAL_PRESETS[presetKey].itemIds);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROPOSAL_PRESETS).map(([key, preset]) => (
                      <SelectItem key={key} value={key}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Use um modelo pronto e ajuste os itens antes de gerar o PDF.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Itens inclusos na proposta</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PROPOSAL_OFFER_ITEMS.map((item) => {
                    const checked = selectedProposalItemIds.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className="flex cursor-pointer gap-3 rounded-lg border border-border bg-background p-3 text-sm transition hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleProposalItem(item.id, value === true)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{item.title}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
              <div className="space-y-2">
                <Label>Validade</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={proposalValidityDays}
                  onChange={(event) => setProposalValidityDays(Number(event.target.value || 7))}
                />
                <p className="text-xs text-muted-foreground">Dias.</p>
              </div>
              <div className="space-y-2">
                <Label>Condicoes de pagamento</Label>
                <Textarea
                  rows={3}
                  value={proposalPaymentTerms}
                  onChange={(event) => setProposalPaymentTerms(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observações comerciais</Label>
              <Textarea
                rows={4}
                value={proposalExtraNotes}
                onChange={(event) => setProposalExtraNotes(event.target.value)}
                placeholder="Use este campo para observações da negociacao, condicoes especiais ou detalhes do atendimento."
              />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setProposalDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" className="gap-2" onClick={generateSelectedProposal}>
                <FileText className="h-4 w-4" />
                Gerar proposta
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingOpportunity ? "Editar oportunidade" : "Nova oportunidade"}</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit((data) => {
                if (editingOpportunity) {
                  updateOpportunity.mutate({ id: editingOpportunity.id, data });
                } else {
                  createOpportunity.mutate(data);
                }
              })}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Titulo *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Ex: Contrato anual - Familia Souza" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contato</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
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
                      <FormLabel>Telefone</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactEmail"
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

                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Origem</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="Indicação, anuncio, site..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="stage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Etapa</FormLabel>
                      <Select
                        value={stageValues.includes(normalizeLegacyStage(field.value)) ? normalizeLegacyStage(field.value) : defaultStageValue}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {crmStages.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
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
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor estimado (R$)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={Number(field.value ?? 0)}
                          onChange={(event) => field.onChange(Number(event.target.value || 0))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expectedCloseDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fechamento previsto</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ownerStaffId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Responsável da equipe</FormLabel>
                      <Select
                        value={field.value ? String(field.value) : "none"}
                        onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Sem responsável" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Sem responsável</SelectItem>
                          {(crmResponsiblesQuery.data ?? []).map((item) => (
                            <SelectItem key={item.id} value={String(item.id)}>
                              {item.name}{item.role ? ` - ${item.role}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Cadastre ou edite responsáveis na aba Equipe.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {stageUsesLostReason(watchedStage) ? (
                  <FormField
                    control={form.control}
                    name="lostReason"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Motivo</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} placeholder="Ex: sem interesse, preço, sem retorno, concorrente..." />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Observações</FormLabel>
                      <FormControl>
                        <Textarea rows={4} {...field} value={field.value ?? ""} placeholder="Anotações da negociação..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createOpportunity.isPending || updateOpportunity.isPending}>
                  {editingOpportunity ? "Salvar" : "Criar"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={followUpDialogOpen}
        onOpenChange={(open) => {
          setFollowUpDialogOpen(open);
          if (!open) {
            setFollowUpOpportunity(null);
            setFollowUpTasksDraft([]);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Follow-up
              {followUpOpportunity ? ` - ${followUpOpportunity.title}` : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Nova tarefa</CardTitle>
                <CardDescription>Lembrete operacional para esta oportunidade.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1 md:col-span-2">
                    <Label>Título da tarefa</Label>
                    <Input
                      value={newFollowUpTitle}
                      onChange={(event) => setNewFollowUpTitle(event.target.value)}
                      placeholder="Ex: Ligar para confirmar visita"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Data do lembrete</Label>
                    <Input
                      type="date"
                      value={newFollowUpDueDate}
                      onChange={(event) => setNewFollowUpDueDate(event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>Responsável</Label>
                    <Input
                      value={newFollowUpAssignee}
                      onChange={(event) => setNewFollowUpAssignee(event.target.value)}
                      placeholder="Ex: Bianca"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Observação</Label>
                    <Input
                      value={newFollowUpNotes}
                      onChange={(event) => setNewFollowUpNotes(event.target.value)}
                      placeholder="Detalhes do contato ou ação"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="button" onClick={handleAddFollowUpTask}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Adicionar tarefa
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Tarefas de follow-up</CardTitle>
                <CardDescription>
                  {followUpTasksDraft.filter((task) => !task.done).length} pendente(s) de {followUpTasksDraft.length} tarefa(s)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {followUpTasksDraft.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Nenhuma tarefa cadastrada.
                  </div>
                ) : (
                  sortFollowUpTasks(followUpTasksDraft).map((task) => {
                    const isOverdue = !task.done && task.dueDate < todayDateKey();
                    const isDueToday = !task.done && task.dueDate === todayDateKey();
                    return (
                      <div key={task.id} className="rounded-lg border border-border p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`text-sm font-medium ${task.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {task.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>Vencimento: {formatDateKeyPtBr(task.dueDate)}</span>
                              {task.assigneeName ? <span>Responsável: {task.assigneeName}</span> : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {task.done ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] text-green-700">
                                <CheckCircle2 className="h-3 w-3" />
                                Concluída
                              </span>
                            ) : isOverdue ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
                                <AlertCircle className="h-3 w-3" />
                                Atrasada
                              </span>
                            ) : isDueToday ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                                <Clock3 className="h-3 w-3" />
                                Vence hoje
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                                <Clock3 className="h-3 w-3" />
                                Pendente
                              </span>
                            )}
                          </div>
                        </div>
                        {task.notes ? (
                          <p className="text-xs text-muted-foreground">{task.notes}</p>
                        ) : null}
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => toggleFollowUpTaskDone(task.id)}
                          >
                            {task.done ? "Reabrir" : "Concluir"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => removeFollowUpTask(task.id)}
                          >
                            Remover
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFollowUpDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={!followUpOpportunity || saveFollowUps.isPending}
                onClick={() => {
                  if (!followUpOpportunity) return;
                  saveFollowUps.mutate({
                    id: followUpOpportunity.id,
                    tasks: sortFollowUpTasks(followUpTasksDraft),
                  });
                }}
              >
                Salvar follow-ups
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

