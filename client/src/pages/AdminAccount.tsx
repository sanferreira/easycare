import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS } from "@/lib/permissions";
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_STAGES,
  formatCentsBRL,
  parseTags,
  resolveOrgStatus,
  type LifecycleStage,
} from "@shared/commercial";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, CheckCircle2, ExternalLink, Eye, EyeOff, Mail, MessageCircle, Pencil, Plus, RefreshCw, Trash2, UserPlus,
} from "lucide-react";
import { maskPhoneBR } from "@/lib/masks";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { DEFAULT_ENVIRONMENT_SETTINGS, normalizeEnvironmentSettings } from "@shared/environment";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type CommercialPayload = {
  organization: any;
  contacts: any[];
  activities: any[];
  tasks: any[];
  manualBillingCycles: any[];
  users: any[];
  owners: { id: number; name: string; email?: string | null }[];
};

type OnboardingSummary = {
  organizationId: number;
  completed: number;
  total: number;
  percent: number;
  checks: Record<string, boolean>;
};

const ONBOARDING_LABELS: Record<string, string> = {
  billing: "Cobrança configurada",
  staff: "Equipe cadastrada",
  residents: "Pacientes",
  shifts: "Escalas",
  timeClock: "Ponto eletrônico",
  clinical: "Prontuário clínico",
  finance: "Financeiro",
  familyPortal: "Portal da família",
};

function buildWhatsappUrl(phone?: string | null, message?: string) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

function toRoleLabel(value: string): string {
  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function getRoleOptionsForOrganization(environmentSettings?: string | null) {
  let settings = DEFAULT_ENVIRONMENT_SETTINGS;
  if (environmentSettings) {
    try {
      settings = normalizeEnvironmentSettings(JSON.parse(environmentSettings));
    } catch {
      /* keep default */
    }
  }
  const staffLabelMap = new Map(
    settings.availableStaffRoles.map((option) => [option.value, option.label] as const),
  );
  const roles = Object.keys(settings.roleRoutes).sort((left, right) => left.localeCompare(right));
  return roles.map((role) => ({
    value: role,
    label: ROLE_LABELS[role] ?? staffLabelMap.get(role) ?? toRoleLabel(role),
  }));
}

export default function AdminAccount() {
  const params = useParams<{ id?: string }>();
  const [, routeParams] = useRoute("/admin/orgs/:id");
  const [location, setLocation] = useLocation();
  const orgId = Number(
    routeParams?.id
    || params.id
    || location.match(/\/admin\/orgs\/(\d+)/)?.[1]
    || "",
  );
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const initialTab = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("tab") || "overview")
    : "overview";
  const [tab, setTab] = useState(initialTab);

  const commercialQuery = useQuery<CommercialPayload>({
    queryKey: ["/api/organizations", orgId, "commercial"],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/commercial`, { credentials: "include" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.message || `Erro ao carregar conta (${res.status})`);
      }
      return res.json();
    },
    enabled: Number.isInteger(orgId) && orgId > 0,
    retry: 1,
  });

  const orgFallbackQuery = useQuery({
    queryKey: ["/api/organizations", orgId, "fallback"],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}`, { credentials: "include" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.message || "Organização não encontrada.");
      }
      return res.json();
    },
    enabled: Number.isInteger(orgId) && orgId > 0 && commercialQuery.isError,
    retry: false,
  });

  const onboardingQuery = useQuery<OnboardingSummary[]>({
    queryKey: ["/api/organizations/onboarding-summary"],
    queryFn: async () => {
      const res = await fetch("/api/organizations/onboarding-summary", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const usageQuery = useQuery({
    queryKey: ["/api/organizations", orgId, "usage"],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/usage`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Number.isInteger(orgId) && orgId > 0,
  });

  const org = commercialQuery.data?.organization ?? orgFallbackQuery.data ?? null;
  const onboarding = onboardingQuery.data?.find((s) => s.organizationId === orgId);

  const [overviewForm, setOverviewForm] = useState({
    lifecycleStage: "trial" as LifecycleStage,
    commercialOwnerUserId: "" as string,
    tags: "",
    nextFollowUpAt: "",
    commercialNotes: "",
  });

  const [billingForm, setBillingForm] = useState({
    billingMethod: "stripe",
    manualBillingDueDay: "",
    paymentGraceDays: "10",
    customPlanEnabled: false,
    customPlanLabel: "",
    customPlanAmountReais: "",
    customPlanInterval: "month",
    customPlanIntervalCount: "1",
    customPlanPatientLimit: "",
  });

  const [releaseForm, setReleaseForm] = useState({ days: "30", reason: "", markBoletoPaid: false, amountReais: "" });
  const [churnReason, setChurnReason] = useState("");
  const [contactForm, setContactForm] = useState({ name: "", role: "admin", email: "", phone: "", isPrimary: true });
  const [noteBody, setNoteBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [cycleForm, setCycleForm] = useState({ periodYm: "", dueDate: "", amountReais: "", status: "pending" });
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [userForm, setUserForm] = useState({ name: "", username: "", password: "", role: "admin" });
  const [editUserForm, setEditUserForm] = useState({ name: "", username: "", password: "", role: "admin" });
  const [migratePlan, setMigratePlan] = useState<"monthly" | "semiannual" | "annual">("monthly");

  const roleOptions = useMemo(
    () => getRoleOptionsForOrganization(org?.environmentSettings),
    [org?.environmentSettings],
  );
  const defaultRole = useMemo(() => {
    const staffFallback = roleOptions.find((option) => option.value === "staff");
    return staffFallback?.value ?? roleOptions[0]?.value ?? "admin";
  }, [roleOptions]);

  useEffect(() => {
    setUserForm((current) => (
      roleOptions.some((option) => option.value === current.role)
        ? current
        : { ...current, role: defaultRole }
    ));
  }, [defaultRole, roleOptions]);

  useEffect(() => {
    if (!org) return;
    setOverviewForm({
      lifecycleStage: (org.lifecycleStage as LifecycleStage) || "trial",
      commercialOwnerUserId: org.commercialOwnerUserId ? String(org.commercialOwnerUserId) : "",
      tags: (Array.isArray(org.tags) ? org.tags : parseTags(org.tags)).join(", "),
      nextFollowUpAt: org.nextFollowUpAt ? String(org.nextFollowUpAt).slice(0, 10) : "",
      commercialNotes: org.commercialNotes || "",
    });
    setBillingForm({
      billingMethod: org.billingMethod || "stripe",
      manualBillingDueDay: org.manualBillingDueDay ? String(org.manualBillingDueDay) : "",
      paymentGraceDays: String(org.paymentGraceDays ?? 10),
      customPlanEnabled: Boolean(org.customPlanEnabled),
      customPlanLabel: org.customPlanLabel || "",
      customPlanAmountReais: org.customPlanAmountCents
        ? (org.customPlanAmountCents / 100).toFixed(2).replace(".", ",")
        : "",
      customPlanInterval: org.customPlanInterval || "month",
      customPlanIntervalCount: String(org.customPlanIntervalCount ?? 1),
      customPlanPatientLimit: org.customPlanPatientLimit ? String(org.customPlanPatientLimit) : "",
    });
  }, [org]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/organizations", orgId, "commercial"] });
    queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
  };

  const saveOverview = useMutation({
    mutationFn: async () => {
      const tags = overviewForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await fetch(`/api/organizations/${orgId}/commercial`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          lifecycleStage: overviewForm.lifecycleStage,
          commercialOwnerUserId: overviewForm.commercialOwnerUserId
            ? Number(overviewForm.commercialOwnerUserId)
            : null,
          tags,
          nextFollowUpAt: overviewForm.nextFollowUpAt || null,
          commercialNotes: overviewForm.commercialNotes || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro ao salvar");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Visão geral salva" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const saveBilling = useMutation({
    mutationFn: async () => {
      const reais = billingForm.customPlanAmountReais.replace(/\./g, "").replace(",", ".");
      const amountCents = reais ? Math.round(Number(reais) * 100) : null;
      const res = await fetch(`/api/organizations/${orgId}/commercial`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          billingMethod: billingForm.billingMethod,
          manualBillingDueDay: billingForm.manualBillingDueDay
            ? Number(billingForm.manualBillingDueDay)
            : null,
          paymentGraceDays: Number(billingForm.paymentGraceDays) || 10,
          customPlanEnabled: billingForm.billingMethod === "stripe" && billingForm.customPlanEnabled,
          customPlanLabel: billingForm.customPlanLabel || null,
          customPlanAmountCents: amountCents,
          customPlanInterval: billingForm.customPlanInterval,
          customPlanIntervalCount: Number(billingForm.customPlanIntervalCount) || 1,
          customPlanPatientLimit: billingForm.customPlanPatientLimit
            ? Number(billingForm.customPlanPatientLimit)
            : null,
          lifecycleStage: billingForm.customPlanEnabled ? "special" : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro ao salvar cobrança");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cobrança atualizada" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const releaseAccess = useMutation({
    mutationFn: async () => {
      const amountReais = releaseForm.amountReais.replace(/\./g, "").replace(",", ".");
      const res = await fetch(`/api/organizations/${orgId}/commercial/release-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          days: Number(releaseForm.days) || 30,
          reason: releaseForm.reason,
          markBoletoPaid: releaseForm.markBoletoPaid,
          amountCents: amountReais ? Math.round(Number(amountReais) * 100) : null,
          billingMethod: releaseForm.markBoletoPaid ? "manual_boleto" : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro ao liberar");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Acesso liberado" });
      setReleaseForm({ days: "30", reason: "", markBoletoPaid: false, amountReais: "" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const churnMutation = useMutation({
    mutationFn: async (inactivate: boolean) => {
      const res = await fetch(`/api/organizations/${orgId}/commercial/churn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: churnReason, inactivate }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro ao registrar churn");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Churn registrado" });
      setChurnReason("");
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const syncStripe = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/billing/sync`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro no sync");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Stripe sincronizado" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const addContact = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/commercial/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(contactForm),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro");
      return res.json();
    },
    onSuccess: () => {
      setContactForm({ name: "", role: "admin", email: "", phone: "", isPrimary: false });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteContact = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/organizations/${orgId}/commercial/contacts/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
    },
    onSuccess: invalidate,
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/commercial/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "note", body: noteBody }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro");
      return res.json();
    },
    onSuccess: () => {
      setNoteBody("");
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const addTask = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/commercial/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: taskTitle, dueAt: taskDue || null }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro");
      return res.json();
    },
    onSuccess: () => {
      setTaskTitle("");
      setTaskDue("");
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const completeTask = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await fetch(`/api/organizations/${orgId}/commercial/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const saveCycle = useMutation({
    mutationFn: async () => {
      const reais = cycleForm.amountReais.replace(/\./g, "").replace(",", ".");
      const res = await fetch(`/api/organizations/${orgId}/commercial/billing-cycles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          periodYm: cycleForm.periodYm,
          dueDate: cycleForm.dueDate,
          amountCents: reais ? Math.round(Number(reais) * 100) : null,
          status: cycleForm.status,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ciclo salvo" });
      setCycleForm({ periodYm: "", dueDate: "", amountReais: "", status: "pending" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const markCyclePaid = useMutation({
    mutationFn: async (cycleId: number) => {
      const res = await fetch(`/api/organizations/${orgId}/commercial/billing-cycles/${cycleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "paid" }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const addUserMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(userForm),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro ao criar usuário");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Usuário criado" });
      setShowAddUser(false);
      setUserForm({ name: "", username: "", password: "", role: defaultRole });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const editUserMutation = useMutation({
    mutationFn: async () => {
      if (!editingUser) return;
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editUserForm),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro ao atualizar");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Usuário atualizado" });
      setShowEditUser(false);
      setEditingUser(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "Erro ao remover");
    },
    onSuccess: () => {
      toast({ title: "Usuário removido" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  function requestDeleteUser(userId: number, userName: string) {
    confirm({
      title: "Remover usuário?",
      description: `Remover o acesso de ${userName} nesta organização?`,
      confirmText: "Remover",
      variant: "destructive",
      onConfirm: () => deleteUserMutation.mutateAsync(userId),
    });
  }

  const migratePlanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/commercial/migrate-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: migratePlan, disableCustomPlan: true }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro ao migrar plano");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Plano migrado na Stripe (sem prorata)" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  async function logOutreach(channel: "whatsapp" | "email", target?: string | null) {
    await fetch(`/api/organizations/${orgId}/commercial/outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ channel, target }),
    });
    invalidate();
  }

  const openTasks = useMemo(
    () => (commercialQuery.data?.tasks || []).filter((t) => t.status === "open"),
    [commercialQuery.data?.tasks],
  );

  if (!Number.isInteger(orgId) || orgId <= 0) {
    return <RedirectOrBack />;
  }

  if (commercialQuery.isLoading || (commercialQuery.isError && orgFallbackQuery.isLoading)) {
    return <div className="p-8 text-muted-foreground">Carregando conta...</div>;
  }

  if (!org) {
    const errorMessage =
      (commercialQuery.error instanceof Error ? commercialQuery.error.message : null)
      || (orgFallbackQuery.error instanceof Error ? orgFallbackQuery.error.message : null)
      || "Conta não encontrada.";
    return (
      <div className="space-y-4 p-4">
        <p className="font-medium text-foreground">Não foi possível abrir a conta.</p>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <Button variant="outline" onClick={() => setLocation("/admin")}>Voltar</Button>
      </div>
    );
  }

  const orgStatus = resolveOrgStatus(org);
  const whatsappUrl = buildWhatsappUrl(org.phone);
  const stripeSubUrl = org.stripeSubscriptionId
    ? `https://dashboard.stripe.com/subscriptions/${org.stripeSubscriptionId}`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="gap-1 px-0" onClick={() => setLocation("/admin")}>
            <ArrowLeft className="h-4 w-4" /> Contas
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold font-display text-foreground">{org.name}</h1>
            <Badge variant="outline">{LIFECYCLE_LABELS[org.lifecycleStage as LifecycleStage] || org.lifecycleStage || "—"}</Badge>
            <Badge variant="outline">{orgStatus}</Badge>
            {org.customPlanEnabled && <Badge className="bg-violet-100 text-violet-800 border-violet-200">Acordo especial</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {org.email || "sem e-mail"} · {org.phone ? maskPhoneBR(org.phone) : "sem telefone"} · CNPJ {org.cnpj || "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {whatsappUrl && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                void logOutreach("whatsapp", org.phone);
                window.open(whatsappUrl, "_blank");
              }}
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </Button>
          )}
          {org.email && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                void logOutreach("email", org.email);
                window.location.href = `mailto:${org.email}`;
              }}
            >
              <Mail className="h-4 w-4" /> E-mail
            </Button>
          )}
          {stripeSubUrl && (
            <Button asChild variant="outline" size="sm" className="gap-1">
              <a href={stripeSubUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Stripe
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1" onClick={() => syncStripe.mutate()} disabled={syncStripe.isPending}>
            <RefreshCw className="h-4 w-4" /> Sync
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/audit?organizationId=${orgId}`}>Histórico</Link>
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="billing">Cobrança</TabsTrigger>
          <TabsTrigger value="onboarding">Implantação</TabsTrigger>
          <TabsTrigger value="contacts">Contatos</TabsTrigger>
          <TabsTrigger value="tasks">Tarefas ({openTasks.length})</TabsTrigger>
          <TabsTrigger value="activity">Atividade</TabsTrigger>
          <TabsTrigger value="access">Acessos</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Conta</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Lifecycle</Label>
                <Select
                  value={overviewForm.lifecycleStage}
                  onValueChange={(v: LifecycleStage) => setOverviewForm({ ...overviewForm, lifecycleStage: v })}
                >
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LIFECYCLE_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{LIFECYCLE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Dono comercial</Label>
                <Select
                  value={overviewForm.commercialOwnerUserId || "none"}
                  onValueChange={(v) => setOverviewForm({ ...overviewForm, commercialOwnerUserId: v === "none" ? "" : v })}
                >
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Sem dono" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem dono</SelectItem>
                    {(commercialQuery.data?.owners || []).map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tags (vírgula)</Label>
                <Input className="mt-1.5" value={overviewForm.tags} onChange={(e) => setOverviewForm({ ...overviewForm, tags: e.target.value })} />
              </div>
              <div>
                <Label>Próximo follow-up</Label>
                <Input className="mt-1.5" type="date" value={overviewForm.nextFollowUpAt} onChange={(e) => setOverviewForm({ ...overviewForm, nextFollowUpAt: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Nota sticky</Label>
                <Textarea className="mt-1.5" rows={3} value={overviewForm.commercialNotes} onChange={(e) => setOverviewForm({ ...overviewForm, commercialNotes: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Button onClick={() => saveOverview.mutate()} disabled={saveOverview.isPending}>
                  {saveOverview.isPending ? "Salvando..." : "Salvar visão geral"}
                </Button>
              </div>
            </CardContent>
          </Card>
          {usageQuery.data && (
            <Card>
              <CardHeader><CardTitle className="text-base">Uso</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
                <p>Usuários: {usageQuery.data.activeUsers}/{usageQuery.data.users}</p>
                <p>Pacientes: {usageQuery.data.activeResidents}/{usageQuery.data.residents}</p>
                <p>Portal família: {usageQuery.data.familyPortalAccess}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Como cobra</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Forma</Label>
                  <Select
                    value={billingForm.billingMethod}
                    onValueChange={(v) => setBillingForm({
                      ...billingForm,
                      billingMethod: v,
                      customPlanEnabled: v === "stripe" ? billingForm.customPlanEnabled : false,
                    })}
                  >
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stripe">Stripe (cartão ou boleto)</SelectItem>
                      <SelectItem value="manual_boleto">Boleto manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tolerância (dias)</Label>
                  <Input className="mt-1.5" type="number" min={0} max={60} value={billingForm.paymentGraceDays} onChange={(e) => setBillingForm({ ...billingForm, paymentGraceDays: e.target.value })} />
                </div>
              </div>

              {billingForm.billingMethod === "manual_boleto" && (
                <div>
                  <Label>Dia do vencimento</Label>
                  <Input className="mt-1.5 max-w-xs" type="number" min={1} max={31} value={billingForm.manualBillingDueDay} onChange={(e) => setBillingForm({ ...billingForm, manualBillingDueDay: e.target.value })} />
                </div>
              )}

              {billingForm.billingMethod === "stripe" && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm">Tipo de plano Stripe</p>
                      <p className="text-xs text-muted-foreground">Planos do site ou acordo especial nesta organização.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={!billingForm.customPlanEnabled}
                      onCheckedChange={(checked) => setBillingForm({ ...billingForm, customPlanEnabled: !checked })}
                    />
                    <span className="text-sm">Planos do site (mensal / semestral / anual)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={billingForm.customPlanEnabled}
                      onCheckedChange={(checked) => setBillingForm({ ...billingForm, customPlanEnabled: checked })}
                    />
                    <span className="text-sm">Acordo especial nesta organização</span>
                  </div>
                  {billingForm.customPlanEnabled && (
                    <div className="grid gap-3 sm:grid-cols-2 border-t pt-3">
                      <div className="sm:col-span-2">
                        <Label>Nome do acordo</Label>
                        <Input className="mt-1.5" value={billingForm.customPlanLabel} onChange={(e) => setBillingForm({ ...billingForm, customPlanLabel: e.target.value })} placeholder="Ex: Acordo 4 meses" />
                      </div>
                      <div>
                        <Label>Valor (R$)</Label>
                        <Input className="mt-1.5" value={billingForm.customPlanAmountReais} onChange={(e) => setBillingForm({ ...billingForm, customPlanAmountReais: e.target.value })} placeholder="1590,00" />
                      </div>
                      <div>
                        <Label>Limite de pacientes</Label>
                        <Input className="mt-1.5" type="number" value={billingForm.customPlanPatientLimit} onChange={(e) => setBillingForm({ ...billingForm, customPlanPatientLimit: e.target.value })} />
                      </div>
                      <div>
                        <Label>Intervalo</Label>
                        <Select value={billingForm.customPlanInterval} onValueChange={(v) => setBillingForm({ ...billingForm, customPlanInterval: v })}>
                          <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="month">Meses</SelectItem>
                            <SelectItem value="year">Anos</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>A cada N</Label>
                        <Input className="mt-1.5" type="number" min={1} max={36} value={billingForm.customPlanIntervalCount} onChange={(e) => setBillingForm({ ...billingForm, customPlanIntervalCount: e.target.value })} />
                      </div>
                      <p className="sm:col-span-2 text-xs text-muted-foreground">
                        No checkout a Stripe usa este valor. Não precisa criar produto no Dashboard.
                      </p>
                      {org.stripeSubscriptionId && !org.customPlanEnabled && (
                        <p className="sm:col-span-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                          Há assinatura ativa. Ao ativar o acordo, o cliente precisa cancelar a renovação e fazer novo checkout.
                        </p>
                      )}
                      {org.customPlanEnabled === false && org.stripeSubscriptionId && (
                        <p className="sm:col-span-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                          Acordo especial desligado: a assinatura atual segue até cancelar; depois escolha plano padrão.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="text-sm text-muted-foreground space-y-1">
                <p>Stripe: {org.stripeSubscriptionStatus || "sem assinatura"}</p>
                <p>Price: {org.stripePriceId || "—"}</p>
                {org.customPlanEnabled && (
                  <p>
                    Acordo: {org.customPlanLabel} · {formatCentsBRL(org.customPlanAmountCents)} a cada {org.customPlanIntervalCount} {org.customPlanInterval === "year" ? "ano(s)" : "mês(es)"}
                  </p>
                )}
              </div>

              <Button onClick={() => saveBilling.mutate()} disabled={saveBilling.isPending}>
                {saveBilling.isPending ? "Salvando..." : "Salvar cobrança"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Liberar acesso / confirmar boleto</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Dias</Label>
                <Input className="mt-1.5" type="number" min={1} max={90} value={releaseForm.days} onChange={(e) => setReleaseForm({ ...releaseForm, days: e.target.value })} />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex items-center gap-2 pb-2">
                  <Switch checked={releaseForm.markBoletoPaid} onCheckedChange={(c) => setReleaseForm({ ...releaseForm, markBoletoPaid: c })} />
                  <span className="text-sm">Marcar boleto do mês como pago</span>
                </div>
              </div>
              {releaseForm.markBoletoPaid && (
                <div>
                  <Label>Valor pago (R$)</Label>
                  <Input className="mt-1.5" value={releaseForm.amountReais} onChange={(e) => setReleaseForm({ ...releaseForm, amountReais: e.target.value })} />
                </div>
              )}
              <div className="sm:col-span-2">
                <Label>Motivo *</Label>
                <Textarea className="mt-1.5" rows={2} value={releaseForm.reason} onChange={(e) => setReleaseForm({ ...releaseForm, reason: e.target.value })} />
              </div>
              <Button onClick={() => releaseAccess.mutate()} disabled={releaseAccess.isPending || releaseForm.reason.trim().length < 3}>
                Confirmar liberação
              </Button>
            </CardContent>
          </Card>

          {billingForm.billingMethod === "manual_boleto" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Ciclos de boleto</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-4">
                  <Input placeholder="YYYY-MM" value={cycleForm.periodYm} onChange={(e) => setCycleForm({ ...cycleForm, periodYm: e.target.value })} />
                  <Input type="date" value={cycleForm.dueDate} onChange={(e) => setCycleForm({ ...cycleForm, dueDate: e.target.value })} />
                  <Input placeholder="Valor R$" value={cycleForm.amountReais} onChange={(e) => setCycleForm({ ...cycleForm, amountReais: e.target.value })} />
                  <Button onClick={() => saveCycle.mutate()} disabled={!cycleForm.periodYm || !cycleForm.dueDate}>Salvar ciclo</Button>
                </div>
                <div className="space-y-2">
                  {(commercialQuery.data?.manualBillingCycles || []).map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span>{c.periodYm} · {c.status} · {formatCentsBRL(c.amountCents) || "—"}</span>
                      {c.status !== "paid" && (
                        <Button size="sm" variant="outline" onClick={() => markCyclePaid.mutate(c.id)}>Marcar pago</Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Playbook churn</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={2} placeholder="Motivo do churn" value={churnReason} onChange={(e) => setChurnReason(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" disabled={churnReason.trim().length < 3} onClick={() => churnMutation.mutate(false)}>Registrar churn</Button>
                <Button variant="destructive" disabled={churnReason.trim().length < 3} onClick={() => churnMutation.mutate(true)}>Churn + inativar</Button>
              </div>
              {org.churnReason && <p className="text-xs text-muted-foreground">Último motivo: {org.churnReason}</p>}
            </CardContent>
          </Card>

          {org.stripeSubscriptionId && (
            <Card>
              <CardHeader><CardTitle className="text-base">Migrar plano na Stripe</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Troca o price da assinatura atual para um plano padrão (sem prorata — vale no próximo ciclo) e desliga o acordo especial.
                </p>
                <div className="flex flex-wrap gap-2 items-end">
                  <div>
                    <Label>Plano destino</Label>
                    <Select value={migratePlan} onValueChange={(v: "monthly" | "semiannual" | "annual") => setMigratePlan(v)}>
                      <SelectTrigger className="mt-1.5 w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Mensal</SelectItem>
                        <SelectItem value="semiannual">Semestral</SelectItem>
                        <SelectItem value="annual">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => migratePlanMutation.mutate()}
                    disabled={migratePlanMutation.isPending}
                  >
                    {migratePlanMutation.isPending ? "Migrando..." : "Migrar agora"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="onboarding">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Implantação {onboarding ? `${onboarding.percent}%` : ""}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {onboarding ? (
                <>
                  <Progress value={onboarding.percent} className="h-2" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(onboarding.checks || {}).map(([key, ok]) => (
                      <div key={key} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className={`h-4 w-4 ${ok ? "text-emerald-600" : "text-muted-foreground/40"}`} />
                        {ONBOARDING_LABELS[key] || key}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Sem dados de implantação.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Novo contato</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Nome" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} />
              <Select value={contactForm.role} onValueChange={(v) => setContactForm({ ...contactForm, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="financeiro">Financeiro</SelectItem>
                  <SelectItem value="decisor">Decisor</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="E-mail" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
              <Input placeholder="Telefone" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} />
              <Button className="gap-1" onClick={() => addContact.mutate()} disabled={!contactForm.name.trim()}>
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </CardContent>
          </Card>
          <div className="space-y-2">
            {(commercialQuery.data?.contacts || []).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{c.name} {c.isPrimary ? "· principal" : ""}</p>
                  <p className="text-xs text-muted-foreground">{c.role} · {c.email || "—"} · {c.phone || "—"}</p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => deleteContact.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 pt-6 sm:grid-cols-[1fr_auto_auto]">
              <Input placeholder="Nova tarefa" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              <Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
              <Button onClick={() => addTask.mutate()} disabled={!taskTitle.trim()}>Criar</Button>
            </CardContent>
          </Card>
          {(commercialQuery.data?.tasks || []).map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className={`text-sm font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t.status}{t.dueAt ? ` · vence ${new Date(t.dueAt).toLocaleDateString("pt-BR")}` : ""}{t.queue ? ` · ${t.queue}` : ""}
                </p>
              </div>
              {t.status === "open" && (
                <Button size="sm" variant="outline" onClick={() => completeTask.mutate(t.id)}>Concluir</Button>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardContent className="flex gap-2 pt-6">
              <Textarea className="flex-1" rows={2} placeholder="Nota rápida..." value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
              <Button onClick={() => addNote.mutate()} disabled={!noteBody.trim()}>Registrar</Button>
            </CardContent>
          </Card>
          <div className="space-y-2">
            {(commercialQuery.data?.activities || []).map((a) => (
              <div key={a.id} className="rounded-lg border px-3 py-2 text-sm">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{a.type}</Badge>
                  <span>{a.actorName || "Sistema"}</span>
                  <span>{a.createdAt ? new Date(a.createdAt).toLocaleString("pt-BR") : ""}</span>
                </div>
                <p className="mt-1">{a.body}</p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="access" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Usuários da organização</CardTitle>
              <Button
                size="sm"
                className="gap-1"
                onClick={() => {
                  setUserForm({ name: "", username: "", password: "", role: defaultRole });
                  setShowPassword(false);
                  setShowAddUser(true);
                }}
              >
                <UserPlus className="h-4 w-4" /> Novo usuário
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {(commercialQuery.data?.users || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>
              ) : (
                (commercialQuery.data?.users || []).map((u) => (
                  <div key={u.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm group">
                    <div>
                      <p className="font-medium">{u.name} · @{u.username}</p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}
                        {u.lastLoginAt
                          ? ` · último login ${new Date(u.lastLoginAt).toLocaleString("pt-BR")}`
                          : " · sem login registrado"}
                      </p>
                    </div>
                    <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingUser(u);
                          setEditUserForm({ name: u.name, username: u.username, password: "", role: u.role });
                          setShowEditPassword(false);
                          setShowEditUser(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() => requestDeleteUser(u.id, u.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nome</Label>
                  <Input className="mt-1.5" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
                </div>
                <div>
                  <Label>Usuário</Label>
                  <Input className="mt-1.5" value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
                </div>
                <div>
                  <Label>Senha</Label>
                  <div className="relative mt-1.5">
                    <Input type={showPassword ? "text" : "password"} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label>Perfil</Label>
                  <Select value={userForm.role} onValueChange={(v) => setUserForm({ ...userForm, role: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setShowAddUser(false)}>Cancelar</Button>
                  <Button className="flex-1" disabled={addUserMutation.isPending || !userForm.name || !userForm.username || !userForm.password} onClick={() => addUserMutation.mutate()}>
                    {addUserMutation.isPending ? "Criando..." : "Criar"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showEditUser} onOpenChange={(open) => { setShowEditUser(open); if (!open) setEditingUser(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Editar usuário</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nome</Label>
                  <Input className="mt-1.5" value={editUserForm.name} onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })} />
                </div>
                <div>
                  <Label>Usuário</Label>
                  <Input className="mt-1.5" value={editUserForm.username} onChange={(e) => setEditUserForm({ ...editUserForm, username: e.target.value })} />
                </div>
                <div>
                  <Label>Perfil</Label>
                  <Select value={editUserForm.role} onValueChange={(v) => setEditUserForm({ ...editUserForm, role: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(roleOptions.some((o) => o.value === editUserForm.role)
                        ? roleOptions
                        : [...roleOptions, { value: editUserForm.role, label: ROLE_LABELS[editUserForm.role] || editUserForm.role }]
                      ).map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Nova senha (opcional)</Label>
                  <div className="relative mt-1.5">
                    <Input type={showEditPassword ? "text" : "password"} value={editUserForm.password} onChange={(e) => setEditUserForm({ ...editUserForm, password: e.target.value })} />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setShowEditPassword(!showEditPassword)}>
                      {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setShowEditUser(false)}>Cancelar</Button>
                  <Button className="flex-1" disabled={editUserMutation.isPending} onClick={() => editUserMutation.mutate()}>
                    {editUserMutation.isPending ? "Salvando..." : "Salvar"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {confirmDialog}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RedirectOrBack() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/admin");
  }, [setLocation]);
  return null;
}
