import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect } from "wouter";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Info,
  LockKeyhole,
  Loader2,
  ShieldCheck,
  Tag,
  Trophy,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useStripePublicConfig } from "@/lib/stripe-public-config";

type BillingStatus = {
  organizationName: string;
  organizationStatus: "active" | "inactive" | "restricted";
  stripeSubscriptionStatus: string | null;
  checkoutConfigured: boolean;
};

type BillingPlanId = "monthly" | "semiannual" | "annual";

type BillingPlanOption = {
  id: BillingPlanId;
  name: string;
  configured: boolean;
  patientLimit: number;
  amount: number | null;
  currency: string;
  interval: "month" | "year" | string;
  intervalCount: number;
  formattedAmount: string | null;
};

type BillingPlanSavings = {
  amount: number;
  percent: number | null;
  formattedAmount: string | null;
  monthlyEquivalent: number | null;
  formattedMonthlyEquivalent: string | null;
  comparisonTotal: number | null;
  formattedComparisonTotal: string | null;
  periodCount: number;
};

type BillingPlansResponse = {
  plans: BillingPlanOption[];
  savings: {
    amount: number;
    percent: number | null;
    formattedAmount: string | null;
    annualMonthlyEquivalent: number | null;
    formattedAnnualMonthlyEquivalent: string | null;
    monthlyYearTotal: number | null;
    formattedMonthlyYearTotal: string | null;
  } | null;
  savingsByPlan?: {
    semiannual?: BillingPlanSavings | null;
    annual?: BillingPlanSavings | null;
  };
};

async function parseApiResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.message || fallbackMessage);
  }
  return payload as T;
}

function CheckoutShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-hidden bg-[#050B1F] text-white"
      style={{
        background: "linear-gradient(135deg, #050B1F 0%, #081337 48%, #0D1A40 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.75) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.75) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(90deg,rgba(34,211,238,0.08)_0%,rgba(31,111,235,0.04)_42%,rgba(255,255,255,0)_100%)]" />

      <header className="relative z-10 border-b border-white/10 bg-[#050B1F]/48 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center" aria-label="EasyCare">
            <img src="/brand/logo-easycare-header.png" alt="EasyCare" className="h-9 w-auto object-contain" />
          </Link>
          <Button asChild variant="outline" className="h-10 rounded-md border-white/20 bg-white/5 text-white hover:bg-white/10">
            <Link href="/billing">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Link>
          </Button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center px-5 py-3 sm:px-8 lg:py-4">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-[#050B1F]/38">
        <div className="mx-auto flex min-h-10 w-full max-w-7xl flex-col items-center justify-between gap-2 px-5 py-2 text-xs text-white/45 sm:flex-row sm:px-8">
          <span>© 2026 EasyCare</span>
          <div className="flex items-center gap-4">
            <Link href="/termos" className="transition hover:text-white">Termos</Link>
            <Link href="/privacidade" className="transition hover:text-white">Privacidade</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CenterMessage({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <CheckoutShell>
      <div className="mx-auto max-w-xl rounded-lg border border-white/12 bg-white/[0.06] p-8 text-center shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-md">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-white/10 text-[#22D3EE]">
          {icon}
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-normal text-white">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">{description}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </CheckoutShell>
  );
}

export default function CheckoutPage() {
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const stripeConfigQuery = useStripePublicConfig();
  const stripePromise = useMemo(
    () => stripeConfigQuery.publishableKey ? loadStripe(stripeConfigQuery.publishableKey) : null,
    [stripeConfigQuery.publishableKey],
  );
  const embeddedCheckoutConfigured = stripeConfigQuery.embeddedCheckoutConfigured;
  const [selectedPlan, setSelectedPlan] = useState<BillingPlanId>("monthly");
  const [planTouched, setPlanTouched] = useState(false);
  const [checkoutStarted, setCheckoutStarted] = useState(false);
  const waitingForSignup = useMemo(
    () => new URLSearchParams(window.location.search).get("wait") === "signup",
    [],
  );

  useEffect(() => {
    if (!waitingForSignup || user) return undefined;
    const interval = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["auth-user"] });
    }, 1200);
    return () => window.clearInterval(interval);
  }, [queryClient, user, waitingForSignup]);

  const billingStatusQuery = useQuery<BillingStatus>({
    queryKey: ["/api/billing/subscription"],
    enabled: !!user && !user.isSuperAdmin,
    queryFn: async () => {
      const res = await fetch("/api/billing/subscription", { credentials: "include" });
      return parseApiResponse<BillingStatus>(res, "Erro ao carregar assinatura.");
    },
  });

  const billingPlansQuery = useQuery<BillingPlansResponse>({
    queryKey: ["/api/billing/plans"],
    enabled: !!user && !user.isSuperAdmin,
    queryFn: async () => {
      const res = await fetch("/api/billing/plans", { credentials: "include" });
      return parseApiResponse<BillingPlansResponse>(res, "Erro ao carregar planos.");
    },
  });

  const monthlyPlan = billingPlansQuery.data?.plans.find((plan) => plan.id === "monthly") ?? null;
  const semiannualPlan = billingPlansQuery.data?.plans.find((plan) => plan.id === "semiannual") ?? null;
  const annualPlan = billingPlansQuery.data?.plans.find((plan) => plan.id === "annual") ?? null;
  const selectedPlanOption =
    selectedPlan === "annual" ? annualPlan : selectedPlan === "semiannual" ? semiannualPlan : monthlyPlan;
  const selectedPlanName =
    selectedPlan === "annual" ? "Anual à vista" : selectedPlan === "semiannual" ? "Semestral" : "Mensal";
  const semiannualSavings = billingPlansQuery.data?.savingsByPlan?.semiannual ?? null;
  const annualSavings = billingPlansQuery.data?.savingsByPlan?.annual ?? null;
  const billingPlansErrorMessage = billingPlansQuery.error instanceof Error
    ? billingPlansQuery.error.message
    : "Não foi possível carregar os planos.";
  const monthlyPrice = monthlyPlan?.formattedAmount ?? "R$ 290,90";
  const semiannualPrice = semiannualPlan?.formattedAmount ?? "R$ 1.590,00";
  const annualPrice = annualPlan?.formattedAmount ?? "R$ 2.990,00";
  const semiannualMonthlyEquivalent = semiannualSavings?.formattedMonthlyEquivalent ?? "R$ 265,00";
  const annualMonthlyEquivalent =
    annualSavings?.formattedMonthlyEquivalent ??
    billingPlansQuery.data?.savings?.formattedAnnualMonthlyEquivalent ??
    "R$ 249,17";
  const semiannualSavingsAmount = semiannualSavings?.formattedAmount ?? "R$ 155,40";
  const annualSavingsAmount =
    annualSavings?.formattedAmount ??
    billingPlansQuery.data?.savings?.formattedAmount ??
    "R$ 500,80";
  const selectedPlanChargeNote =
    selectedPlan === "annual"
      ? `Depois do período gratuito, cobrança anual de ${annualPrice}.`
      : selectedPlan === "semiannual"
        ? `Depois do período gratuito, cobrança de ${semiannualPrice} referente a 6 meses.`
        : `Depois do período gratuito, ${monthlyPrice}/mês.`;
  const trialBenefits = [
    { text: "7 dias grátis, sem cobrança inicial", icon: CalendarDays },
    { text: "Pagamento seguro processado pela Stripe", icon: ShieldCheck },
    { text: "Acesso liberado automaticamente", icon: Zap },
    { text: "Seus dados de pagamento não ficam armazenados no EasyCare", icon: LockKeyhole },
  ];
  const planCards = [
    {
      id: "monthly" as BillingPlanId,
      title: "Mensal",
      subtitle: "Ideal para começar sem compromisso.",
      price: monthlyPrice,
      suffix: "/ mês",
      badge: "Flexível",
      detail: "Cancele quando quiser.",
      highlight: null,
      footer: "Cobrado mês a mês",
      patientLimit: monthlyPlan?.patientLimit ?? 30,
      icon: CalendarDays,
      tone: "blue",
      recommended: false,
      configured: monthlyPlan?.configured ?? false,
    },
    {
      id: "semiannual" as BillingPlanId,
      title: "Semestral",
      subtitle: "Garanta 6 meses de EasyCare com um valor melhor.",
      price: semiannualPrice,
      suffix: "à vista",
      badge: semiannualSavings?.percent ? `Economize ${semiannualSavings.percent}%` : "Economize 9%",
      detail: `Equivale a ${semiannualMonthlyEquivalent}/mês`,
      highlight: `Você economiza ${semiannualSavingsAmount}`,
      footer: "Pagamento à vista e acesso por 6 meses",
      patientLimit: semiannualPlan?.patientLimit ?? 40,
      icon: Tag,
      tone: "green",
      recommended: false,
      configured: semiannualPlan?.configured ?? false,
    },
    {
      id: "annual" as BillingPlanId,
      title: "Anual à vista",
      subtitle: "A melhor escolha para quem quer economizar mais no longo prazo.",
      price: annualPrice,
      suffix: "à vista / ano",
      badge: "Melhor custo-benefício",
      detail: `Equivale a ${annualMonthlyEquivalent}/mês`,
      highlight: `Você economiza ${annualSavingsAmount} por ano`,
      footer: "Pagamento à vista e acesso por 12 meses",
      patientLimit: annualPlan?.patientLimit ?? 60,
      icon: Trophy,
      tone: "blue",
      recommended: true,
      configured: annualPlan?.configured ?? false,
    },
  ];

  useEffect(() => {
    if (planTouched || checkoutStarted || !billingPlansQuery.data) return;
    setSelectedPlan(annualPlan?.configured ? "annual" : semiannualPlan?.configured ? "semiannual" : "monthly");
  }, [annualPlan?.configured, billingPlansQuery.data, checkoutStarted, planTouched, semiannualPlan?.configured]);

  const checkoutOptions = useMemo(
    () => ({
      fetchClientSecret: async () => {
        const res = await fetch("/api/billing/embedded-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ plan: selectedPlan }),
        });
        const payload = await parseApiResponse<{ clientSecret: string }>(
          res,
          "Erro ao iniciar checkout.",
        );
        return payload.clientSecret;
      },
      onComplete: () => {
        void queryClient.invalidateQueries({ queryKey: ["auth-user"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
        window.location.assign("/billing/success");
      },
    }),
    [queryClient, selectedPlan],
  );

  if (isLoading || (waitingForSignup && !user)) {
    return (
      <CenterMessage
        icon={<Loader2 className="h-6 w-6 animate-spin" />}
        title="Preparando checkout"
        description="Estamos confirmando o acesso da instituição antes de abrir o pagamento."
      />
    );
  }

  if (!user) return <Redirect to="/login" />;

  if (user.isSuperAdmin) {
    return (
      <CenterMessage
        icon={<ShieldCheck className="h-6 w-6" />}
        title="Checkout disponível para instituições"
        description="O superadmin acompanha assinaturas pela área administrativa."
        action={
          <Button asChild className="h-11 rounded-md bg-[#1F6FEB] px-5 text-white hover:bg-[#1A5FD4]">
            <Link href="/admin">Abrir admin</Link>
          </Button>
        }
      />
    );
  }

  if (!stripeConfigQuery.isLoading && !embeddedCheckoutConfigured) {
    return (
      <CenterMessage
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Checkout EasyCare não configurado"
        description="A chave pública da Stripe ainda não está disponível no ambiente do frontend."
        action={
          <Button asChild className="h-11 rounded-md bg-[#1F6FEB] px-5 text-white hover:bg-[#1A5FD4]">
            <Link href="/billing">Voltar para cobrança</Link>
          </Button>
        }
      />
    );
  }

  if (billingStatusQuery.isLoading) {
    return (
      <CenterMessage
        icon={<Loader2 className="h-6 w-6 animate-spin" />}
        title="Carregando assinatura"
        description="Estamos verificando o status da instituição antes de iniciar a Stripe."
      />
    );
  }

  if (!billingStatusQuery.data?.checkoutConfigured) {
    return (
      <CenterMessage
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Stripe não configurada no servidor"
        description="Configure STRIPE_SECRET_KEY e STRIPE_PRICE_ID para iniciar o checkout."
        action={
          <Button asChild className="h-11 rounded-md bg-[#1F6FEB] px-5 text-white hover:bg-[#1A5FD4]">
            <Link href="/billing">Voltar para cobrança</Link>
          </Button>
        }
      />
    );
  }

  if (billingStatusQuery.data.organizationStatus === "inactive") {
    return (
      <CenterMessage
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Organização inativa"
        description="Fale com o suporte EasyCare para reativar o cadastro antes de assinar."
        action={
          <Button asChild className="h-11 rounded-md bg-[#1F6FEB] px-5 text-white hover:bg-[#1A5FD4]">
            <Link href="/billing">Voltar para cobrança</Link>
          </Button>
        }
      />
    );
  }

  if (billingStatusQuery.data.organizationStatus === "active") {
    return (
      <CenterMessage
        icon={<CheckCircle2 className="h-6 w-6" />}
        title="Assinatura ativa"
        description="O acesso da instituição já está liberado no EasyCare."
        action={
          <Button asChild className="h-11 rounded-md bg-[#1F6FEB] px-5 text-white hover:bg-[#1A5FD4]">
            <Link href="/app">Abrir sistema</Link>
          </Button>
        }
      />
    );
  }

  return (
    <CheckoutShell>
      <section className="mx-auto w-full max-w-[1360px] overflow-hidden rounded-lg border border-white/14 bg-white text-[#05203C] shadow-[0_34px_110px_rgba(0,0,0,0.38)]">
        <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="easycare-brand-panel p-6">
            <div className="relative z-10 flex min-h-full flex-col">
              <img
                src="/brand/logo-easycare-header.png"
                alt="EasyCare"
                className="h-10 w-fit object-contain"
              />

              <p className="mt-7 text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">
                Checkout seguro
              </p>
              <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-normal text-white">
                Comece agora. Os primeiros 7 dias são por nossa conta.
              </h1>
              <p className="mt-4 text-sm leading-6 text-white/68">
                Teste o EasyCare na sua operação antes da primeira cobrança.
              </p>

              <div className="mt-7 space-y-4 text-sm font-semibold leading-6 text-white/88">
                {trialBenefits.map(({ text, icon: Icon }) => (
                  <div key={text} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[#22D3EE]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <p>{text}</p>
                  </div>
                ))}
              </div>

              <div className="mt-7 rounded-md border border-white/12 bg-white/[0.06] p-3 text-sm shadow-sm lg:mt-auto">
                <div className="flex items-center gap-2 font-bold text-white">
                  <ShieldCheck className="h-4 w-4 text-[#22D3EE]" />
                  Dados protegidos
                </div>
                <p className="mt-2 text-xs leading-5 text-white/68">
                  O pagamento acontece fora do EasyCare, no ambiente da Stripe. O sistema guarda apenas o status da assinatura.
                </p>
              </div>
            </div>
          </aside>

          <div className="bg-white px-5 py-5 sm:px-8 lg:px-10 lg:py-6">
            <div className="mx-auto max-w-none">
              <div className="w-full">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#0B5CAB]">
                      Escolha seu plano
                    </p>
                    <h2 className="mt-1 text-2xl font-extrabold tracking-normal text-[#05203C]">
                      Escolha como prefere economizar
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-5 text-[#53657A]">
                      Todos os planos incluem acesso completo ao EasyCare. Quanto maior o período, maior a economia.
                    </p>
                  </div>
                  {billingPlansQuery.isLoading && (
                    <span className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-xs font-bold text-[#53657A]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Carregando
                    </span>
                  )}
                </div>

                {billingPlansQuery.isError && (
                  <div className="mt-4 flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      {billingPlansErrorMessage} Atualize a página ou confira se o servidor foi reiniciado depois do ajuste das chaves.
                    </p>
                  </div>
                )}

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {planCards.map((plan) => {
                    const isSelected = selectedPlan === plan.id;
                    const Icon = plan.icon;
                    const isGreen = plan.tone === "green";
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        aria-pressed={isSelected}
                        disabled={!plan.configured || checkoutStarted}
                        onClick={() => {
                          setSelectedPlan(plan.id);
                          setPlanTouched(true);
                        }}
                        className={`relative flex min-h-[315px] flex-col overflow-visible rounded-lg border bg-white p-4 text-left transition ${
                          isSelected
                            ? "border-[#0B5CAB] shadow-[0_18px_44px_rgba(11,92,171,0.18)] ring-2 ring-[#0B5CAB]/12 md:scale-[1.015]"
                            : plan.recommended
                              ? "border-[#0B5CAB]/55 shadow-[0_12px_34px_rgba(11,92,171,0.10)] hover:border-[#0B5CAB]/80"
                              : "border-[#D5E4F2] hover:border-[#0B5CAB]/45 hover:shadow-[0_12px_28px_rgba(11,92,171,0.08)]"
                        } ${plan.recommended ? "pt-6 md:-translate-y-1" : ""} ${!plan.configured ? "cursor-not-allowed opacity-55" : ""}`}
                      >
                        {plan.recommended && (
                          <span className="absolute -top-3 left-7 right-7 rounded-md bg-[#0B5CAB] py-1.5 text-center text-[11px] font-extrabold uppercase tracking-normal text-white shadow-[0_10px_22px_rgba(11,92,171,0.22)]">
                            Mais vantajoso
                          </span>
                        )}
                        <div className="flex items-start justify-between gap-3">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                            isGreen ? "bg-[#E4F8EF] text-[#058467]" : "bg-[#E5F3FF] text-[#0B5CAB]"
                          }`}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className={`max-w-[116px] rounded-md px-2.5 py-1.5 text-center text-[10px] font-extrabold uppercase leading-4 ${
                            plan.recommended
                              ? "bg-[#EAF5FF] text-[#0B5CAB]"
                              : isGreen
                                ? "bg-[#E3F7EC] text-[#058467]"
                                : "bg-[#EAF5FF] text-[#0B5CAB]"
                          }`}>
                            {plan.badge}
                          </span>
                        </div>

                        <h3 className="mt-4 text-xl font-extrabold tracking-normal text-[#05203C]">
                          {plan.title}
                        </h3>
                        <p className="mt-2 min-h-[42px] text-sm font-medium leading-5 text-[#405875]">
                          {plan.subtitle}
                        </p>
                        <span className={`mt-2 inline-flex w-fit rounded-md px-2.5 py-1 text-xs font-extrabold ${
                          isGreen ? "bg-[#E3F7EC] text-[#058467]" : "bg-[#EAF5FF] text-[#0B5CAB]"
                        }`}>
                          Até {plan.patientLimit} pacientes
                        </span>

                        <div className="my-3 h-px bg-[#DDE8F3]" />

                        <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                          <span className="text-[1.55rem] font-extrabold tracking-normal text-[#05203C]">
                            {plan.price}
                          </span>
                          <span className="text-sm font-semibold text-[#405875]">{plan.suffix}</span>
                        </div>

                        <p className={`mt-3 rounded-md px-3 py-2 text-center text-xs font-extrabold ${
                          isGreen ? "bg-[#E3F7EC] text-[#058467]" : "bg-[#EAF5FF] text-[#0B5CAB]"
                        }`}>
                          {plan.detail}
                        </p>
                        {plan.highlight && (
                          <div className={`mt-3 flex items-center gap-2 rounded-md px-3 py-2.5 text-xs font-extrabold ${
                            isGreen ? "bg-[#E3F7EC] text-[#058467]" : "bg-[#EAF5FF] text-[#0B5CAB]"
                          }`}>
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                              isGreen ? "border-[#058467]" : "border-[#0B5CAB]"
                            }`}>
                              <DollarSign className="h-3.5 w-3.5" />
                            </span>
                            <span>{plan.highlight}</span>
                          </div>
                        )}
                        {!plan.configured && !billingPlansQuery.isLoading && !billingPlansQuery.isError && (
                          <p className="mt-2 text-xs font-semibold text-amber-700">
                            Configure o price id deste plano.
                          </p>
                        )}

                        <div className="mt-auto flex items-start gap-2 pt-3 text-xs font-medium leading-4 text-[#405875]">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0B5CAB]" />
                          <span>{plan.footer}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex gap-3 rounded-lg border border-[#D5E4F2] bg-[#F3F8FF] px-4 py-3 text-[#405875] shadow-sm">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#9DC8F2] bg-white text-[#0B5CAB]">
                    <Info className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-extrabold text-[#0B5CAB]">
                      Todos os planos oferecem os mesmos recursos.
                    </p>
                    <p className="mt-0.5 text-xs leading-5">
                      A diferença está no período contratado, na economia e no limite de pacientes: 30 no mensal, 40 no semestral e 60 no anual.
                    </p>
                  </div>
                </div>

                <Button
                  className="relative mt-4 h-12 w-full rounded-md bg-[#0B5CAB] text-base font-extrabold text-white shadow-[0_14px_28px_rgba(11,92,171,0.18)] hover:bg-[#084B8A]"
                  disabled={!selectedPlanOption?.configured || checkoutStarted || billingPlansQuery.isLoading || stripeConfigQuery.isLoading || !embeddedCheckoutConfigured}
                  onClick={() => setCheckoutStarted(true)}
                >
                  {checkoutStarted ? "Checkout iniciado" : "Começar meus 7 dias grátis"}
                  {!checkoutStarted && <ArrowRight className="absolute right-6 h-5 w-5" />}
                </Button>
                <p className="mt-2 text-center text-sm font-semibold leading-5 text-[#53657A]">
                  {selectedPlanChargeNote}
                </p>
              </div>

              {checkoutStarted && (
                <div className="mt-5 overflow-hidden rounded-lg border border-[#D5E4F2] bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-[#E6EEF7] px-4 py-3">
                    <div>
                      <p className="text-xs font-bold uppercase text-[#65758B]">Plano selecionado</p>
                      <p className="text-sm font-extrabold text-[#05203C]">
                        {selectedPlanName} · {selectedPlanOption?.formattedAmount}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-md border-[#C7D6E6] text-xs"
                      onClick={() => setCheckoutStarted(false)}
                    >
                      Trocar
                    </Button>
                  </div>
                  <div className="p-2 sm:p-4">
                    <EmbeddedCheckoutProvider key={selectedPlan} stripe={stripePromise} options={checkoutOptions}>
                      <EmbeddedCheckout className="min-h-[640px]" />
                    </EmbeddedCheckoutProvider>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </CheckoutShell>
  );
}
