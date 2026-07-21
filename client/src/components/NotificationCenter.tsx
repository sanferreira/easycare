import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, CircleCheck, Clock3, Info, ListChecks, Volume2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLocation } from "wouter";
import type { AppNotification } from "@shared/schema";
import { NOTIFICATION_MODULE_LABELS } from "@shared/notifications";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type NotificationResponse = {
  notifications: AppNotification[];
  unreadCount: number;
};

const MODULE_LABELS: Record<string, string> = { ...NOTIFICATION_MODULE_LABELS };

const NOTIFICATION_REFETCH_INTERVAL_MS = 10_000;

type NotificationCenterProps = {
  surface?: "dark" | "light";
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

function formatNotificationTime(value: AppNotification["createdAt"]) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "dd/MM HH:mm", { locale: ptBR });
}

export function NotificationCenter({ surface = "dark" }: NotificationCenterProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const enabled = Boolean(user?.id && !user?.isSuperAdmin);
  const latestNotificationIdRef = useRef<number | null>(null);
  const {
    isUnlocked: notificationSoundUnlocked,
    play: playNotificationSound,
    unlock: unlockNotificationSound,
  } = useNotificationSound();
  const {
    permission: browserNotificationPermission,
    supported: browserNotificationsSupported,
    pushSupported,
    webPushConfigured,
    pushEnabled,
    isLoadingPush,
    pushError,
    requestPermission: requestBrowserNotificationPermission,
    enablePushNotifications,
    showNotification: showBrowserNotification,
  } = useBrowserNotifications();

  const notificationsQuery = useQuery<NotificationResponse>({
    queryKey: ["notifications", "unread"],
    enabled,
    refetchInterval: NOTIFICATION_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/notifications?unreadOnly=true&limit=10", { credentials: "include" });
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

  useEffect(() => {
    const data = notificationsQuery.data;
    if (!enabled || !data) return;

    const latestNotification = data.notifications[0] ?? null;
    const latestNotificationId = latestNotification?.id ?? null;
    const previousNotificationId = latestNotificationIdRef.current;
    latestNotificationIdRef.current = latestNotificationId;

    if (
      previousNotificationId !== null
      && latestNotificationId !== null
      && latestNotificationId > previousNotificationId
      && data.unreadCount > 0
    ) {
      playNotificationSound();

      const browserNotification = pushEnabled
        ? null
        : showBrowserNotification(latestNotification.title, {
          body: latestNotification.message,
          icon: "/favicon.png",
          tag: `easycare-notification-${latestNotification.id}`,
        });

      if (browserNotification) {
        browserNotification.onclick = () => {
          window.focus();
          if (!latestNotification.readAt) {
            markReadMutation.mutate(latestNotification.id);
          }
          if (latestNotification.actionUrl) {
            navigate(latestNotification.actionUrl);
          }
          browserNotification.close();
        };
      }
    }
  }, [
    enabled,
    markReadMutation,
    navigate,
    notificationsQuery.data,
    playNotificationSound,
    pushEnabled,
    showBrowserNotification,
  ]);

  if (!enabled) return null;

  const notifications = notificationsQuery.data?.notifications ?? [];
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const canAskBrowserNotifications = browserNotificationsSupported && browserNotificationPermission === "default";
  const canEnableWebPush = pushSupported && webPushConfigured && !pushEnabled && browserNotificationPermission !== "denied";
  const showAlertActivationButton = !notificationSoundUnlocked || canAskBrowserNotifications || canEnableWebPush;
  const alertActivationLabel = canEnableWebPush || canAskBrowserNotifications ? "Ativar alertas" : "Ativar som";
  const triggerClassName = surface === "light"
    ? "relative h-9 w-9 shrink-0 rounded-lg border border-border bg-white text-foreground shadow-sm hover:bg-muted"
    : "relative h-9 w-9 shrink-0 rounded-lg border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white";

  const openNotification = (notification: AppNotification) => {
    if (!notification.readAt) {
      markReadMutation.mutate(notification.id);
    }
    if (notification.actionUrl) {
      navigate(notification.actionUrl);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          data-testid="button-notifications"
          aria-label="Notificacoes"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={isMobile ? "bottom" : "right"}
        align={isMobile ? "end" : "end"}
        sideOffset={8}
        collisionPadding={8}
        className="w-[calc(100vw-1rem)] max-w-[360px] p-0"
      >
        <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Pendencias</p>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} nao lida(s)` : "Nenhuma pendencia nova"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {showAlertActivationButton && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
                disabled={isLoadingPush}
                onClick={() => {
                  if (canEnableWebPush) {
                    void enablePushNotifications();
                  } else if (canAskBrowserNotifications) {
                    void requestBrowserNotificationPermission();
                  }
                  void unlockNotificationSound({ preview: true });
                }}
              >
                <Volume2 className="h-3.5 w-3.5" />
                {alertActivationLabel}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs"
              disabled={unreadCount === 0 || markAllReadMutation.isPending}
              onClick={() => markAllReadMutation.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar lidas
            </Button>
          </div>
        </div>
        {(pushEnabled || pushError || (!webPushConfigured && pushSupported)) && (
          <div className="border-b bg-muted/35 px-4 py-2 text-xs text-muted-foreground">
            {pushEnabled
              ? "Alertas push ativos neste navegador."
              : pushError || "Web Push ainda nao configurado no servidor; usando alerta enquanto a aba estiver aberta."}
          </div>
        )}

        <ScrollArea className="max-h-[420px]">
          {notificationsQuery.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4 animate-pulse" />
              Carregando notificacoes...
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground">
              Nenhuma notificacao pendente.
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => {
                const severity = severityView[notification.severity as keyof typeof severityView] ?? severityView.info;
                const Icon = severity.icon;
                const isUnread = !notification.readAt;
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                      isUnread ? "bg-blue-50/70" : "bg-background",
                    )}
                  >
                    <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", severity.className)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">{notification.title}</span>
                        {isUnread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {notification.message}
                      </span>
                      <span className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{MODULE_LABELS[notification.sourceModule] ?? notification.sourceModule}</span>
                        <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                        <span>{formatNotificationTime(notification.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="border-t px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => navigate("/notificacoes")}
          >
            <ListChecks className="h-4 w-4" />
            Ver historico
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
