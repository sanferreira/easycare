import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { AlertTriangle, ArrowRight, HeartPulse, MessageCircle, ShieldCheck } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { NotificationCenter } from "@/components/NotificationCenter";
import { useAuth } from "@/hooks/use-auth";
import { buildSupportWhatsappUrl, supportWhatsappDisplay } from "@/lib/contact";

type AppShellProps = {
  children: ReactNode;
};

type BillingShellStatus = {
  organizationStatus: "active" | "inactive" | "restricted";
  stripeSubscriptionStatus: string | null;
  paymentGraceDays?: number | null;
  paymentGraceDaysLeft?: number | null;
  billingAccessState?: string | null;
  stripeCancelAtPeriodEnd?: boolean | null;
};

function buildBillingShellAlert(data?: BillingShellStatus | null, hasError = false) {
  if (hasError) {
    return {
      title: "Status de cobrança indisponível",
      message: "Não conseguimos confirmar a assinatura agora. Abra a cobrança ou fale com o suporte se o pagamento não atualizar.",
      tone: "warning",
    };
  }

  if (!data) return null;

  if (data.organizationStatus === "restricted" || data.billingAccessState === "restricted") {
    return {
      title: "Acesso restrito",
      message: "Regularize a assinatura para liberar os módulos internos da organização.",
      tone: "danger",
    };
  }

  const isPaymentIssue = ["past_due", "unpaid", "incomplete"].includes(data.stripeSubscriptionStatus ?? "")
    || data.billingAccessState === "grace_period";

  if (isPaymentIssue) {
    const daysLeft = data.paymentGraceDaysLeft;
    return {
      title: daysLeft === 0 ? "Pagamento vence hoje" : "Pagamento venceu",
      message: typeof daysLeft === "number" && daysLeft > 0
        ? `Faltam ${daysLeft} dia${daysLeft === 1 ? "" : "s"} para restringir o acesso.`
        : "O prazo de regularização está no limite. Atualize o pagamento para evitar bloqueio.",
      tone: "warning",
    };
  }

  if (data.stripeCancelAtPeriodEnd || data.billingAccessState === "cancel_scheduled") {
    return {
      title: "Cancelamento agendado",
      message: "O acesso continuará ativo até o fim do período contratado. Você pode revisar a assinatura na cobrança.",
      tone: "info",
    };
  }

  return null;
}

export function AppShell({ children }: AppShellProps) {
  const { user } = useAuth();
  const [location] = useLocation();
  const currentYear = new Date().getFullYear();
  const billingQuery = useQuery<BillingShellStatus>({
    queryKey: ["/api/billing/subscription", "shell"],
    enabled: !!user && !user.isSuperAdmin,
    retry: false,
    refetchInterval: 60000,
    queryFn: async () => {
      const res = await fetch("/api/billing/subscription", { credentials: "include" });
      if (!res.ok) throw new Error("Não foi possível confirmar a cobrança.");
      return res.json();
    },
  });
  const billingAlert = buildBillingShellAlert(billingQuery.data, billingQuery.isError);
  const showBillingAlert = Boolean(billingAlert && !location.startsWith("/billing") && !location.startsWith("/checkout"));
  const supportUrl = buildSupportWhatsappUrl("Olá! Preciso de ajuda com a cobrança do EasyCare.");

  return (
    <div className="min-h-screen bg-[#F6F9FC] md:flex">
      <Sidebar />
      <main className="flex min-h-screen flex-1 flex-col md:pl-64">
        <header className="sticky top-0 z-20 hidden border-b border-slate-200/80 bg-white/85 backdrop-blur md:block">
          <div className="flex h-16 items-center justify-between px-6 lg:px-8">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                EasyCare
              </p>
              <h1 className="truncate text-base font-bold text-[#0A0F2C]">
                {user?.isSuperAdmin ? "Central administrativa" : user?.organizationName ?? "Gestão de cuidados"}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 lg:flex">
                <ShieldCheck className="h-4 w-4 text-[#1F6FEB]" />
                Ambiente seguro
              </div>
              <NotificationCenter surface="light" />
            </div>
          </div>
        </header>

        {billingAlert && showBillingAlert && (
          <div
            className={`border-b px-4 py-3 md:px-6 lg:px-8 ${
              billingAlert.tone === "danger"
                ? "border-red-200 bg-red-50 text-red-900"
                : billingAlert.tone === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-blue-200 bg-blue-50 text-blue-900"
            }`}
            data-testid="billing-status-alert"
          >
            <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold">{billingAlert.title}</p>
                  <p className="mt-0.5 text-xs leading-5 opacity-85">{billingAlert.message}</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  href="/billing"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-white px-3 text-xs font-bold text-[#0B5CAB] shadow-sm ring-1 ring-inset ring-current/15 hover:bg-white/80"
                >
                  Ver cobrança
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <a
                  href={supportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-white/70 px-3 text-xs font-bold shadow-sm ring-1 ring-inset ring-current/15 hover:bg-white"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {supportWhatsappDisplay}
                </a>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 px-3 py-4 sm:px-4 lg:px-6 lg:py-6">
          <div className="mx-auto w-full max-w-[1440px]">
            {children}
          </div>
        </div>

        <footer className="border-t border-slate-200/80 bg-white/70 px-4 py-4 backdrop-blur md:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-[#22D3EE]" />
              <span>© {currentYear} EasyCare. Gestão web para instituições de cuidado.</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link href="/termos" className="hover:text-[#1F6FEB]">Termos</Link>
              <Link href="/privacidade" className="hover:text-[#1F6FEB]">Privacidade</Link>
              <a href="https://wa.me/551941414404" target="_blank" rel="noreferrer" className="hover:text-[#1F6FEB]">
                Suporte
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
