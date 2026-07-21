import { useMemo, useState } from "react";
import { BellRing, CheckCircle2, Download, Smartphone, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { cn } from "@/lib/utils";

function getInstallContext() {
  if (typeof window === "undefined") {
    return { isIos: false, isStandalone: false };
  }

  const userAgent = window.navigator.userAgent;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  const isIpadOs = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  const isIos = /iPad|iPhone|iPod/.test(userAgent) || isIpadOs;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;

  return { isIos, isStandalone };
}

export function NotificationSetupCard() {
  const installContext = useMemo(() => getInstallContext(), []);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const {
    permission,
    pushSupported,
    webPushConfigured,
    pushEnabled,
    isLoadingPush,
    pushError,
    enablePushNotifications,
    disablePushNotifications,
    sendTestPushNotification,
  } = useBrowserNotifications();

  const needsIosInstall = installContext.isIos && !installContext.isStandalone;
  const canEnablePush = pushSupported
    && webPushConfigured
    && !pushEnabled
    && permission !== "denied"
    && !needsIosInstall;

  const pushStatus = pushEnabled
    ? {
      label: "Push ativo",
      description: "Este dispositivo recebe alertas mesmo fora da tela.",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: CheckCircle2,
    }
    : needsIosInstall
      ? {
        label: "Instalacao pendente",
        description: "No iPhone, abra pelo icone da Tela de Inicio antes de ativar.",
        tone: "border-amber-200 bg-amber-50 text-amber-700",
        icon: Smartphone,
      }
      : permission === "denied"
        ? {
          label: "Bloqueado",
          description: "A permissão foi bloqueada nas configurações do navegador.",
          tone: "border-red-200 bg-red-50 text-red-700",
          icon: XCircle,
        }
        : !webPushConfigured
          ? {
            label: "Servidor pendente",
            description: "As chaves de Push ainda não estão configuradas no servidor.",
            tone: "border-amber-200 bg-amber-50 text-amber-700",
            icon: XCircle,
          }
          : !pushSupported
            ? {
              label: "Indisponível",
              description: "Este navegador não liberou Web Push para esta sessão.",
              tone: "border-slate-200 bg-slate-50 text-slate-700",
              icon: XCircle,
            }
            : {
              label: "Push inativo",
              description: "Ative para receber alertas deste dispositivo.",
              tone: "border-blue-200 bg-blue-50 text-blue-700",
              icon: BellRing,
            };

  const installStatus = installContext.isStandalone
    ? {
      label: "App instalado",
      description: "EasyCare aberto como app neste dispositivo.",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    }
    : installContext.isIos
      ? {
        label: "Adicionar no iPhone",
        description: "Use Compartilhar e depois Adicionar a Tela de Inicio.",
        tone: "border-blue-200 bg-blue-50 text-blue-700",
      }
      : {
        label: "Navegador",
        description: "A ativacao depende do suporte de Push do navegador.",
        tone: "border-slate-200 bg-slate-50 text-slate-700",
      };

  const PushIcon = pushStatus.icon;

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-4 w-4 text-blue-600" />
              Alertas no celular
            </CardTitle>
            <CardDescription>
              Configure este aparelho para receber notificações do EasyCare.
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn("w-fit", pushStatus.tone)}>
            {pushStatus.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={cn("rounded-lg border p-3", pushStatus.tone)}>
              <div className="flex items-start gap-2">
                <PushIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{pushStatus.label}</p>
                  <p className="mt-1 text-xs opacity-85">{pushStatus.description}</p>
                </div>
              </div>
            </div>
            <div className={cn("rounded-lg border p-3", installStatus.tone)}>
              <div className="flex items-start gap-2">
                <Download className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{installStatus.label}</p>
                  <p className="mt-1 text-xs opacity-85">{installStatus.description}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <p className="text-sm font-medium">iPhone</p>
            <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>1. Abra o EasyCare no Safari.</li>
              <li>2. Toque em Compartilhar.</li>
              <li>3. Escolha Adicionar a Tela de Inicio.</li>
              <li>4. Abra pelo icone criado e ative o Push.</li>
            </ol>
          </div>
        </div>

        {pushError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {pushError}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            className="w-full gap-2 sm:w-auto"
            disabled={!canEnablePush || isLoadingPush}
            onClick={() => void enablePushNotifications()}
          >
            <BellRing className="h-4 w-4" />
            {isLoadingPush
              ? "Ativando..."
              : pushEnabled
                ? "Push ativo neste dispositivo"
                : needsIosInstall
                  ? "Abra pelo app instalado"
                  : "Ativar notificações push"}
          </Button>
          {pushEnabled ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={isSendingTest}
                onClick={async () => {
                  setIsSendingTest(true);
                  try {
                    await sendTestPushNotification();
                  } finally {
                    setIsSendingTest(false);
                  }
                }}
              >
                {isSendingTest ? "Enviando teste..." : "Enviar teste"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={isLoadingPush}
                onClick={() => void disablePushNotifications()}
              >
                Desativar neste dispositivo
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
