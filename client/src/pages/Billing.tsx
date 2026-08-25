import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Redirect } from "wouter";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Gift,
  Headphones,
  Loader2,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Star,
  UsersRound,
  XCircle,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { buildSupportWhatsappUrl, supportWhatsappDisplay } from "@/lib/contact";
import { queryClient } from "@/lib/queryClient";
import { useStripePublicConfig } from "@/lib/stripe-public-config";

type BillingStatus = {
  organizationName: string;
  organizationStatus: "active" | "inactive" | "restricted";
  stripeSubscriptionStatus: string | null;
  stripeCancelAtPeriodEnd: boolean;
  stripeCancelAt: string | null;
  stripePriceId: string | null;
  billingPlan: "monthly" | "semiannual" | "annual" | null;
  capacity: number | null;
  planPatientLimit: number | null;
  subscriptionCurrentPeriodEnd: string | null;
  subscriptionUpdatedAt: string | null;
  manualAccessUntil: string | null;
  billingMethod: "stripe" | "manual_boleto" | string | null;
  manualBillingDueDay: number | null;
  paymentGraceDays: number;
  paymentGraceEndsAt: string | null;
  paymentGraceDaysLeft: number | null;
  billingAccessState?: BillingAccessState;
  hasStripeCustomer: boolean;
  checkoutConfigured: boolean;
  portalConfigured: boolean;
};

type BillingAccessState = "active" | "trialing" | "grace_period" | "manual_boleto" | "manual_access" | "cancel_scheduled" | "restricted" | "inactive";

function isStripePaymentIssue(status: string | null) {
  return status === "past_due" || status === "unpaid" || status === "incomplete";
}

function isStripeSubscriptionCancellable(status: string | null) {
  return status === "trialing" || status === "active" || status === "past_due" || status === "unpaid" || status === "incomplete";
}

function statusView(
  status: BillingStatus["organizationStatus"],
  subscriptionStatus: string | null,
  manualAccessUntil?: string | null,
  billingMethod?: string | null,
  paymentGraceDays = 10,
  stripeCancelAtPeriodEnd = false,
) {
  if (status === "active") {
    if (stripeCancelAtPeriodEnd && (subscriptionStatus === "trialing" || subscriptionStatus === "active")) {
      return {
        label: "Cancelamento agendado",
        badge: "bg-amber-100 text-amber-700 border border-amber-200",
        title: subscriptionStatus === "trialing" ? "Teste grátis será encerrado" : "Assinatura será encerrada",
        text: "O acesso continua liberado até o fim do período atual. Depois disso, nenhuma nova cobrança será feita pela Stripe.",
        icon: CheckCircle2,
      };
    }

    if (subscriptionStatus === "trialing") {
      return {
        label: "Teste grátis ativo",
        badge: "bg-sky-100 text-sky-700 border border-sky-200",
        title: "Seu teste grátis está ativo",
        text: "O acesso da sua organização está liberado durante o período gratuito. A cobrança começa pela Stripe ao final do trial.",
        icon: CheckCircle2,
      };
    }

    if (isStripePaymentIssue(subscriptionStatus)) {
      return {
        label: "Prazo de regularização",
        badge: "bg-amber-100 text-amber-700 border border-amber-200",
        title: "Acesso mantido temporariamente",
        text: `O pagamento está pendente, mas o contrato mantém o acesso por até ${paymentGraceDays} dias para regularização.`,
        icon: CheckCircle2,
      };
    }

    if (!subscriptionStatus && manualAccessUntil) {
      return {
        label: billingMethod === "manual_boleto" ? "Boleto manual" : "Acesso manual",
        badge: "bg-cyan-100 text-cyan-700 border border-cyan-200",
        title: "Acesso liberado até a renovação",
        text: billingMethod === "manual_boleto"
          ? "Esta organização está em cobrança por boleto. O acesso segue liberado até o fim do prazo de tolerância configurado."
          : "Esta organização já está liberada por pagamento manual. Ao final do período combinado, regularize pela Stripe para manter o acesso automático.",
        icon: CheckCircle2,
      };
    }

    return {
      label: "Acesso liberado",
      badge: "bg-green-100 text-green-700 border border-green-200",
      title: "Acesso liberado",
      text: "Sua organização está liberada para usar o EasyCare. Você pode entrar no sistema ou acompanhar os dados da assinatura.",
      icon: CheckCircle2,
    };
  }

  if (status === "restricted") {
    return {
      label: subscriptionStatus ? `Stripe: ${subscriptionStatus}` : "Pagamento pendente",
      badge: "bg-amber-100 text-amber-700 border border-amber-200",
      title: "Regularize o acesso da organização",
      text: "Conclua a assinatura pela Stripe. Assim que o pagamento ou trial for confirmado, os módulos internos são liberados automaticamente.",
      icon: LockKeyhole,
    };
  }

  return {
    label: "Organização inativa",
    badge: "bg-neutral-100 text-neutral-700 border border-neutral-200",
    title: "Acesso bloqueado",
    text: "Esta organização está inativa. Fale com o suporte EasyCare para reativar o cadastro.",
    icon: LockKeyhole,
  };
}

function daysUntil(value?: string | null) {
  if (!value) return null;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.ceil((target - Date.now()) / (1000 * 60 * 60 * 24)));
}

function formatLongDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(date);
}

function billingPlanLabel(plan?: BillingStatus["billingPlan"]) {
  if (plan === "annual") return "Anual";
  if (plan === "semiannual") return "Semestral";
  if (plan === "monthly") return "Mensal";
  return null;
}

function billingAccessLabel(state?: BillingAccessState) {
  if (state === "trialing") return "Teste grátis ativo";
  if (state === "grace_period") return "Prazo de regularização";
  if (state === "manual_boleto") return "Cobrança por boleto";
  if (state === "manual_access") return "Acesso manual";
  if (state === "cancel_scheduled") return "Cancelamento agendado";
  if (state === "restricted") return "Pagamento pendente";
  if (state === "inactive") return "Organização inativa";
  if (!state) return "Pagamento pendente";
  return "Acesso liberado";
}

function resolveBillingAccessState(data?: BillingStatus | null): BillingAccessState {
  if (!data) return "restricted";
  if (data.billingAccessState) return data.billingAccessState;
  if (data.organizationStatus === "inactive") return "inactive";
  if (data.organizationStatus === "restricted") return "restricted";
  if (data.stripeCancelAtPeriodEnd) return "cancel_scheduled";
  if (data.stripeSubscriptionStatus === "trialing") return "trialing";
  if (isStripePaymentIssue(data.stripeSubscriptionStatus)) return "grace_period";
  if (!data.stripeSubscriptionStatus && data.manualAccessUntil) {
    return data.billingMethod === "manual_boleto" ? "manual_boleto" : "manual_access";
  }
  return "active";
}

function friendlyBillingError(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("stripe_secret_key")
    || normalized.includes("price_id")
    || normalized.includes("não configurad")
  ) {
    return "O checkout ainda não está pronto para uso. Fale com o suporte EasyCare para concluir a ativação.";
  }
  if (normalized.includes("não retornou")) {
    return "Não conseguimos abrir o checkout agora. Tente novamente em instantes ou fale com o suporte.";
  }
  if (normalized.includes("cliente stripe ainda não vinculado")) {
    return "A assinatura ainda não foi criada. Ative um plano antes de abrir o portal da Stripe.";
  }
  return message;
}

async function parseApiResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(friendlyBillingError(payload?.message || fallbackMessage));
  }
  return payload as T;
}

export default function Billing() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const stripeConfigQuery = useStripePublicConfig();
  const embeddedCheckoutConfigured = stripeConfigQuery.embeddedCheckoutConfigured;

  const billingQuery = useQuery<BillingStatus>({
    queryKey: ["/api/billing/subscription"],
    enabled: !!user && !user.isSuperAdmin,
    refetchInterval: 5000,
    queryFn: async () => {
      const res = await fetch("/api/billing/subscription", { credentials: "include" });
      return parseApiResponse<BillingStatus>(res, "Erro ao carregar assinatura.");
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/checkout-session", {
        method: "POST",
        credentials: "include",
      });
      return parseApiResponse<{ url: string }>(res, "Erro ao iniciar pagamento.");
    },
    onSuccess: (data) => {
      const checkoutWindow = window.open(data.url, "_blank");
      if (checkoutWindow) {
        checkoutWindow.opener = null;
        return;
      }
      window.location.assign(data.url);
    },
    onError: (error: Error) => {
      toast({ title: "Não conseguimos abrir o pagamento", description: error.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/portal-session", {
        method: "POST",
        credentials: "include",
      });
      return parseApiResponse<{ url: string }>(res, "Erro ao abrir portal da Stripe.");
    },
    onSuccess: (data) => {
      window.location.assign(data.url);
    },
    onError: (error: Error) => {
      toast({ title: "Não conseguimos abrir o portal", description: error.message, variant: "destructive" });
    },
  });

  const data = billingQuery.data;
  const view = useMemo(
    () => statusView(
      data?.organizationStatus ?? "restricted",
      data?.stripeSubscriptionStatus ?? null,
      data?.manualAccessUntil ?? null,
      data?.billingMethod ?? null,
      data?.paymentGraceDays ?? 10,
      data?.stripeCancelAtPeriodEnd ?? false,
    ),
    [data?.billingMethod, data?.manualAccessUntil, data?.organizationStatus, data?.paymentGraceDays, data?.stripeCancelAtPeriodEnd, data?.stripeSubscriptionStatus],
  );
  const StatusIcon = view.icon;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (!user) return <Redirect to="/login" />;
  if (user.isSuperAdmin) return <Redirect to="/admin" />;

  const periodEnd = formatLongDate(data?.subscriptionCurrentPeriodEnd);
  const trialDaysLeft = data?.stripeSubscriptionStatus === "trialing"
    ? daysUntil(data.subscriptionCurrentPeriodEnd)
    : null;
  const manualAccessEnd = formatLongDate(data?.manualAccessUntil);
  const cancelAt = formatLongDate(data?.stripeCancelAt);
  const paymentGraceEnd = formatLongDate(data?.paymentGraceEndsAt);
  const canStartCheckout = Boolean(data?.checkoutConfigured && data?.organizationStatus !== "inactive");
  const canCancelSubscription = Boolean(
    data?.stripeSubscriptionStatus
    && isStripeSubscriptionCancellable(data.stripeSubscriptionStatus)
    && !data.stripeCancelAtPeriodEnd,
  );
  const isActive = data?.organizationStatus === "active";
  const isRestricted = data?.organizationStatus === "restricted";
  const isPaymentIssue = isStripePaymentIssue(data?.stripeSubscriptionStatus ?? null);
  const billingAccessState = resolveBillingAccessState(data);
  const organizationName = data?.organizationName ?? user.organizationName ?? "EasyCare";
  const planName = billingPlanLabel(data?.billingPlan);
  const patientLimit = data?.capacity ?? data?.planPatientLimit ?? 50;
  const planCapacityLabel = planName ? `${planName} · até ${patientLimit} pacientes` : `Até ${patientLimit} pacientes`;
  const stripeLabel = data?.billingMethod === "manual_boleto"
    ? `Boleto manual${data?.manualBillingDueDay ? ` · dia ${data.manualBillingDueDay}` : ""}`
    : data?.stripeCancelAtPeriodEnd
      ? "Cancelamento agendado"
      : data?.stripeSubscriptionStatus === "trialing"
        ? "Teste grátis"
        : data?.stripeSubscriptionStatus ?? "Sem assinatura";
  const periodLabel = isPaymentIssue
    ? isActive
      ? `${data?.paymentGraceDaysLeft ?? 0} dia${data?.paymentGraceDaysLeft === 1 ? "" : "s"} para regularizar`
      : `Tolerância encerrada${paymentGraceEnd ? ` em ${paymentGraceEnd}` : ""}`
    : trialDaysLeft !== null
      ? data?.stripeCancelAtPeriodEnd
        ? `Encerra em ${cancelAt ?? periodEnd ?? "breve"}`
        : `${trialDaysLeft} dia${trialDaysLeft === 1 ? "" : "s"} de teste`
      : data?.stripeCancelAtPeriodEnd
        ? `Encerra em ${cancelAt ?? periodEnd ?? "breve"}`
        : manualAccessEnd ?? periodEnd ?? `Tolerância: ${data?.paymentGraceDays ?? 10} dias`;
  const pageTitle = isRestricted ? "Ative o acesso da sua organização" : view.title;
  const pageText = isRestricted
    ? "Escolha um plano e conclua a ativação pela Stripe. Assim que o período grátis ou pagamento for confirmado, o EasyCare libera o acesso automaticamente."
    : view.text;
  const activationTitle = isRestricted
    ? "Comece agora com 7 dias grátis"
    : data?.stripeCancelAtPeriodEnd
      ? "Acesso liberado até o encerramento"
      : "Acesso liberado para sua organização";
  const activationText = isRestricted
    ? "Teste todos os recursos do EasyCare antes da primeira cobrança. Sem compromisso."
    : data?.stripeCancelAtPeriodEnd
      ? "Você pode usar o EasyCare até o fim do período atual. Depois disso, a assinatura não será renovada."
      : "Entre no sistema para continuar a operação ou acompanhe a cobrança pelo portal da Stripe.";
  const statusCards = [
    { label: "Organização", value: organizationName, icon: Building2, tone: "bg-indigo-100 text-indigo-700" },
    { label: "Plano / pacientes", value: planCapacityLabel, icon: UsersRound, tone: "bg-blue-100 text-blue-700" },
    { label: "Stripe", value: stripeLabel, icon: ReceiptText, tone: isRestricted ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700" },
    { label: "Período", value: periodLabel, icon: CalendarDays, tone: "bg-violet-100 text-violet-700" },
  ];
  const nextBillingLabel = data?.stripeCancelAtPeriodEnd
    ? `Sem nova cobrança. Acesso até ${cancelAt ?? periodEnd ?? "o fim do período atual"}`
    : trialDaysLeft !== null
      ? `Após o teste, cobrança pela Stripe em ${periodEnd ?? "breve"}`
      : isPaymentIssue
        ? isActive
          ? `Regularize até ${paymentGraceEnd ?? "o fim da tolerância"}`
          : "Tolerância encerrada. Regularize para liberar o acesso."
        : data?.billingMethod === "manual_boleto"
          ? `Boleto dia ${data.manualBillingDueDay ?? "-"}${manualAccessEnd ? ` · acesso até ${manualAccessEnd}` : ""}`
          : periodEnd
            ? `Próxima renovação em ${periodEnd}`
            : "Sem próxima cobrança registrada";
  const subscriptionSummary = [
    { label: "Plano atual", value: planCapacityLabel },
    { label: "Cobrança", value: nextBillingLabel },
    { label: "Situação", value: billingAccessLabel(billingAccessState) },
  ];
  const summaryTone = isRestricted
    ? {
      container: "border-[#BFD7F2] bg-[#F8FBFF]",
      icon: "bg-[#EAF5FF] text-[#0B5CAB]",
      divider: "bg-[#D5E4F2]",
      label: "text-[#0B5CAB]",
    }
    : isPaymentIssue
      ? {
        container: "border-amber-200 bg-amber-50/70",
        icon: "bg-amber-100 text-amber-700",
        divider: "bg-amber-200",
        label: "text-amber-700",
      }
      : {
        container: "border-emerald-200 bg-emerald-50/55",
        icon: "bg-emerald-100 text-emerald-700",
        divider: "bg-emerald-200",
        label: "text-emerald-700",
      };
  const supportUrl = buildSupportWhatsappUrl(
    `Olá, preciso de ajuda com a assinatura da organização ${organizationName}.`,
  );

  function openCheckoutTab() {
    const checkoutWindow = window.open("/checkout", "_blank");
    if (checkoutWindow) {
      checkoutWindow.opener = null;
      return;
    }
    window.location.assign("/checkout");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1380px] space-y-4">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="p-5 lg:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#EAF5FF] text-[#0B5CAB]">
                    <StatusIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#0B5CAB]">Assinatura</p>
                    <h1 className="mt-1 max-w-3xl text-2xl font-extrabold leading-tight tracking-normal text-[#06183A] lg:text-[2rem]">
                      {pageTitle}
                    </h1>
                  </div>
                </div>
                <Badge className={`${view.badge} w-fit rounded-md px-3 py-1.5 text-xs font-bold`}>
                  {view.label}
                </Badge>
              </div>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#405875]">{pageText}</p>

              <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                {statusCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.label} className="min-h-[78px] rounded-lg border border-[#D5E4F2] bg-[#F8FBFF] p-3.5 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${card.tone}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold uppercase text-[#65758B]">{card.label}</p>
                          <p className="mt-1 break-words text-sm font-extrabold leading-5 text-[#06183A]">{card.value}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-lg border border-dashed border-[#BFD7F2] bg-[#FBFDFF] p-4 shadow-sm">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_1px_minmax(270px,380px)] lg:items-center">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EAF5FF] text-[#0B5CAB]">
                      <Gift className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-xl font-extrabold tracking-normal text-[#06183A]">{activationTitle}</h2>
                      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#405875]">{activationText}</p>
                      <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#405875]">
                        <CheckCircle2 className="h-4 w-4 text-[#059669]" />
                        {isRestricted ? "Sem cobrança nos primeiros 7 dias." : "Acesso e dados preservados durante o período contratado."}
                      </div>
                    </div>
                  </div>

                  <div className="hidden h-full min-h-[96px] w-px bg-[#D5E4F2] lg:block" />

                  <div className="grid gap-3">
                    {isActive ? (
                      <>
                        <Button asChild className="h-12 rounded-md bg-[#0B5CAB] px-5 text-sm font-extrabold text-white hover:bg-[#084B8A]">
                          <Link href="/app">
                            <BadgeCheck className="mr-2 h-4 w-4" />
                            Ir para o sistema
                            <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
                          </Link>
                        </Button>
                        <Button asChild variant="outline" className="h-11 rounded-md border-[#B8CBE0] bg-white px-5 text-sm text-[#06183A]">
                          <Link
                            href="/onboarding"
                            onClick={() => queryClient.invalidateQueries({ queryKey: ["auth-user"] })}
                          >
                            Ver primeiros passos
                          </Link>
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          className="h-12 rounded-md bg-[#0B5CAB] px-5 text-sm font-extrabold text-white shadow-[0_14px_28px_rgba(11,92,171,0.18)] hover:bg-[#084B8A]"
                          disabled={!canStartCheckout || stripeConfigQuery.isLoading || !embeddedCheckoutConfigured}
                          onClick={openCheckoutTab}
                        >
                          <Gift className="mr-2 h-4 w-4" />
                          {data?.hasStripeCustomer ? "Regularizar assinatura" : "Começar meus 7 dias grátis"}
                          <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
                        </Button>
                        {/* <Button
                          variant="outline"
                          className="h-11 rounded-md border-[#0B5CAB] bg-white px-5 text-sm font-bold text-[#0B5CAB] hover:bg-[#EAF5FF]"
                          disabled={checkoutMutation.isPending || !canStartCheckout}
                          onClick={() => checkoutMutation.mutate()}
                        >
                          {checkoutMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                          Ver opções de pagamento
                        </Button> */}
                      </>
                    )}

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                      <Button
                        variant="outline"
                        className="h-10 rounded-md border-[#B8CBE0] bg-white px-4 text-xs font-bold"
                        disabled={billingQuery.isFetching}
                        onClick={() => billingQuery.refetch()}
                      >
                        <RefreshCw className={`mr-2 h-4 w-4 ${billingQuery.isFetching ? "animate-spin" : ""}`} />
                        Atualizar status
                      </Button>

                      {data?.hasStripeCustomer && (
                        <Button
                          variant="outline"
                          className="h-10 rounded-md border-[#B8CBE0] bg-white px-4 text-xs font-bold"
                          disabled={portalMutation.isPending || !data.portalConfigured}
                          onClick={() => portalMutation.mutate()}
                        >
                          {portalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                          Portal Stripe
                        </Button>
                      )}

                      {canCancelSubscription && (
                        <Button asChild variant="outline" className="h-10 rounded-md border-rose-200 bg-white px-4 text-xs font-bold text-rose-700 hover:bg-rose-50 hover:text-rose-800">
                          <Link href="/billing/cancelar">
                            <XCircle className="mr-2 h-4 w-4" />
                            {data?.stripeSubscriptionStatus === "trialing" ? "Cancelar teste" : "Cancelar assinatura"}
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`mt-3 grid gap-4 rounded-lg border p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_1px_minmax(280px,380px)] md:items-center ${summaryTone.container}`}>
                <div className="flex gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${summaryTone.icon}`}>
                    <Star className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-extrabold text-[#06183A]">Todos os planos incluem os mesmos recursos</h3>
                    <p className="mt-1.5 text-sm leading-5 text-[#53657A]">
                      A diferença está no período contratado, na economia e no limite de pacientes.
                    </p>
                  </div>
                </div>
                <div className={`hidden h-full min-h-[68px] w-px md:block ${summaryTone.divider}`} />
                <div className="grid gap-2 text-sm text-[#405875]">
                  <p className={`text-xs font-extrabold uppercase tracking-[0.14em] ${summaryTone.label}`}>Resumo da assinatura</p>
                  {subscriptionSummary.map((item) => (
                    <div key={item.label} className="grid gap-0.5">
                      <span className="text-xs font-bold uppercase text-[#65758B]">{item.label}</span>
                      <span className="font-semibold leading-5 text-[#06183A]">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {!data?.checkoutConfigured && (
                <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                  O checkout ainda não está pronto para esta organização. Fale com o suporte EasyCare para concluir a ativação.
                </p>
              )}

              {!stripeConfigQuery.isLoading && !embeddedCheckoutConfigured && data?.organizationStatus !== "active" && (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                  O checkout integrado não está disponível agora. Use as opções de pagamento ou fale com o suporte para continuar.
                </p>
              )}
            </div>

            <aside className="easycare-brand-panel flex flex-col p-5 lg:p-6">
              <img src="/brand/logo-easycare-header.png" alt="EasyCare" className="h-10 w-auto object-contain" />
              <p className="mt-7 text-xs font-extrabold uppercase tracking-[0.22em] text-[#22D3EE]">
                Checkout seguro
              </p>
              <h2 className="mt-4 text-2xl font-extrabold leading-tight tracking-normal text-white">
                Sua organização será liberada automaticamente.
              </h2>
              <div className="mt-6 space-y-4">
                {[
                  ["1", "Escolha o plano ideal", "Selecione mensal, semestral ou anual."],
                  ["2", "Finalize com segurança pela Stripe", "Pagamento processado no ambiente seguro da Stripe."],
                  ["3", "Comece a usar o EasyCare", "Acesso liberado automaticamente após a confirmação."],
                ].map(([step, title, text], index) => (
                  <div key={step} className="relative flex gap-4">
                    {index < 2 && <span className="absolute left-[17px] top-10 h-10 w-px bg-white/20" />}
                    <span className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0B5CAB] text-sm font-extrabold text-white">
                      {step}
                    </span>
                    <div>
                      <p className="font-extrabold text-white">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-white/70">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-lg border border-white/15 bg-white/[0.06] p-4 xl:mt-auto">
                <div className="flex items-center gap-3 text-base font-extrabold text-white">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0B5CAB]">
                    <ShieldCheck className="h-5 w-5 text-[#22D3EE]" />
                  </span>
                  Dados protegidos
                </div>
                <p className="mt-3 text-sm leading-6 text-white/68">
                  O pagamento acontece fora do EasyCare, no ambiente seguro da Stripe. O sistema guarda apenas o status da assinatura.
                </p>
                <a
                  href={supportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex h-9 items-center justify-center rounded-md border border-white/18 bg-white/10 px-3 text-xs font-extrabold text-white transition hover:bg-white/15"
                >
                  <Headphones className="mr-2 h-4 w-4 text-[#22D3EE]" />
                  Suporte {supportWhatsappDisplay}
                </a>
              </div>
            </aside>
          </div>

          <div className="border-t border-slate-200 bg-white px-6 py-2.5 lg:px-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                { title: "7 dias grátis", text: "Teste o sistema completo sem cobrança inicial.", icon: CalendarDays },
                { title: "Pagamento seguro", text: "Processado pela Stripe com máxima segurança.", icon: ShieldCheck },
                { title: "Ativação automática", text: "Acesso liberado assim que o pagamento for confirmado.", icon: Zap },
                { title: "Suporte especializado", text: "Conte com nosso time durante o onboarding.", icon: Headphones },
              ].map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div key={benefit.title} className="flex min-w-0 gap-3 border-slate-200 py-1 xl:border-l xl:pl-4 xl:first:border-l-0 xl:first:pl-0">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EAF5FF] text-[#0B5CAB]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-extrabold text-[#06183A]">{benefit.title}</h3>
                      <p className="mt-0.5 text-xs leading-5 text-[#53657A]">{benefit.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
