import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { fetchJsonOrThrow } from "@/lib/fetch-json";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, Clock3, DollarSign, GripVertical, Plus, Search, Settings2, Trash2 } from "lucide-react";

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
  ownerName?: string | null;
  notes: string | null;
  followUpTasks?: string | null;
  lostReason: string | null;
  position: number | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
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

type CrmStagesApiResponse = {
  stages: CrmStagePayload[];
  migratedCount?: number;
};

const DEFAULT_CRM_STAGES: CrmStagePayload[] = [
  { value: "lead", label: "Lead", color: "#64748B" },
  { value: "qualified", label: "Qualificado", color: "#0EA5E9" },
  { value: "proposal", label: "Proposta", color: "#F59E0B" },
  { value: "negotiation", label: "Negociacao", color: "#8B5CF6" },
  { value: "won", label: "Ganho", color: "#10B981" },
  { value: "no_interest", label: "Nao tem interesse", color: "#F97316" },
];

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
  amount: z.coerce.number().min(0, "Valor invalido"),
  expectedCloseDate: z.string().optional(),
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
const todayDateKey = () => new Date().toISOString().slice(0, 10);
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
            error.message.includes("Resposta invalida do servidor")
            || error.message.includes("Erro ao carregar etapas do CRM.")
          )
        ) {
          return { stages: DEFAULT_CRM_STAGES };
        }
        throw error;
      }
    },
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
    if (!dialogOpen) return;
    const currentStage = normalizeLegacyStage(form.getValues("stage"));
    if (!stageValues.includes(currentStage)) {
      form.setValue("stage", defaultStageValue);
    }
  }, [dialogOpen, form, stageValues, defaultStageValue]);

  const opportunitiesQuery = useQuery<CrmOpportunity[]>({
    queryKey: ["/api/crm/opportunities", scopedOrganizationId, search, stageFilter, stageValues.join("|")],
    enabled: !!scopedOrganizationId && crmStages.length > 0,
    queryFn: () =>
      fetchJsonOrThrow(
        buildCrmUrl("/api/crm/opportunities", {
          organizationId: scopedOrganizationId,
          search: search.trim() || undefined,
          stage: stageFilter !== "all" ? stageFilter : undefined,
        }),
        "Erro ao carregar oportunidades do CRM.",
      ),
  });

  const grouped = useMemo(() => {
    const buckets: Record<string, CrmOpportunity[]> = {};
    crmStages.forEach((stage) => {
      buckets[stage.value] = [];
    });

    for (const opportunity of opportunitiesQuery.data ?? []) {
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
  }, [crmStages, opportunitiesQuery.data, stageValues, defaultStageValue]);

  const totalAmount = useMemo(
    () =>
      (opportunitiesQuery.data ?? []).reduce((accumulator, item) => accumulator + Number(item.amount ?? 0), 0),
    [opportunitiesQuery.data],
  );

  const invalidateCrm = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/stages"] });
  };

  const createOpportunity = useMutation({
    mutationFn: async (data: z.infer<typeof opportunitySchema>) => {
      if (!scopedOrganizationId) {
        throw new Error("Selecione uma organizacao para continuar.");
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
        throw new Error("Selecione uma organizacao para continuar.");
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
      if (!scopedOrganizationId) throw new Error("Selecione uma organizacao para continuar.");
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
      if (!scopedOrganizationId) throw new Error("Selecione uma organizacao para continuar.");
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
      if (!scopedOrganizationId) throw new Error("Selecione uma organizacao para continuar.");
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
      if (!scopedOrganizationId) throw new Error("Selecione uma organizacao para continuar.");
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
          && error.message.includes("Resposta invalida do servidor")
        ) {
          throw new Error("API do CRM ainda nao foi atualizada no servidor. Reinicie e atualize o backend.");
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CRM</h1>
          <p className="text-sm text-muted-foreground">Funil comercial em Kanban por etapa.</p>
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
            {(opportunitiesQuery.data?.length ?? 0)} oportunidade(s) · Total {formatCurrencyBRL(totalAmount)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {user?.isSuperAdmin ? (
            <div className="space-y-1">
              <Label>Organizacao</Label>
              <Select
                value={selectedOrganizationId ? String(selectedOrganizationId) : undefined}
                onValueChange={(value) => setSelectedOrganizationId(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a organizacao" />
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
        </CardContent>
      </Card>

      {!scopedOrganizationId ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Selecione uma organizacao para carregar o CRM.
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
      ) : (
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

                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openFollowUpDialog(opportunity)}>
                              Follow-up
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEditDialog(opportunity)}>
                              Editar
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteOpportunity.mutate(opportunity.id)}
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
      )}

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
              Edite nomes, cores, arraste para reordenar e crie novas colunas para o funil desta organizacao.
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
                      <FormLabel>Observacoes</FormLabel>
                      <FormControl>
                        <Textarea rows={4} {...field} value={field.value ?? ""} placeholder="Anotacoes da negociacao..." />
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

