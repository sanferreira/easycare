import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Redirect } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type BillingStatus = {
  organizationName: string;
  organizationStatus: "active" | "inactive" | "restricted";
  stripeSubscriptionStatus: string | null;
  stripeCancelAtPeriodEnd: boolean;
  stripeCancelAt: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  billingMethod: "stripe" | "manual_boleto" | string | null;
  hasStripeCustomer: boolean;
};

type CancelSubscriptionResponse = {
  status: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  organizationStatus: "active" | "inactive" | "restricted";
};

async function parseApiResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.message || fallbackMessage);
  }
  return payload as T;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(date);
}

function isStripeSubscriptionCancellable(status: string | null) {
  return status === "trialing" || status === "active" || status === "past_due" || status === "unpaid" || status === "incomplete";
}

export default function BillingCancel() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();

  const billingQuery = useQuery<BillingStatus>({
    queryKey: ["/api/billing/subscription"],
    enabled: !!user && !user.isSuperAdmin,
    queryFn: async () => {
      const res = await fetch("/api/billing/subscription", { credentials: "include" });
      return parseApiResponse<BillingStatus>(res, "Erro ao carregar assinatura.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/cancel-subscription", {
        method: "POST",
        credentials: "include",
      });
      return parseApiResponse<CancelSubscriptionResponse>(res, "Erro ao cancelar assinatura.");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-user"] });
      toast({
        title: "Cancelamento agendado",
        description: "O acesso continua até o fim do período atual.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro no cancelamento", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (!user) return <Redirect to="/login" />;
  if (user.isSuperAdmin) return <Redirect to="/admin" />;

  const data = billingQuery.data;
  const isTrial = data?.stripeSubscriptionStatus === "trialing";
  const effectiveCancelAtPeriodEnd = cancelMutation.data?.cancelAtPeriodEnd ?? data?.stripeCancelAtPeriodEnd ?? false;
  const effectiveCancelAt = formatDate(
    cancelMutation.data?.cancelAt
    ?? data?.stripeCancelAt
    ?? cancelMutation.data?.subscriptionCurrentPeriodEnd
    ?? data?.subscriptionCurrentPeriodEnd,
  );
  const canCancel = Boolean(
    data?.hasStripeCustomer
    && isStripeSubscriptionCancellable(data.stripeSubscriptionStatus)
    && !effectiveCancelAtPeriodEnd,
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Cobrança</p>
            <h1 className="mt-1 text-2xl font-bold text-[#0A0F2C] sm:text-3xl">
              {effectiveCancelAtPeriodEnd ? "Cancelamento agendado" : isTrial ? "Cancelar teste grátis" : "Cancelar assinatura"}
            </h1>
          </div>
          <Button asChild variant="outline" className="h-10 rounded-md border-slate-300 bg-white">
            <Link href="/billing">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar para cobrança
            </Link>
          </Button>
        </div>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
            <aside className="easycare-brand-panel p-6 sm:p-8">
              <img src="/brand/logo-easycare-header.png" alt="EasyCare" className="h-10 w-auto object-contain" />
              <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE]">
                Cancelamento seguro
              </p>
              <h2 className="mt-3 text-2xl font-bold leading-tight text-white">
                Você mantém acesso até o fim do período atual.
              </h2>
              <div className="mt-7 space-y-4">
                {[
                  "Nenhum dado operacional é apagado ao agendar o cancelamento.",
                  "A assinatura é alterada diretamente na Stripe.",
                  isTrial ? "Cancelando durante o teste, não haverá cobrança ao final dos 7 dias." : "Nenhuma nova cobrança é feita após o encerramento do período atual.",
                ].map((text) => (
                  <div key={text} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#22D3EE]" />
                    <p className="text-sm leading-6 text-white/75">{text}</p>
                  </div>
                ))}
              </div>
            </aside>

            <div className="p-6 sm:p-8">
              {billingQuery.isLoading ? (
                <div className="flex min-h-[280px] items-center justify-center text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Carregando assinatura...
                </div>
              ) : !data?.hasStripeCustomer || !data.stripeSubscriptionStatus ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-800">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <h3 className="font-bold">Nenhuma assinatura Stripe encontrada.</h3>
                      <p className="mt-2 text-sm leading-6">
                        Esta organização ainda não possui assinatura ativa na Stripe. Volte para cobrança para iniciar ou regularizar o acesso.
                      </p>
                    </div>
                  </div>
                </div>
              ) : effectiveCancelAtPeriodEnd ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-green-800">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <h3 className="font-bold">Cancelamento já agendado.</h3>
                      <p className="mt-2 text-sm leading-6">
                        O acesso permanece liberado até {effectiveCancelAt ?? "o fim do período atual"}. Depois disso, a Stripe não fará nova cobrança.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Organização</p>
                        <h2 className="mt-1 text-xl font-bold text-[#0A0F2C]">{data.organizationName}</h2>
                      </div>
                      <Badge className="w-fit rounded-md border border-sky-200 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                        {isTrial ? "Teste grátis ativo" : `Stripe: ${data.stripeSubscriptionStatus}`}
                      </Badge>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-slate-200 bg-white p-4">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                          <CalendarDays className="h-4 w-4 text-[#1F6FEB]" />
                          Encerramento
                        </div>
                        <p className="mt-2 text-sm font-bold text-[#0A0F2C]">
                          {effectiveCancelAt ?? "Fim do período atual"}
                        </p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-4">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                          <CreditCard className="h-4 w-4 text-[#1F6FEB]" />
                          Cobrança
                        </div>
                        <p className="mt-2 text-sm font-bold text-[#0A0F2C]">
                          {isTrial ? "Sem cobrança após cancelar" : "Sem nova cobrança após o período"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#D5E4F2] bg-[#F3F8FF] p-5">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#0B5CAB]" />
                      <div>
                        <h3 className="font-bold text-[#0A0F2C]">
                          {isTrial ? "Ao cancelar o teste grátis" : "Ao cancelar a assinatura"}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[#405875]">
                          {isTrial
                            ? "O EasyCare agenda o encerramento para o fim dos 7 dias grátis. O acesso continua até essa data e a Stripe não inicia a cobrança."
                            : "O EasyCare agenda o encerramento para o fim do período já contratado. O acesso continua até essa data e a Stripe não gera novas cobranças depois disso."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      className="h-11 rounded-md bg-rose-700 px-5 text-white hover:bg-rose-800"
                      disabled={!canCancel || cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate()}
                    >
                      {cancelMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                      {isTrial ? "Confirmar cancelamento do teste" : "Confirmar cancelamento"}
                    </Button>
                    <Button asChild variant="outline" className="h-11 rounded-md border-slate-300 bg-white">
                      <Link href="/billing">Manter assinatura</Link>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
