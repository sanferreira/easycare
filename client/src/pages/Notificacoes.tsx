import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Bell, CheckCheck, CircleCheck, Clock3, ExternalLink, Info, Search } from "lucide-react";
import { useLocation } from "wouter";
import type { AppNotification } from "@shared/schema";
import { NOTIFICATION_MODULE_LABELS } from "@shared/notifications";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationSetupCard } from "@/components/NotificationSetupCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type NotificationResponse = {
  notifications: AppNotification[];
  unreadCount: number;
};

const MODULE_LABELS: Record<string, string> = { ...NOTIFICATION_MODULE_LABELS };

const NOTIFICATION_HISTORY_REFETCH_INTERVAL_MS = 10_000;

const SEVERITY_LABELS: Record<string, string> = {
  info: "Informativa",
  success: "Sucesso",
  warning: "Atencao",
  error: "Critica",
};

const severityView = {
  success: {
    icon: CircleCheck,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  error: {
    icon: AlertTriangle,
    className: "border-red-200 bg-red-50 text-red-700",
  },
  info: {
    icon: Info,
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
};

function formatDateTime(value: AppNotification["createdAt"]) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

export default function Notificacoes() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");

  const notificationsQuery = useQuery<NotificationResponse>({
    queryKey: ["notifications", "history"],
    refetchInterval: NOTIFICATION_HISTORY_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=100", { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao carregar notificacoes.");
      return res.json();
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/notifications/${id}/read`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/notifications/read-all");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const notifications = notificationsQuery.data?.notifications ?? [];
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const moduleOptions = useMemo(
    () => Array.from(new Set(notifications.map((item) => item.sourceModule))).sort(),
    [notifications],
  );

  const filteredNotifications = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return notifications.filter((notification) => {
      if (readFilter === "unread" && notification.readAt) return false;
      if (readFilter === "read" && !notification.readAt) return false;
      if (moduleFilter !== "all" && notification.sourceModule !== moduleFilter) return false;
      if (severityFilter !== "all" && notification.severity !== severityFilter) return false;
      if (!normalizedSearch) return true;
      return [
        notification.title,
        notification.message,
        MODULE_LABELS[notification.sourceModule] ?? notification.sourceModule,
        SEVERITY_LABELS[notification.severity] ?? notification.severity,
      ].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch));
    });
  }, [moduleFilter, notifications, readFilter, search, severityFilter]);

  const openNotification = (notification: AppNotification) => {
    if (!notification.readAt) markReadMutation.mutate(notification.id);
    if (notification.actionUrl) navigate(notification.actionUrl);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4" />
            Central interna
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Notificacoes</h1>
          <p className="text-sm text-muted-foreground">
            Historico das notificacoes recebidas no sistema.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2 sm:w-auto"
          disabled={unreadCount === 0 || markAllReadMutation.isPending}
          onClick={() => markAllReadMutation.mutate()}
        >
          <CheckCheck className="h-4 w-4" />
          Marcar todas como lidas
        </Button>
      </div>

      <NotificationSetupCard />

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Nao lidas</p>
            <p className="mt-1 text-2xl font-semibold">{unreadCount}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">No historico</p>
            <p className="mt-1 text-2xl font-semibold">{notifications.length}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Exibindo</p>
            <p className="mt-1 text-2xl font-semibold">{filteredNotifications.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historico</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por titulo, mensagem ou modulo"
              />
            </div>
            <Select value={readFilter} onValueChange={(value) => setReadFilter(value as typeof readFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="unread">Nao lidas</SelectItem>
                <SelectItem value="read">Lidas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Modulo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os modulos</SelectItem>
                {moduleOptions.map((module) => (
                  <SelectItem key={module} value={module}>
                    {MODULE_LABELS[module] ?? module}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {notificationsQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4 animate-pulse" />
              Carregando notificacoes...
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Nenhuma notificacao encontrada.
            </div>
          ) : (
            <div className="divide-y rounded-lg border border-border/70">
              {filteredNotifications.map((notification) => {
                const severity = severityView[notification.severity as keyof typeof severityView] ?? severityView.info;
                const Icon = severity.icon;
                const isUnread = !notification.readAt;
                return (
                  <div
                    key={notification.id}
                    className={cn("flex flex-col gap-3 p-4 lg:flex-row lg:items-start", isUnread && "bg-blue-50/60")}
                  >
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", severity.className)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{notification.title}</p>
                        {isUnread ? (
                          <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Nova</Badge>
                        ) : (
                          <Badge variant="outline">Lida</Badge>
                        )}
                        <Badge variant="outline">
                          {MODULE_LABELS[notification.sourceModule] ?? notification.sourceModule}
                        </Badge>
                        <Badge variant="outline" className={severity.className}>
                          {SEVERITY_LABELS[notification.severity] ?? notification.severity}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{notification.message}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Recebida em {formatDateTime(notification.createdAt)}
                        {notification.readAt ? ` - lida em ${formatDateTime(notification.readAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                      {isUnread && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          disabled={markReadMutation.isPending}
                          onClick={() => markReadMutation.mutate(notification.id)}
                        >
                          <CheckCheck className="h-4 w-4" />
                          Marcar lida
                        </Button>
                      )}
                      {notification.actionUrl && (
                        <Button
                          type="button"
                          size="sm"
                          className="gap-2"
                          onClick={() => openNotification(notification)}
                        >
                          <ExternalLink className="h-4 w-4" />
                          Abrir
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
