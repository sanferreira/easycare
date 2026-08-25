import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS } from "@/lib/permissions";
import { DEFAULT_ENVIRONMENT_SETTINGS, normalizeEnvironmentSettings } from "@shared/environment";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, Ban, Building2, ChevronDown, ChevronRight, Clock3, CreditCard,
  ExternalLink, Eye, EyeOff, History, Mail, MessageCircle, Pencil, Plus, Power, RefreshCw, Search,
  ShieldCheck, Trash2, UnlockKeyhole, UserPlus, Users,
} from "lucide-react";
import { digitsOnly, maskCep, maskCnpj, maskPhoneBR } from "@/lib/masks";

type OrgStatus = "active" | "inactive" | "restricted";

interface Organization {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  email?: string | null;
  cnpj: string;
  capacity?: number;
  status?: OrgStatus;
  environmentSettings?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripeCancelAtPeriodEnd?: boolean | null;
  stripeCancelAt?: string | null;
  subscriptionCurrentPeriodEnd?: string | null;
  subscriptionUpdatedAt?: string | null;
  billingMethod?: "stripe" | "manual_boleto" | string | null;
  manualBillingDueDay?: number | null;
  paymentGraceDays?: number | null;
  manualAccessUntil?: string | null;
  active: boolean;
  createdAt: string;
}
interface OrgUser {
  id: number;
  name: string;
  username: string;
  role: string;
}

type ViaCepPayload = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

function extractCepFromAddress(address?: string): string {
  if (!address) return "";
  const match = address.match(/\b\d{5}-?\d{3}\b/);
  return match ? maskCep(match[0]) : "";
}

function removeCepPrefixFromAddress(address?: string): string {
  if (!address) return "";
  return address.replace(/^CEP\s*\d{5}-?\d{3}\s*-?\s*/i, "").trim();
}

function composeAddress(cep: string, address: string): string {
  const normalizedCep = maskCep(cep);
  const cleanAddress = removeCepPrefixFromAddress(address);
  if (!normalizedCep) return cleanAddress;
  if (!cleanAddress) return `CEP ${normalizedCep}`;
  return `CEP ${normalizedCep} - ${cleanAddress}`;
}

function isValidCnpj(value: string): boolean {
  return digitsOnly(value).length === 14;
}

const DEFAULT_PAYMENT_GRACE_DAYS = 10;

function paymentGraceDays(value?: number | null) {
  return Number.isInteger(value) && value! >= 0 ? Math.min(value!, 60) : DEFAULT_PAYMENT_GRACE_DAYS;
}

function isWithinGracePeriod(value?: string | Date | null, graceDays = DEFAULT_PAYMENT_GRACE_DAYS) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() <= date.getTime() + graceDays * 24 * 60 * 60 * 1000;
}

function stripeStatusAllowsAccess(org: Pick<Organization, "stripeSubscriptionStatus" | "subscriptionUpdatedAt" | "paymentGraceDays">) {
  if (org.stripeSubscriptionStatus === "active" || org.stripeSubscriptionStatus === "trialing") return true;
  if (org.stripeSubscriptionStatus === "past_due" || org.stripeSubscriptionStatus === "unpaid" || org.stripeSubscriptionStatus === "incomplete") {
    return isWithinGracePeriod(org.subscriptionUpdatedAt, paymentGraceDays(org.paymentGraceDays));
  }
  return false;
}

function manualAccessExpired(value?: string | Date | null) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function resolveOrgStatus(org: Pick<Organization, "status" | "active" | "stripeSubscriptionStatus" | "subscriptionUpdatedAt" | "paymentGraceDays" | "manualAccessUntil">): OrgStatus {
  const normalized = org.status === "active" || org.status === "inactive" || org.status === "restricted"
    ? org.status
    : org.active ? "active" : "inactive";
  if (normalized === "restricted" && stripeStatusAllowsAccess(org)) {
    return "active";
  }
  const hasStripeStatus = typeof org.stripeSubscriptionStatus === "string" && org.stripeSubscriptionStatus.trim().length > 0;
  if (
    normalized === "active"
    && !stripeStatusAllowsAccess(org)
    && (manualAccessExpired(org.manualAccessUntil) || hasStripeStatus)
  ) {
    return "restricted";
  }
  return normalized;
}

function getOrgStatusBadge(status: OrgStatus) {
  if (status === "active") {
    return { label: "Ativa", className: "bg-green-100 text-green-700 border border-green-200" };
  }
  if (status === "restricted") {
    return { label: "Pgto. pendente", className: "bg-orange-100 text-orange-700 border border-orange-200" };
  }
  return { label: "Inativa", className: "bg-neutral-100 text-neutral-600 border border-neutral-200" };
}

type SubscriptionFilter = "all" | "needs_action" | "trialing" | "trial_ending" | "billing_risk" | "manual_boleto" | "active" | "past_due" | "none" | "problem";

interface OrganizationUsage {
  users: number;
  activeUsers: number;
  residents: number;
  activeResidents: number;
  familyMembers: number;
  familyPortalAccess: number;
  lastFamilyPortalLoginAt?: string | null;
}

interface OrganizationOnboardingSummary {
  organizationId: number;
  completed: number;
  total: number;
  percent: number;
  checks: Record<string, boolean>;
}

function getSubscriptionLabel(status?: string | null) {
  if (!status) return "Sem assinatura Stripe";
  const labels: Record<string, string> = {
    active: "Ativa",
    trialing: "Em teste",
    past_due: "Pagamento atrasado",
    unpaid: "Nao paga",
    canceled: "Cancelada",
    incomplete: "Incompleta",
    incomplete_expired: "Expirada",
    paused: "Pausada",
  };
  return labels[status] ?? status;
}

function getSubscriptionBadge(status?: string | null) {
  if (status === "active") {
    return { label: "Ativa", className: "bg-emerald-50 text-emerald-700 border border-emerald-200" };
  }
  if (status === "trialing") {
    return { label: "Teste grátis", className: "bg-cyan-50 text-cyan-700 border border-cyan-200" };
  }
  if (status === "past_due" || status === "unpaid" || status === "incomplete") {
    return { label: getSubscriptionLabel(status), className: "bg-red-50 text-red-700 border border-red-200" };
  }
  if (status === "canceled" || status === "paused" || status === "incomplete_expired") {
    return { label: getSubscriptionLabel(status), className: "bg-neutral-100 text-neutral-700 border border-neutral-200" };
  }
  return { label: "Sem Stripe", className: "bg-slate-100 text-slate-600 border border-slate-200" };
}

function getSubscriptionFilter(status?: string | null): SubscriptionFilter {
  if (!status) return "none";
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "past_due";
  return "problem";
}

function daysUntilDate(value?: string | Date | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function isTrialEndingSoon(org: Pick<Organization, "stripeSubscriptionStatus" | "subscriptionCurrentPeriodEnd">) {
  if (org.stripeSubscriptionStatus !== "trialing") return false;
  const days = daysUntilDate(org.subscriptionCurrentPeriodEnd);
  return days !== null && days >= 0 && days <= 7;
}

function isBillingRisk(org: Pick<Organization, "status" | "active" | "stripeSubscriptionStatus" | "subscriptionUpdatedAt" | "paymentGraceDays" | "manualAccessUntil">) {
  const orgStatus = resolveOrgStatus(org);
  return orgStatus === "restricted" || getSubscriptionFilter(org.stripeSubscriptionStatus) === "past_due";
}

function manualBoletoDaysUntilDue(org: Pick<Organization, "billingMethod" | "manualBillingDueDay">) {
  if (org.billingMethod !== "manual_boleto" || !org.manualBillingDueDay) return null;
  const dueDay = Math.min(Math.max(Number(org.manualBillingDueDay), 1), 31);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (dueDate.getTime() < today.getTime() - 10 * 24 * 60 * 60 * 1000) {
    dueDate = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
  }
  return Math.ceil((dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function isManualBoletoDueSoon(org: Pick<Organization, "billingMethod" | "manualBillingDueDay" | "paymentGraceDays">) {
  const days = manualBoletoDaysUntilDue(org);
  if (days === null) return false;
  return days >= -paymentGraceDays(org.paymentGraceDays) && days <= 7;
}

function isWithoutPlan(org: Pick<Organization, "stripeSubscriptionStatus" | "billingMethod" | "manualAccessUntil" | "stripeCustomerId" | "stripeSubscriptionId">) {
  return !org.stripeSubscriptionStatus
    && org.billingMethod !== "manual_boleto"
    && !org.manualAccessUntil
    && !org.stripeCustomerId
    && !org.stripeSubscriptionId;
}

function needsCommercialAction(org: Organization) {
  return isTrialEndingSoon(org) || isBillingRisk(org) || isManualBoletoDueSoon(org) || isWithoutPlan(org);
}

function normalizeSearchText(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatShortDate(value?: string | Date | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function toDateInputValue(value?: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDateTime(value?: string | Date | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function buildStripeDashboardUrl(type: "customer" | "subscription", id?: string | null) {
  if (!id) return null;
  const segment = type === "customer" ? "customers" : "subscriptions";
  return `https://dashboard.stripe.com/${segment}/${encodeURIComponent(id)}`;
}

function buildWhatsappUrl(phone?: string | null, text?: string) {
  const digits = digitsOnly(phone ?? "");
  if (!digits) return null;
  const phoneNumber = digits.startsWith("55") ? digits : `55${digits}`;
  const params = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${phoneNumber}${params}`;
}

function trialEndingMessage(org: Organization, days: number | null) {
  const when = days === 0 ? "vence hoje" : `vence em ${days ?? 0} dia${days === 1 ? "" : "s"}`;
  return `Olá! Aqui é o suporte EasyCare. O teste grátis da ${org.name} ${when}. Posso te ajudar a concluir a implantação e garantir que o acesso continue ativo?`;
}

function billingRiskMessage(org: Organization) {
  return `Olá! Aqui é o suporte EasyCare. Identificamos uma pendência de cobrança na ${org.name}. Para evitar bloqueio do sistema, posso te ajudar a regularizar pela Stripe?`;
}

function noStripeMessage(org: Organization) {
  return `Olá! Aqui é o suporte EasyCare. Vi que a ${org.name} ainda não concluiu a ativação da assinatura na Stripe. Posso te enviar o caminho para liberar o acesso com 7 dias grátis?`;
}

function buildMailtoUrl(email?: string | null, subject?: string, body?: string) {
  const normalized = (email ?? "").trim();
  if (!normalized) return null;
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const query = params.toString();
  return `mailto:${normalized}${query ? `?${query}` : ""}`;
}

function parseOrgEnvironmentSettings(raw?: string | null) {
  if (!raw || typeof raw !== "string") return DEFAULT_ENVIRONMENT_SETTINGS;
  try {
    return normalizeEnvironmentSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_ENVIRONMENT_SETTINGS;
  }
}

function toRoleLabel(value: string): string {
  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function getRoleOptionsForOrganization(org: Organization) {
  const settings = parseOrgEnvironmentSettings(org.environmentSettings);
  const staffLabelMap = new Map(
    settings.availableStaffRoles.map((option) => [option.value, option.label] as const),
  );
  const roles = Object.keys(settings.roleRoutes).sort((left, right) => left.localeCompare(right));
  return roles.map((role) => ({
    value: role,
    label: ROLE_LABELS[role] ?? staffLabelMap.get(role) ?? toRoleLabel(role),
  }));
}

async function fetchAddressByCep(cep: string): Promise<{ cep: string; address: string }> {
  const normalizedCep = digitsOnly(cep);
  if (normalizedCep.length !== 8) {
    throw new Error("Informe um CEP válido com 8 dígitos.");
  }

  const response = await fetch(`https://viacep.com.br/ws/${normalizedCep}/json/`);
  if (!response.ok) throw new Error("Não foi possível consultar o ViaCEP.");

  const data: ViaCepPayload = await response.json();
  if (data.erro) throw new Error("CEP não encontrado.");

  const cityAndUf = [data.localidade, data.uf].filter(Boolean).join("/");
  const addressParts = [data.logradouro, data.bairro, cityAndUf].filter(Boolean);

  return {
    cep: maskCep(data.cep || normalizedCep),
    address: addressParts.join(" - "),
  };
}

function OrgCard({ org, onboarding }: { org: Organization; onboarding?: OrganizationOnboardingSummary }) {
  const [expanded, setExpanded] = useState(false);
  const orgStatus = resolveOrgStatus(org);
  const { data: latestOrg } = useQuery<Organization>({
    queryKey: [`/api/organizations/${org.id}`],
    enabled: expanded,
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}`);
      if (!res.ok) throw new Error("Erro ao carregar organização");
      return res.json();
    },
  });
  const displayOrg = latestOrg ?? org;
  const currentOrgStatus = resolveOrgStatus(displayOrg);
  const currentOrgBadge = getOrgStatusBadge(currentOrgStatus);
  const subscriptionBadge = getSubscriptionBadge(displayOrg.stripeSubscriptionStatus);
  const stripeCustomerUrl = buildStripeDashboardUrl("customer", displayOrg.stripeCustomerId);
  const stripeSubscriptionUrl = buildStripeDashboardUrl("subscription", displayOrg.stripeSubscriptionId);
  const whatsappUrl = buildWhatsappUrl(displayOrg.phone);
  const roleSource = displayOrg;
  const roleOptions = useMemo(() => getRoleOptionsForOrganization(roleSource), [roleSource.environmentSettings]);
  const defaultRole = useMemo(() => {
    const staffFallback = roleOptions.find((option) => option.value === "staff");
    return staffFallback?.value ?? roleOptions[0]?.value ?? "staff";
  }, [roleOptions]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [showEditOrg, setShowEditOrg] = useState(false);
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);
  const [userForm, setUserForm] = useState({ name: "", username: "", password: "", role: defaultRole });
  const [editForm, setEditForm] = useState({ name: "", username: "", password: "", role: defaultRole });
  const [editOrgForm, setEditOrgForm] = useState({
    name: org.name,
    address: removeCepPrefixFromAddress(org.address),
    cep: extractCepFromAddress(org.address),
    phone: maskPhoneBR(org.phone ?? ""),
    email: org.email ?? "",
    cnpj: maskCnpj(org.cnpj ?? ""),
    capacity: String(org.capacity ?? 50),
    status: orgStatus as OrgStatus,
    manualAccessUntil: toDateInputValue(org.manualAccessUntil),
    manualAccessReason: "",
    billingMethod: org.billingMethod ?? "stripe",
    manualBillingDueDay: org.manualBillingDueDay ? String(org.manualBillingDueDay) : "",
    paymentGraceDays: String(org.paymentGraceDays ?? DEFAULT_PAYMENT_GRACE_DAYS),
  });
  const [isLookingUpEditCep, setIsLookingUpEditCep] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const hasValidEditCnpj = isValidCnpj(editOrgForm.cnpj);
  const resolveRoleSelectOptions = (currentRole: string) => {
    if (!currentRole || roleOptions.some((option) => option.value === currentRole)) {
      return roleOptions;
    }
    return [
      ...roleOptions,
      {
        value: currentRole,
        label: ROLE_LABELS[currentRole] ?? toRoleLabel(currentRole),
      },
    ];
  };
  const addUserRoleOptions = useMemo(
    () => resolveRoleSelectOptions(userForm.role),
    [roleOptions, userForm.role],
  );
  const editUserRoleOptions = useMemo(
    () => resolveRoleSelectOptions(editForm.role),
    [roleOptions, editForm.role],
  );
  const roleLabelMap = useMemo(
    () => new Map(roleOptions.map((option) => [option.value, option.label] as const)),
    [roleOptions],
  );

  useEffect(() => {
    setUserForm((current) => (
      roleOptions.some((option) => option.value === current.role)
        ? current
        : { ...current, role: defaultRole }
    ));
    setEditForm((current) => (
      roleOptions.some((option) => option.value === current.role)
        ? current
        : { ...current, role: defaultRole }
    ));
  }, [defaultRole, roleOptions]);

  const { data: orgUsers = [], refetch: refetchUsers } = useQuery<OrgUser[]>({
    queryKey: [`/api/organizations/${org.id}/users`],
    enabled: expanded,
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}/users`);
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
  });

  const { data: usage } = useQuery<OrganizationUsage>({
    queryKey: [`/api/organizations/${org.id}/usage`],
    enabled: expanded,
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}/usage`);
      if (!res.ok) throw new Error("Erro ao carregar uso");
      return res.json();
    },
  });

  const deactivateOrgMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Erro ao inativar organização");
      }
    },
    onSuccess: () => {
      toast({ title: "Organização inativada" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const syncBillingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}/billing/sync`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Erro ao sincronizar Stripe");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Assinatura sincronizada" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/organizations/${org.id}`] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro no Stripe", description: err.message, variant: "destructive" });
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async () => {
      const composedAddress = composeAddress(editOrgForm.cep, editOrgForm.address);
      const res = await fetch(`/api/organizations/${org.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editOrgForm.name.trim(),
          address: composedAddress,
          phone: editOrgForm.phone.trim(),
          email: editOrgForm.email.trim(),
          cnpj: editOrgForm.cnpj.trim(),
          capacity: Number(editOrgForm.capacity) || 50,
          status: editOrgForm.status,
          manualAccessUntil: editOrgForm.manualAccessUntil || null,
          manualAccessReason: editOrgForm.manualAccessReason.trim() || null,
          billingMethod: editOrgForm.billingMethod,
          manualBillingDueDay: editOrgForm.manualBillingDueDay || null,
          paymentGraceDays: editOrgForm.paymentGraceDays || DEFAULT_PAYMENT_GRACE_DAYS,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Erro ao atualizar");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Organização atualizada!" });
      setShowEditOrg(false);
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/organizations/${org.id}`] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const addUserMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Usuário criado com sucesso!" });
      setShowAddUser(false);
      setUserForm({ name: "", username: "", password: "", role: defaultRole });
      refetchUsers();
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const editUserMutation = useMutation({
    mutationFn: async () => {
      if (!editingUser) return;
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Usuário atualizado com sucesso!" });
      setShowEditUser(false);
      setEditingUser(null);
      refetchUsers();
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      await fetch(`/api/users/${userId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Usuário removido" });
      refetchUsers();
    },
  });

  function openEditUser(u: OrgUser) {
    setEditingUser(u);
    setEditForm({ name: u.name, username: u.username, password: "", role: u.role });
    setShowEditPassword(false);
    setShowEditUser(true);
  }

  async function handleLookupEditCep() {
    try {
      setIsLookingUpEditCep(true);
      const result = await fetchAddressByCep(editOrgForm.cep);
      setEditOrgForm((prev) => ({
        ...prev,
        cep: result.cep,
        address: result.address || prev.address,
      }));
      toast({ title: "Endereço preenchido pelo CEP" });
    } catch (err) {
      toast({
        title: "CEP inválido",
        description: err instanceof Error ? err.message : "Não foi possível buscar o CEP.",
        variant: "destructive",
      });
    } finally {
      setIsLookingUpEditCep(false);
    }
  }

  function openEditOrganization(overrides: Partial<typeof editOrgForm> = {}) {
    setEditOrgForm({
      name: displayOrg.name,
      address: removeCepPrefixFromAddress(displayOrg.address),
      cep: extractCepFromAddress(displayOrg.address),
      phone: maskPhoneBR(displayOrg.phone ?? ""),
      email: displayOrg.email ?? "",
      cnpj: maskCnpj(displayOrg.cnpj ?? ""),
      capacity: String(displayOrg.capacity ?? 50),
      status: resolveOrgStatus(displayOrg),
      manualAccessUntil: toDateInputValue(displayOrg.manualAccessUntil),
      manualAccessReason: "",
      billingMethod: displayOrg.billingMethod ?? "stripe",
      manualBillingDueDay: displayOrg.manualBillingDueDay ? String(displayOrg.manualBillingDueDay) : "",
      paymentGraceDays: String(displayOrg.paymentGraceDays ?? DEFAULT_PAYMENT_GRACE_DAYS),
      ...overrides,
    });
    setShowEditOrg(true);
  }

  function openManualRelease() {
    const accessUntil = new Date();
    accessUntil.setDate(accessUntil.getDate() + 30);
    openEditOrganization({
      status: "active",
      billingMethod: "manual_boleto",
      manualAccessUntil: toDateInputValue(accessUntil),
      manualAccessReason: "Pagamento confirmado fora da Stripe.",
      manualBillingDueDay: displayOrg.manualBillingDueDay ? String(displayOrg.manualBillingDueDay) : String(new Date().getDate()),
      paymentGraceDays: String(displayOrg.paymentGraceDays ?? DEFAULT_PAYMENT_GRACE_DAYS),
    });
  }

  return (
    <Card className="overflow-visible">
      <CardHeader className="p-4 sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="flex min-w-0 items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="max-w-full text-base font-semibold leading-tight text-foreground">{displayOrg.name}</h3>
                <Badge className={`text-xs ${currentOrgBadge.className}`}>
                  {currentOrgBadge.label}
                </Badge>
                <Badge className={`text-xs ${subscriptionBadge.className}`}>
                  {subscriptionBadge.label}
                </Badge>
              </div>
              {displayOrg.address && <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{displayOrg.address}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {displayOrg.phone && <span>{maskPhoneBR(displayOrg.phone)}</span>}
                {displayOrg.email && <span>{displayOrg.email}</span>}
                {displayOrg.cnpj && <span>CNPJ: {maskCnpj(displayOrg.cnpj)}</span>}
              </div>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">
                Assinatura: <span className="font-medium text-foreground">{getSubscriptionLabel(displayOrg.stripeSubscriptionStatus)}</span>
                {displayOrg.subscriptionCurrentPeriodEnd && (
                  <span> · período até {formatShortDate(displayOrg.subscriptionCurrentPeriodEnd)}</span>
                )}
                {displayOrg.stripeCancelAtPeriodEnd && (
                  <span> · cancelamento agendado para {formatShortDate(displayOrg.stripeCancelAt ?? displayOrg.subscriptionCurrentPeriodEnd)}</span>
                )}
                {displayOrg.manualAccessUntil && !displayOrg.stripeSubscriptionStatus && (
                  <span> · acesso até {formatShortDate(displayOrg.manualAccessUntil)}</span>
                )}
                {displayOrg.billingMethod === "manual_boleto" && displayOrg.manualBillingDueDay && (
                  <span> · boleto dia {displayOrg.manualBillingDueDay}</span>
                )}
                <span> · tolerância {paymentGraceDays(displayOrg.paymentGraceDays)} dias</span>
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {displayOrg.stripeCustomerId && <span className="font-mono">cus: {displayOrg.stripeCustomerId}</span>}
                {displayOrg.stripeSubscriptionId && <span className="font-mono">sub: {displayOrg.stripeSubscriptionId}</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-medium text-foreground">{displayOrg.capacity ?? 50}</span> vagas disponíveis · criado em {formatShortDate(displayOrg.createdAt)}
              </p>
              {onboarding && (
                <div className="mt-3 max-w-md">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">Implantação</span>
                    <span className="font-semibold text-foreground">{onboarding.percent}%</span>
                  </div>
                  <Progress value={onboarding.percent} className="h-2" />
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-start xl:max-w-[560px] xl:justify-end">
            {whatsappUrl && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-green-600"
                title="Abrir WhatsApp da organização"
              >
                <a href={whatsappUrl} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" />
                </a>
              </Button>
            )}
            {stripeCustomerUrl && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                title="Abrir cliente no Stripe"
              >
                <a href={stripeCustomerUrl} target="_blank" rel="noreferrer">
                  <CreditCard className="h-4 w-4" />
                </a>
              </Button>
            )}
            {stripeSubscriptionUrl && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                title="Abrir assinatura no Stripe"
              >
                <a href={stripeSubscriptionUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
            {(displayOrg.stripeSubscriptionId || displayOrg.stripeCustomerId) && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                disabled={syncBillingMutation.isPending}
                onClick={() => syncBillingMutation.mutate()}
                title="Sincronizar Stripe"
              >
                <RefreshCw className={`h-4 w-4 ${syncBillingMutation.isPending ? "animate-spin" : ""}`} />
              </Button>
            )}
            <Button
              variant="ghost" size="sm"
              onClick={() => setExpanded(!expanded)}
              data-testid={`button-expand-org-${org.id}`}
              className="h-8 justify-center gap-1 text-xs"
            >
              <Users className="h-3.5 w-3.5" />
              Usuários
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 justify-center gap-1 text-xs"
              onClick={openManualRelease}
              data-testid={`button-manual-release-org-${org.id}`}
              title="Liberar acesso manual com data e motivo"
            >
              <UnlockKeyhole className="h-3.5 w-3.5" />
              Liberar manual
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 justify-center gap-1 text-xs"
              title="Ver histórico da organização"
            >
              <a href={`/audit?organizationId=${displayOrg.id}`} target="_blank" rel="noreferrer">
                <History className="h-3.5 w-3.5" />
                Histórico
              </a>
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary"
              onClick={() => openEditOrganization()}
              data-testid={`button-edit-org-${org.id}`}
              title="Editar organização"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => {
                confirm({
                  title: "Inativar organização",
                  description: `Inativar "${displayOrg.name}"? Os usuários não conseguirão entrar até a reativação.`,
                  confirmText: "Inativar",
                  pendingText: "Inativando...",
                  variant: "destructive",
                  onConfirm: () => deactivateOrgMutation.mutateAsync(),
                });
              }}
              data-testid={`button-deactivate-org-${org.id}`}
              title="Inativar organização"
            >
              <Power className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <Separator className="mb-3" />
          {usage && (
            <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Usuários
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{usage.activeUsers}/{usage.users}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  Pacientes
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{usage.activeResidents}/{usage.residents}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Portal família
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{usage.familyPortalAccess}/{usage.familyMembers}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  Último acesso
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">{formatShortDateTime(usage.lastFamilyPortalLoginAt)}</p>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Usuários</p>
              <Button variant="outline" size="sm" className="gap-1 text-xs h-7"
                onClick={() => {
                  setUserForm((current) => ({
                    ...current,
                    role: roleOptions.some((option) => option.value === current.role)
                      ? current.role
                      : defaultRole,
                  }));
                  setShowAddUser(true);
                }} data-testid={`button-add-user-${org.id}`}>
                <UserPlus className="h-3 w-3" />
                Novo usuário
              </Button>
            </div>

            {orgUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Nenhum usuário cadastrado</p>
            ) : (
              <div className="space-y-1">
                {orgUsers.map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 group"
                    data-testid={`user-row-${u.id}`}>
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">@{u.username} - {roleLabelMap.get(u.role) ?? ROLE_LABELS[u.role] ?? u.role}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={() => openEditUser(u)}
                        data-testid={`button-edit-user-${u.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteUserMutation.mutate(u.id)}
                        data-testid={`button-delete-user-${u.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add User Dialog */}
          <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Usuário — {org.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <div>
                  <Label className="text-sm font-medium">Nome completo</Label>
                  <Input className="mt-1.5" placeholder="Ex: João Silva"
                    value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                    data-testid="input-user-name" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Usuário</Label>
                  <Input className="mt-1.5" placeholder="Ex: joao.silva"
                    value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    data-testid="input-user-username" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Senha</Label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Senha de acesso"
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      data-testid="input-user-password"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Perfil</Label>
                  <Select value={userForm.role} onValueChange={(v) => setUserForm({ ...userForm, role: v })}>
                    <SelectTrigger className="mt-1.5" data-testid="select-user-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {addUserRoleOptions.map((option) => (
                        <SelectItem key={`add-user-role-${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Ao criar o acesso, o colaborador correspondente tambem sera vinculado na Equipe desta empresa.
                  </p>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setShowAddUser(false)}>Cancelar</Button>
                  <Button className="flex-1" disabled={addUserMutation.isPending}
                    onClick={() => addUserMutation.mutate()} data-testid="button-confirm-add-user">
                    {addUserMutation.isPending ? "Criando..." : "Criar Usuário"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Edit User Dialog */}
          <Dialog open={showEditUser} onOpenChange={(open) => { setShowEditUser(open); if (!open) setEditingUser(null); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Editar Usuário</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <div>
                  <Label className="text-sm font-medium">Nome completo</Label>
                  <Input className="mt-1.5" placeholder="Ex: João Silva"
                    value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    data-testid="input-edit-user-name" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Usuário (login)</Label>
                  <Input className="mt-1.5" placeholder="Ex: joao.silva"
                    value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                    data-testid="input-edit-user-username" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Perfil</Label>
                  <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                    <SelectTrigger className="mt-1.5" data-testid="select-edit-user-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editUserRoleOptions.map((option) => (
                        <SelectItem key={`edit-user-role-${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium">Nova senha <span className="text-muted-foreground font-normal">(deixe em branco para manter)</span></Label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showEditPassword ? "text" : "password"}
                      placeholder="Nova senha (opcional)"
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      data-testid="input-edit-user-password"
                    />
                    <button type="button" onClick={() => setShowEditPassword(!showEditPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setShowEditUser(false)}>Cancelar</Button>
                  <Button className="flex-1" disabled={editUserMutation.isPending}
                    onClick={() => editUserMutation.mutate()} data-testid="button-confirm-edit-user">
                    {editUserMutation.isPending ? "Salvando..." : "Salvar Alterações"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      )}

      {/* Edit Org Dialog */}
      <Dialog open={showEditOrg} onOpenChange={setShowEditOrg}>
        <DialogContent data-testid={`dialog-edit-org-${org.id}`}>
          <DialogHeader>
            <DialogTitle>Editar Organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div>
              <Label className="text-sm font-medium">Nome *</Label>
              <Input className="mt-1.5" placeholder="Ex: Lar das Flores"
                value={editOrgForm.name} onChange={(e) => setEditOrgForm({ ...editOrgForm, name: e.target.value })}
                data-testid="input-edit-org-name" />
            </div>
            <div>
              <Label className="text-sm font-medium">CEP</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  placeholder="00000-000"
                  maxLength={9}
                  value={editOrgForm.cep}
                  onChange={(e) => setEditOrgForm({ ...editOrgForm, cep: maskCep(e.target.value) })}
                  data-testid="input-edit-org-cep"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={handleLookupEditCep}
                  disabled={isLookingUpEditCep}
                  data-testid="button-edit-org-cep-lookup"
                >
                  {isLookingUpEditCep ? "Buscando..." : "Buscar CEP"}
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Endereço</Label>
              <Input className="mt-1.5" placeholder="Rua, número - Bairro - Cidade/UF"
                value={editOrgForm.address} onChange={(e) => setEditOrgForm({ ...editOrgForm, address: e.target.value })}
                data-testid="input-edit-org-address" />
            </div>
            <div>
              <Label className="text-sm font-medium">Telefone</Label>
              <Input className="mt-1.5" placeholder="(00) 00000-0000" maxLength={15}
                value={editOrgForm.phone} onChange={(e) => setEditOrgForm({ ...editOrgForm, phone: maskPhoneBR(e.target.value) })}
                data-testid="input-edit-org-phone" />
            </div>
            <div>
              <Label className="text-sm font-medium">E-mail</Label>
              <Input className="mt-1.5" type="email" placeholder="financeiro@instituicao.com"
                value={editOrgForm.email} onChange={(e) => setEditOrgForm({ ...editOrgForm, email: e.target.value })}
                data-testid="input-edit-org-email" />
            </div>
            <div>
              <Label className="text-sm font-medium">CNPJ *</Label>
              <Input className="mt-1.5" placeholder="00.000.000/0000-00" maxLength={18}
                value={editOrgForm.cnpj} onChange={(e) => setEditOrgForm({ ...editOrgForm, cnpj: maskCnpj(e.target.value) })}
                data-testid="input-edit-org-cnpj" />
            </div>
            <div>
              <Label className="text-sm font-medium">Status</Label>
              <Select
                value={editOrgForm.status}
                onValueChange={(value: OrgStatus) => setEditOrgForm({ ...editOrgForm, status: value })}
              >
                <SelectTrigger className="mt-1.5" data-testid="select-edit-org-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativa</SelectItem>
                  <SelectItem value="inactive">Inativa</SelectItem>
                  <SelectItem value="restricted">Restrita / pagamento pendente</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Restrita libera apenas a tela de pagamento. Inativa bloqueia o login.
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Acesso manual até</Label>
              <Input
                className="mt-1.5"
                type="date"
                value={editOrgForm.manualAccessUntil}
                onChange={(e) => setEditOrgForm({ ...editOrgForm, manualAccessUntil: e.target.value })}
                data-testid="input-edit-org-manual-access-until"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use para migração ou pagamento confirmado fora da Stripe. Ao vencer, o cliente volta para regularização.
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Motivo da liberação manual</Label>
              <Textarea
                className="mt-1.5 resize-none"
                rows={2}
                placeholder="Ex: pagamento confirmado por boleto, negociação comercial ou ajuste do suporte"
                value={editOrgForm.manualAccessReason}
                onChange={(e) => setEditOrgForm({ ...editOrgForm, manualAccessReason: e.target.value })}
                data-testid="textarea-edit-org-manual-access-reason"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Opcional. Quando preenchido, fica registrado no histórico da organização.
              </p>
            </div>
            <div className={`grid gap-3 ${editOrgForm.billingMethod === "manual_boleto" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              <div>
                <Label className="text-sm font-medium">Cobrança</Label>
                <Select
                  value={editOrgForm.billingMethod}
                  onValueChange={(value) => setEditOrgForm({
                    ...editOrgForm,
                    billingMethod: value,
                    manualBillingDueDay: value === "manual_boleto" ? editOrgForm.manualBillingDueDay : "",
                  })}
                >
                  <SelectTrigger className="mt-1.5" data-testid="select-edit-org-billing-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stripe">Stripe</SelectItem>
                    <SelectItem value="manual_boleto">Boleto manual</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {editOrgForm.billingMethod === "manual_boleto"
                    ? "Use apenas para clientes que continuarão fora da Stripe."
                    : "Clientes novos e migrações usam checkout da Stripe."}
                </p>
              </div>
              {editOrgForm.billingMethod === "manual_boleto" && (
                <div>
                  <Label className="text-sm font-medium">Vencimento boleto</Label>
                  <Input
                    className="mt-1.5"
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Ex: 15"
                    value={editOrgForm.manualBillingDueDay}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, manualBillingDueDay: e.target.value })}
                    data-testid="input-edit-org-manual-billing-due-day"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Dia do mês para cobrar no boleto, de 1 a 31.
                  </p>
                </div>
              )}
              <div>
                <Label className="text-sm font-medium">Tolerância (dias)</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  min="0"
                  max="60"
                  placeholder="Ex: 10"
                  value={editOrgForm.paymentGraceDays}
                  onChange={(e) => setEditOrgForm({ ...editOrgForm, paymentGraceDays: e.target.value })}
                  data-testid="input-edit-org-payment-grace-days"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Dias após o vencimento antes de restringir o acesso.
                </p>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Capacidade de Vagas</Label>
              <Input className="mt-1.5" type="number" min="1" placeholder="Ex: 30"
                value={editOrgForm.capacity} onChange={(e) => setEditOrgForm({ ...editOrgForm, capacity: e.target.value })}
                data-testid="input-edit-org-capacity" />
              <p className="text-xs text-muted-foreground mt-1">Número máximo de pacientes que a unidade comporta</p>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowEditOrg(false)}>Cancelar</Button>
              <Button className="flex-1" disabled={updateOrgMutation.isPending || !editOrgForm.name.trim() || !hasValidEditCnpj}
                onClick={() => updateOrgMutation.mutate()} data-testid="button-confirm-edit-org">
                {updateOrgMutation.isPending ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </Card>
  );
}

export default function Admin() {
  const [showAddOrg, setShowAddOrg] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrgStatus | "all">("all");
  const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>("all");
  const [orgForm, setOrgForm] = useState({
    name: "",
    cep: "",
    address: "",
    phone: "",
    email: "",
    cnpj: "",
    capacity: "50",
    status: "restricted" as OrgStatus,
    manualAccessUntil: "",
    billingMethod: "stripe",
    manualBillingDueDay: "",
    paymentGraceDays: String(DEFAULT_PAYMENT_GRACE_DAYS),
  });
  const [isLookingUpOrgCep, setIsLookingUpOrgCep] = useState(false);
  const { toast } = useToast();
  const hasValidOrgCnpj = isValidCnpj(orgForm.cnpj);

  const { data: organizations = [], isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/organizations", { showInactive }],
    queryFn: async () => {
      const url = showInactive ? "/api/organizations?includeInactive=true" : "/api/organizations";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Erro ao carregar organizações");
      return res.json();
    },
  });

  const { data: onboardingSummaries = [] } = useQuery<OrganizationOnboardingSummary[]>({
    queryKey: ["/api/organizations/onboarding-summary"],
    queryFn: async () => {
      const res = await fetch("/api/organizations/onboarding-summary");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30000,
  });

  const onboardingByOrgId = useMemo(
    () => new Map(onboardingSummaries.map((summary) => [summary.organizationId, summary] as const)),
    [onboardingSummaries],
  );

  const organizationStats = useMemo(() => {
    const total = organizations.length;
    const active = organizations.filter((org) => resolveOrgStatus(org) === "active").length;
    const restricted = organizations.filter((org) => resolveOrgStatus(org) === "restricted").length;
    const inactive = organizations.filter((org) => resolveOrgStatus(org) === "inactive").length;
    const trialing = organizations.filter((org) => org.stripeSubscriptionStatus === "trialing").length;
    const trialEnding = organizations.filter(isTrialEndingSoon).length;
    const paymentIssue = organizations.filter((org) => getSubscriptionFilter(org.stripeSubscriptionStatus) === "past_due").length;
    const manualBoleto = organizations.filter((org) => org.billingMethod === "manual_boleto").length;
    const cancellations = organizations.filter((org) => org.stripeCancelAtPeriodEnd || org.stripeSubscriptionStatus === "canceled").length;
    const noStripe = organizations.filter((org) => !org.stripeCustomerId && !org.stripeSubscriptionId).length;
    const billingRisk = organizations.filter(isBillingRisk).length;
    const needsAction = organizations.filter(needsCommercialAction).length;
    return { total, active, restricted, inactive, trialing, trialEnding, paymentIssue, manualBoleto, cancellations, noStripe, billingRisk, needsAction };
  }, [organizations]);

  const commercialQueues = useMemo(() => {
    const trialEnding = organizations
      .filter(isTrialEndingSoon)
      .sort((left, right) => (daysUntilDate(left.subscriptionCurrentPeriodEnd) ?? 99) - (daysUntilDate(right.subscriptionCurrentPeriodEnd) ?? 99))
      .slice(0, 5);
    const billingRisk = organizations
      .filter(isBillingRisk)
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
      .slice(0, 5);
    const noStripe = organizations
      .filter((org) => !org.stripeCustomerId && !org.stripeSubscriptionId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 5);
    const needsAction = organizations
      .filter(needsCommercialAction)
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
      .slice(0, 8);
    const onboardingIncomplete = organizations
      .map((org) => ({ org, summary: onboardingByOrgId.get(org.id) }))
      .filter((item) => item.summary && item.summary.percent < 70)
      .sort((left, right) => (left.summary?.percent ?? 100) - (right.summary?.percent ?? 100))
      .slice(0, 5);
    return { trialEnding, billingRisk, noStripe, needsAction, onboardingIncomplete };
  }, [onboardingByOrgId, organizations]);

  const filteredOrganizations = useMemo(() => {
    const normalizedSearch = normalizeSearchText(searchTerm);
    const searchDigits = digitsOnly(searchTerm);

    return organizations.filter((org) => {
      const orgStatus = resolveOrgStatus(org);
      if (statusFilter !== "all" && orgStatus !== statusFilter) return false;
      if (subscriptionFilter === "needs_action") {
        if (!needsCommercialAction(org)) return false;
      } else if (subscriptionFilter === "trial_ending") {
        if (!isTrialEndingSoon(org)) return false;
      } else if (subscriptionFilter === "billing_risk") {
        if (!isBillingRisk(org)) return false;
      } else if (subscriptionFilter === "manual_boleto") {
        if (org.billingMethod !== "manual_boleto") return false;
      } else if (subscriptionFilter !== "all" && getSubscriptionFilter(org.stripeSubscriptionStatus) !== subscriptionFilter) {
        return false;
      }
      if (!normalizedSearch && !searchDigits) return true;

      const textHaystack = normalizeSearchText([
        org.name,
        org.cnpj,
        org.phone,
        org.email,
        org.stripeCustomerId,
        org.stripeSubscriptionId,
      ].filter(Boolean).join(" "));
      const digitHaystack = digitsOnly([org.cnpj, org.phone].filter(Boolean).join(" "));

      return textHaystack.includes(normalizedSearch)
        || (searchDigits.length > 0 && digitHaystack.includes(searchDigits));
    });
  }, [organizations, searchTerm, statusFilter, subscriptionFilter]);

  const createOrgMutation = useMutation({
    mutationFn: async () => {
      const composedAddress = composeAddress(orgForm.cep, orgForm.address);
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: orgForm.name.trim(),
          address: composedAddress,
          phone: orgForm.phone.trim(),
          email: orgForm.email.trim(),
          cnpj: orgForm.cnpj.trim(),
          capacity: Number(orgForm.capacity) || 50,
          status: orgForm.status,
          manualAccessUntil: orgForm.manualAccessUntil || null,
          billingMethod: orgForm.billingMethod,
          manualBillingDueDay: orgForm.manualBillingDueDay || null,
          paymentGraceDays: orgForm.paymentGraceDays || DEFAULT_PAYMENT_GRACE_DAYS,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Organização criada com sucesso!" });
      setShowAddOrg(false);
      setOrgForm({
        name: "",
        cep: "",
        address: "",
        phone: "",
        email: "",
        cnpj: "",
        capacity: "50",
        status: "restricted",
        manualAccessUntil: "",
        billingMethod: "stripe",
        manualBillingDueDay: "",
        paymentGraceDays: String(DEFAULT_PAYMENT_GRACE_DAYS),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  async function handleLookupOrgCep() {
    try {
      setIsLookingUpOrgCep(true);
      const result = await fetchAddressByCep(orgForm.cep);
      setOrgForm((prev) => ({
        ...prev,
        cep: result.cep,
        address: result.address || prev.address,
      }));
      toast({ title: "Endereço preenchido pelo CEP" });
    } catch (err) {
      toast({
        title: "CEP inválido",
        description: err instanceof Error ? err.message : "Não foi possível buscar o CEP.",
        variant: "destructive",
      });
    } finally {
      setIsLookingUpOrgCep(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground font-display">Organizações</h1>
            <Badge className="bg-amber-500 text-white text-xs">Super Admin</Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            Gerencie todas as casas de repouso cadastradas no sistema
          </p>
        </div>
        <Button onClick={() => setShowAddOrg(true)} className="gap-2 shrink-0" data-testid="button-add-org">
          <Plus className="h-4 w-4" />
          Nova Organização
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          { label: "Ativos", value: organizationStats.active, desc: `${organizationStats.total} contas no total`, icon: Building2, color: "text-emerald-600" },
          { label: "Trial", value: organizationStats.trialing, desc: `${organizationStats.trialEnding} vencendo`, icon: Clock3, color: "text-cyan-600" },
          { label: "Pendentes", value: organizationStats.paymentIssue, desc: `${organizationStats.billingRisk} com risco`, icon: AlertTriangle, color: "text-orange-500" },
          { label: "Boleto manual", value: organizationStats.manualBoleto, desc: "cobrança fora da Stripe", icon: CreditCard, color: "text-blue-600" },
          { label: "Restritos", value: organizationStats.restricted, desc: "acesso limitado", icon: Ban, color: "text-red-600" },
          { label: "Cancelamentos", value: organizationStats.cancellations, desc: "cancelado ou agendado", icon: Power, color: "text-slate-600" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className={`h-4 w-4 ${item.color}`} />
                {item.label}
              </div>
              <p className="mt-2 text-2xl font-bold text-foreground">{item.value}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          setSubscriptionFilter("needs_action");
          setStatusFilter("all");
        }}
        className="flex w-full flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md md:flex-row md:items-center md:justify-between"
        data-testid="button-filter-needs-action"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-950">Precisa de ação</p>
            <p className="mt-1 text-xs leading-5 text-blue-800/75">
              Trial vencendo, boleto próximo, pagamento falhou ou cliente sem plano configurado.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-blue-950">{organizationStats.needsAction}</span>
          <span className="text-xs font-semibold text-blue-700">Filtrar lista</span>
        </div>
      </button>

      <div className="grid gap-4 xl:grid-cols-4">
        <Card className="rounded-lg border-cyan-200 bg-cyan-50/70 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-cyan-700">Follow-up</p>
                <h2 className="mt-1 text-base font-semibold text-cyan-950">Trials vencendo</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-md border-cyan-200 bg-white text-xs text-cyan-700 hover:bg-cyan-100"
                onClick={() => {
                  setSubscriptionFilter("trial_ending");
                  setStatusFilter("all");
                }}
              >
                Filtrar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {commercialQueues.trialEnding.length === 0 ? (
              <p className="text-sm text-cyan-800/70">Nenhum trial vencendo nos próximos 7 dias.</p>
            ) : commercialQueues.trialEnding.map((org) => {
              const days = daysUntilDate(org.subscriptionCurrentPeriodEnd);
              const message = trialEndingMessage(org, days);
              const whatsappUrl = buildWhatsappUrl(org.phone, message);
              const mailtoUrl = buildMailtoUrl(org.email, "Seu teste grátis EasyCare está vencendo", message);
              return (
                <div key={`trial-ending-${org.id}`} className="flex items-center justify-between gap-3 rounded-md border border-cyan-200 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-cyan-950">{org.name}</p>
                    <p className="text-xs text-cyan-800/65">
                      {days === 0 ? "vence hoje" : `vence em ${days} dia${days === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {mailtoUrl && (
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-cyan-700">
                        <a href={mailtoUrl} title="Enviar e-mail">
                          <Mail className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {whatsappUrl && (
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-cyan-700">
                        <a href={whatsappUrl} target="_blank" rel="noreferrer" title="Chamar no WhatsApp">
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-orange-200 bg-orange-50/80 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-orange-700">Atenção</p>
                <h2 className="mt-1 text-base font-semibold text-orange-950">Cobrança com risco</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-md border-orange-200 bg-white text-xs text-orange-700 hover:bg-orange-100"
                onClick={() => {
                  setSubscriptionFilter("billing_risk");
                  setStatusFilter("all");
                }}
              >
                Filtrar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {commercialQueues.billingRisk.length === 0 ? (
              <p className="text-sm text-orange-800/70">Nenhuma conta com cobrança crítica agora.</p>
            ) : commercialQueues.billingRisk.map((org) => {
              const stripeUrl = buildStripeDashboardUrl("subscription", org.stripeSubscriptionId);
              const message = billingRiskMessage(org);
              const whatsappUrl = buildWhatsappUrl(org.phone, message);
              const mailtoUrl = buildMailtoUrl(org.email, "Pendência de cobrança EasyCare", message);
              return (
                <div key={`billing-risk-${org.id}`} className="flex items-center justify-between gap-3 rounded-md border border-orange-200 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-orange-950">{org.name}</p>
                    <p className="text-xs text-orange-800/65">
                      {resolveOrgStatus(org) === "restricted" ? "acesso restrito" : getSubscriptionLabel(org.stripeSubscriptionStatus)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {mailtoUrl && (
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-orange-700">
                        <a href={mailtoUrl} title="Enviar e-mail">
                          <Mail className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {whatsappUrl && (
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-orange-700">
                        <a href={whatsappUrl} target="_blank" rel="noreferrer" title="Chamar no WhatsApp">
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {stripeUrl && (
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-orange-700">
                        <a href={stripeUrl} target="_blank" rel="noreferrer" title="Abrir assinatura no Stripe">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Ativação</p>
                <h2 className="mt-1 text-base font-semibold text-slate-950">Sem Stripe</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-md text-xs"
                onClick={() => {
                  setSubscriptionFilter("none");
                  setStatusFilter("all");
                }}
              >
                Filtrar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {commercialQueues.noStripe.length === 0 ? (
              <p className="text-sm text-slate-500">Todas as contas carregadas já têm referência Stripe.</p>
            ) : commercialQueues.noStripe.map((org) => {
              const message = noStripeMessage(org);
              const whatsappUrl = buildWhatsappUrl(org.phone, message);
              const mailtoUrl = buildMailtoUrl(org.email, "Ativação da assinatura EasyCare", message);
              return (
                <div key={`no-stripe-${org.id}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950">{org.name}</p>
                    <p className="text-xs text-slate-500">criada em {formatShortDate(org.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {mailtoUrl && (
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-slate-600">
                        <a href={mailtoUrl} title="Enviar e-mail">
                          <Mail className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {whatsappUrl && (
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-slate-600">
                        <a href={whatsappUrl} target="_blank" rel="noreferrer" title="Chamar no WhatsApp">
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-blue-200 bg-blue-50/70 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-blue-700">Implantação</p>
                <h2 className="mt-1 text-base font-semibold text-blue-950">Abaixo de 70%</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {commercialQueues.onboardingIncomplete.length === 0 ? (
              <p className="text-sm text-blue-800/70">Nenhuma implantação crítica carregada.</p>
            ) : commercialQueues.onboardingIncomplete.map(({ org, summary }) => (
              <div key={`onboarding-${org.id}`} className="rounded-md border border-blue-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-blue-950">{org.name}</p>
                  <span className="text-xs font-bold text-blue-700">{summary?.percent ?? 0}%</span>
                </div>
                <Progress value={summary?.percent ?? 0} className="mt-2 h-2" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_220px_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="pl-9"
              placeholder="Buscar por nome, CNPJ, telefone ou Stripe"
              data-testid="input-admin-org-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as OrgStatus | "all")}>
            <SelectTrigger data-testid="select-admin-org-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              <SelectItem value="active">Ativas</SelectItem>
              <SelectItem value="restricted">Pgto. pendente</SelectItem>
              <SelectItem value="inactive">Inativas</SelectItem>
            </SelectContent>
          </Select>
          <Select value={subscriptionFilter} onValueChange={(value) => setSubscriptionFilter(value as SubscriptionFilter)}>
            <SelectTrigger data-testid="select-admin-org-subscription-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas assinaturas</SelectItem>
              <SelectItem value="needs_action">Precisa de ação</SelectItem>
              <SelectItem value="trialing">Teste grátis</SelectItem>
              <SelectItem value="trial_ending">Trial vencendo</SelectItem>
              <SelectItem value="billing_risk">Cobrança com risco</SelectItem>
              <SelectItem value="manual_boleto">Boleto manual</SelectItem>
              <SelectItem value="active">Ativa</SelectItem>
              <SelectItem value="past_due">Pagamento atrasado</SelectItem>
              <SelectItem value="none">Sem Stripe</SelectItem>
              <SelectItem value="problem">Cancelada/pausada</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 lg:min-w-[210px]">
            <div>
              <p className="text-sm font-medium text-foreground">Inativas</p>
              <p className="text-xs text-muted-foreground">Incluir na lista</p>
            </div>
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              data-testid="toggle-show-inactive-orgs"
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Exibindo {filteredOrganizations.length} de {organizations.length} organizações carregadas.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2].map((i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : filteredOrganizations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Building2 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">Nenhuma organização encontrada</p>
            <Button variant="outline" onClick={() => setShowAddOrg(true)}>Nova organização</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="max-h-[calc(100vh-280px)] min-h-[280px] overflow-y-auto pr-1">
          <div className="grid gap-4">
            {filteredOrganizations.map((org) => <OrgCard key={org.id} org={org} onboarding={onboardingByOrgId.get(org.id)} />)}
          </div>
        </div>
      )}

      <Dialog open={showAddOrg} onOpenChange={setShowAddOrg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Casa de Repouso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div>
              <Label className="text-sm font-medium">Nome *</Label>
              <Input className="mt-1.5" placeholder="Ex: Lar das Flores"
                value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                data-testid="input-org-name" />
            </div>
            <div>
              <Label className="text-sm font-medium">CEP</Label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="00000-000"
                  maxLength={9}
                  value={orgForm.cep}
                  onChange={(e) => setOrgForm({ ...orgForm, cep: maskCep(e.target.value) })}
                  data-testid="input-org-cep"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full shrink-0 sm:w-auto"
                  onClick={handleLookupOrgCep}
                  disabled={isLookingUpOrgCep}
                  data-testid="button-org-cep-lookup"
                >
                  {isLookingUpOrgCep ? "Buscando..." : "Buscar CEP"}
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Endereço</Label>
              <Input className="mt-1.5" placeholder="Rua, número - Bairro - Cidade/UF"
                value={orgForm.address} onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                data-testid="input-org-address" />
            </div>
            <div>
              <Label className="text-sm font-medium">Telefone</Label>
              <Input className="mt-1.5" placeholder="(00) 00000-0000" maxLength={15}
                value={orgForm.phone} onChange={(e) => setOrgForm({ ...orgForm, phone: maskPhoneBR(e.target.value) })}
                data-testid="input-org-phone" />
            </div>
            <div>
              <Label className="text-sm font-medium">E-mail</Label>
              <Input className="mt-1.5" type="email" placeholder="financeiro@instituicao.com"
                value={orgForm.email} onChange={(e) => setOrgForm({ ...orgForm, email: e.target.value })}
                data-testid="input-org-email" />
            </div>
            <div>
              <Label className="text-sm font-medium">CNPJ *</Label>
              <Input className="mt-1.5" placeholder="00.000.000/0000-00" maxLength={18}
                value={orgForm.cnpj} onChange={(e) => setOrgForm({ ...orgForm, cnpj: maskCnpj(e.target.value) })}
                data-testid="input-org-cnpj" />
            </div>
            <div>
              <Label className="text-sm font-medium">Status</Label>
              <Select
                value={orgForm.status}
                onValueChange={(value: OrgStatus) => setOrgForm({ ...orgForm, status: value })}
              >
                <SelectTrigger className="mt-1.5" data-testid="select-org-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativa</SelectItem>
                  <SelectItem value="inactive">Inativa</SelectItem>
                  <SelectItem value="restricted">Restrita / pagamento pendente</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Use restrita para clientes que precisam pagar antes de acessar os módulos internos.
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Acesso manual até</Label>
              <Input
                className="mt-1.5"
                type="date"
                value={orgForm.manualAccessUntil}
                onChange={(e) => setOrgForm({ ...orgForm, manualAccessUntil: e.target.value })}
                data-testid="input-org-manual-access-until"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use para migração ou pagamento confirmado fora da Stripe. Ao vencer, o cliente volta para regularização.
              </p>
            </div>
            <div className={`grid gap-3 ${orgForm.billingMethod === "manual_boleto" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              <div>
                <Label className="text-sm font-medium">Cobrança</Label>
                <Select
                  value={orgForm.billingMethod}
                  onValueChange={(value) => setOrgForm({
                    ...orgForm,
                    billingMethod: value,
                    manualBillingDueDay: value === "manual_boleto" ? orgForm.manualBillingDueDay : "",
                  })}
                >
                  <SelectTrigger className="mt-1.5" data-testid="select-org-billing-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stripe">Stripe</SelectItem>
                    <SelectItem value="manual_boleto">Boleto manual</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {orgForm.billingMethod === "manual_boleto"
                    ? "Use apenas para clientes que continuarão fora da Stripe."
                    : "Clientes novos e migrações usam checkout da Stripe."}
                </p>
              </div>
              {orgForm.billingMethod === "manual_boleto" && (
                <div>
                  <Label className="text-sm font-medium">Vencimento boleto</Label>
                  <Input
                    className="mt-1.5"
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Ex: 15"
                    value={orgForm.manualBillingDueDay}
                    onChange={(e) => setOrgForm({ ...orgForm, manualBillingDueDay: e.target.value })}
                    data-testid="input-org-manual-billing-due-day"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Dia do mês para cobrar no boleto, de 1 a 31.
                  </p>
                </div>
              )}
              <div>
                <Label className="text-sm font-medium">Tolerância (dias)</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  min="0"
                  max="60"
                  placeholder="Ex: 10"
                  value={orgForm.paymentGraceDays}
                  onChange={(e) => setOrgForm({ ...orgForm, paymentGraceDays: e.target.value })}
                  data-testid="input-org-payment-grace-days"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Dias após o vencimento antes de restringir o acesso.
                </p>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Capacidade de Vagas *</Label>
              <Input className="mt-1.5" type="number" min="1" placeholder="Ex: 30"
                value={orgForm.capacity} onChange={(e) => setOrgForm({ ...orgForm, capacity: e.target.value })}
                data-testid="input-org-capacity" />
              <p className="text-xs text-muted-foreground mt-1">Número máximo de pacientes que a unidade comporta</p>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddOrg(false)}>Cancelar</Button>
              <Button className="flex-1" disabled={createOrgMutation.isPending || !orgForm.name.trim() || !hasValidOrgCnpj}
                onClick={() => createOrgMutation.mutate()} data-testid="button-confirm-add-org">
                {createOrgMutation.isPending ? "Criando..." : "Criar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}



