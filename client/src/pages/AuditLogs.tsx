import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Building2, ClipboardList, Search, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";

type AuditLog = {
  id: number;
  organizationId?: number | null;
  userId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  message: string;
  metadata?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  organizationName?: string | null;
  userName?: string | null;
};

type Organization = {
  id: number;
  name: string;
};

const actionLabels: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  "organization.signup": "Cadastro self-service",
  "organization.created": "Organização criada",
  "organization.updated": "Organização alterada",
  "organization.manual_access_released": "Liberação manual",
  "organization.deleted": "Organização removida",
  "billing.checkout_started": "Checkout iniciado",
  "billing.portal_opened": "Portal Stripe aberto",
  "user.created": "Usuário criado",
  "user.updated": "Usuário alterado",
  "user.deleted": "Usuário removido",
  "resident.created": "Paciente criado",
  "resident.updated": "Paciente alterado",
  "resident.deleted": "Paciente removido",
  "family.created": "Familiar criado",
  "family.updated": "Familiar alterado",
  "family.deleted": "Familiar removido",
  "family.invite_created": "Convite familiar",
  "family.portal_activated": "Portal ativado",
  "family.portal_login": "Login família",
  "family.portal_logout": "Logout família",
};

const entityLabels: Record<string, string> = {
  organization: "Organização",
  user: "Usuário",
  superadmin: "Superadmin",
  resident: "Paciente",
  family_member: "Familiar",
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalize(value?: string | null) {
  return String(value ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function actionBadgeClass(action: string) {
  if (action.includes("deleted")) return "border-red-200 bg-red-50 text-red-700";
  if (action.includes("billing")) return "border-blue-200 bg-blue-50 text-blue-700";
  if (action.includes("invite")) return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (action.includes("created") || action.includes("signup")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function AuditLogs() {
  const { user } = useAuth();
  const initialOrganizationId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("organizationId") ?? "all"
    : "all";
  const [search, setSearch] = useState("");
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [action, setAction] = useState("all");
  const [entityType, setEntityType] = useState("all");

  const { data: organizations = [] } = useQuery<Organization[]>({
    queryKey: ["/api/organizations", "audit-filter"],
    enabled: !!user?.isSuperAdmin,
    queryFn: async () => {
      const res = await fetch("/api/organizations?includeInactive=true", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit-logs", organizationId, action, entityType],
    enabled: !!user,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (organizationId !== "all") params.set("organizationId", organizationId);
      if (action !== "all") params.set("action", action);
      if (entityType !== "all") params.set("entityType", entityType);
      const res = await fetch(`/api/audit-logs?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao carregar auditoria");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const filteredLogs = useMemo(() => {
    const normalizedSearch = normalize(search);
    if (!normalizedSearch) return logs;
    return logs.filter((log) => normalize([
      log.message,
      log.actorName,
      log.organizationName,
      log.action,
      log.entityType,
      log.ipAddress,
    ].join(" ")).includes(normalizedSearch));
  }, [logs, search]);

  const uniqueActions = useMemo(() => {
    const values = new Set(Object.keys(actionLabels));
    logs.forEach((log) => values.add(log.action));
    return Array.from(values).sort((left, right) => left.localeCompare(right, "pt-BR"));
  }, [logs]);

  const uniqueEntities = useMemo(() => {
    const values = new Set(Object.keys(entityLabels));
    logs.forEach((log) => values.add(log.entityType));
    return Array.from(values).sort((left, right) => left.localeCompare(right, "pt-BR"));
  }, [logs]);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#D5E4F2] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md border border-[#0B5CAB]/15 bg-[#F0F8FF] px-3 py-1.5 text-sm font-bold text-[#0B5CAB]">
              <ShieldCheck className="h-4 w-4" />
              Auditoria
            </div>
            <h1 className="mt-4 text-3xl font-extrabold tracking-normal text-[#25314B]">
              Logs de atividade
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#65758B]">
              Acompanhe acessos e alterações importantes feitas por equipe, gestores e superadmin.
            </p>
          </div>
          <div className="grid min-w-[260px] grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 text-sm">
            <div>
              <p className="text-xs font-bold uppercase text-[#65758B]">Eventos</p>
              <p className="mt-1 text-2xl font-extrabold text-[#25314B]">{filteredLogs.length}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-[#65758B]">Último</p>
              <p className="mt-1 text-sm font-bold text-[#25314B]">{formatDateTime(filteredLogs[0]?.createdAt)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="Buscar mensagem, pessoa, IP ou organização"
            />
          </div>
          {user?.isSuperAdmin && (
            <Select value={organizationId} onValueChange={setOrganizationId}>
              <SelectTrigger>
                <SelectValue placeholder="Organização" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas organizações</SelectItem>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={String(organization.id)}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger>
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas ações</SelectItem>
              {uniqueActions.map((item) => (
                <SelectItem key={item} value={item}>
                  {actionLabels[item] ?? item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger>
              <SelectValue placeholder="Entidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas entidades</SelectItem>
              {uniqueEntities.map((item) => (
                <SelectItem key={item} value={item}>
                  {entityLabels[item] ?? item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <Card className="rounded-lg border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-[#25314B]">
            <ClipboardList className="h-4 w-4 text-[#0B5CAB]" />
            Eventos recentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-md bg-slate-100" />)}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Nenhum evento encontrado.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredLogs.map((log) => (
                <div key={log.id} className="grid gap-3 py-4 lg:grid-cols-[180px_1fr_180px] lg:items-center">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">{formatDateTime(log.createdAt)}</p>
                    {log.ipAddress && <p className="mt-1 text-[11px] text-slate-400">{log.ipAddress}</p>}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={actionBadgeClass(log.action)}>
                        {actionLabels[log.action] ?? log.action}
                      </Badge>
                      <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                        {entityLabels[log.entityType] ?? log.entityType}
                        {log.entityId ? ` #${log.entityId}` : ""}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-[#25314B]">{log.message}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {log.actorName || log.userName || "Sistema"} {log.actorRole ? `· ${log.actorRole}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 lg:justify-end">
                    {log.organizationName ? (
                      <>
                        <Building2 className="h-3.5 w-3.5" />
                        <span className="truncate">{log.organizationName}</span>
                      </>
                    ) : (
                      <>
                        <Activity className="h-3.5 w-3.5" />
                        <span>Global</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
