import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BedDouble,
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  CreditCard,
  FileText,
  HeartHandshake,
  Pill,
  ShieldCheck,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { useStaff } from "@/hooks/use-staff";
import { useStats } from "@/hooks/use-stats";

type BillingStatus = {
  organizationName: string;
  organizationStatus: "active" | "inactive" | "restricted";
  stripeSubscriptionStatus: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  checkoutConfigured: boolean;
  portalConfigured: boolean;
};

type FamilyPortalSummary = {
  totalMembers: number;
  portalEnabled: number;
  invited: number;
};

type OnboardingStep = {
  title: string;
  description: string;
  done: boolean;
  href: string;
  action: string;
  icon: LucideIcon;
  detail?: string;
};

async function fetchJsonOrFallback<T>(path: string, fallback: T): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) return fallback;
  return res.json();
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function daysUntil(value?: string | null) {
  if (!value) return null;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return null;
  const diff = target - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function billingLabel(status?: string | null) {
  const labels: Record<string, string> = {
    trialing: "Teste grátis",
    active: "Assinatura ativa",
    past_due: "Pagamento atrasado",
    unpaid: "Pagamento pendente",
    incomplete: "Pagamento incompleto",
    canceled: "Cancelada",
  };
  return labels[status || ""] ?? "Sem assinatura";
}

function billingStatusLabel(billing?: BillingStatus | null) {
  if (billing?.organizationStatus === "active" && !billing.stripeSubscriptionStatus) {
    return "Acesso liberado";
  }
  return billingLabel(billing?.stripeSubscriptionStatus);
}

function plural(count: number, singular: string, pluralLabel: string) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export default function Onboarding() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: staff = [] } = useStaff();

  const { data: billing } = useQuery<BillingStatus | null>({
    queryKey: ["/api/billing/subscription"],
    enabled: !!user && !user.isSuperAdmin,
    queryFn: () => fetchJsonOrFallback<BillingStatus | null>("/api/billing/subscription", null),
    refetchInterval: 30000,
  });

  const { data: shifts = [] } = useQuery<any[]>({
    queryKey: ["/api/shift-assignments", "onboarding"],
    queryFn: () => fetchJsonOrFallback<any[]>("/api/shift-assignments", []),
  });

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/time-clock/locations", "onboarding"],
    queryFn: () => fetchJsonOrFallback<any[]>("/api/time-clock/locations", []),
  });

  const { data: familyPortal = { totalMembers: 0, portalEnabled: 0, invited: 0 } } = useQuery<FamilyPortalSummary>({
    queryKey: ["onboarding-family-portal"],
    enabled: !!stats?.totalResidents,
    queryFn: async () => {
      const residents = await fetchJsonOrFallback<any[]>("/api/residents?status=active", []);
      const familyLists = await Promise.all(
        residents.map((resident) => fetchJsonOrFallback<any[]>(`/api/residents/${resident.id}/family`, [])),
      );
      const members = familyLists.flat();
      return {
        totalMembers: members.length,
        portalEnabled: members.filter((member) => member.portalAccess).length,
        invited: members.filter((member) => member.portalInvitedAt).length,
      };
    },
  });

  const trialDaysLeft = daysUntil(billing?.subscriptionCurrentPeriodEnd);
  const billingIsActive = billing?.organizationStatus === "active";
  const billingIsTrial = billing?.stripeSubscriptionStatus === "trialing";
  const staffCount = staff.length;
  const shiftCount = shifts.length;
  const locationCount = locations.length;
  const residentCount = stats?.totalResidents ?? 0;
  const activeMedicationCount = stats?.activeMedications ?? 0;
  const activeContractCount = stats?.activeContracts ?? 0;

  const steps = useMemo<OnboardingStep[]>(() => [
    {
      title: "Assinatura e teste grátis",
      description: "Confirme se a instituição está com acesso liberado antes de implantar a operação.",
      done: billingIsActive,
      href: "/billing",
      action: billingIsActive ? "Ver cobrança" : "Regularizar acesso",
      icon: CreditCard,
      detail: billingIsTrial && trialDaysLeft !== null
        ? `${trialDaysLeft} dia${trialDaysLeft === 1 ? "" : "s"} de teste restantes`
        : billingStatusLabel(billing),
    },
    {
      title: "Cadastrar equipe",
      description: "Adicione cuidadores, enfermagem, administrativo e gestores que usarão o sistema.",
      done: staffCount > 0,
      href: "/staff",
      action: staffCount > 0 ? "Ver equipe" : "Cadastrar equipe",
      icon: UserCheck,
      detail: plural(staffCount, "colaborador", "colaboradores"),
    },
    {
      title: "Cadastrar pacientes",
      description: "Inclua os pacientes ativos para liberar prontuário, medicações, financeiro e família.",
      done: residentCount > 0,
      href: "/residents",
      action: residentCount > 0 ? "Ver pacientes" : "Cadastrar paciente",
      icon: BedDouble,
      detail: plural(residentCount, "paciente ativo", "pacientes ativos"),
    },
    {
      title: "Criar escalas",
      description: "Monte os plantões para organizar a rotina da equipe e alimentar o ponto eletrônico.",
      done: shiftCount > 0,
      href: "/escalas",
      action: shiftCount > 0 ? "Ver escalas" : "Criar escala",
      icon: Calendar,
      detail: plural(shiftCount, "escala criada", "escalas criadas"),
    },
    {
      title: "Configurar ponto eletrônico",
      description: "Cadastre locais de batida e confira as regras antes da equipe começar a registrar ponto.",
      done: locationCount > 0,
      href: "/ponto-eletronico",
      action: locationCount > 0 ? "Ver ponto" : "Configurar ponto",
      icon: Clock3,
      detail: plural(locationCount, "local configurado", "locais configurados"),
    },
    {
      title: "Iniciar rotina clínica",
      description: "Registre prescrições, evoluções ou ocorrências para tirar o prontuário do zero.",
      done: activeMedicationCount > 0 || (stats?.pendingOccurrences ?? 0) > 0,
      href: "/prontuario",
      action: "Abrir prontuário",
      icon: Pill,
      detail: plural(activeMedicationCount, "medicação ativa", "medicações ativas"),
    },
    {
      title: "Ativar financeiro",
      description: "Cadastre contratos para usar a calculadora automática de mensalidades.",
      done: activeContractCount > 0,
      href: "/financeiro",
      action: activeContractCount > 0 ? "Ver financeiro" : "Cadastrar contrato",
      icon: FileText,
      detail: plural(activeContractCount, "contrato ativo", "contratos ativos"),
    },
    {
      title: "Liberar portal da família",
      description: "Convide responsáveis para acompanhar as informações compartilhadas do paciente.",
      done: familyPortal.portalEnabled > 0 || familyPortal.invited > 0,
      href: "/residents",
      action: "Convidar família",
      icon: Users,
      detail: plural(familyPortal.portalEnabled, "acesso liberado", "acessos liberados"),
    },
  ], [
    billing,
    billing?.stripeSubscriptionStatus,
    billingIsActive,
    billingIsTrial,
    familyPortal.invited,
    familyPortal.portalEnabled,
    locationCount,
    shiftCount,
    staffCount,
    activeContractCount,
    activeMedicationCount,
    stats?.pendingOccurrences,
    residentCount,
    trialDaysLeft,
  ]);

  const completed = steps.filter((step) => step.done).length;
  const progress = Math.round((completed / steps.length) * 100);
  const nextStep = steps.find((step) => !step.done);

  if (statsLoading) {
    return (
      <div className="space-y-5">
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-36 animate-pulse rounded-lg bg-muted" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#D5E4F2] bg-white shadow-sm">
        <div className="h-1 bg-[linear-gradient(90deg,#0B5CAB_0%,#11C5D9_52%,#5F5CFF_100%)]" />
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_320px] lg:p-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md border border-[#0B5CAB]/15 bg-[#F0F8FF] px-3 py-1.5 text-sm font-bold text-[#0B5CAB]">
              <ShieldCheck className="h-4 w-4" />
              Primeiros passos
            </div>
            <h1 className="mt-4 text-3xl font-extrabold tracking-normal text-[#25314B]">
              Implantação da {user?.organizationName ?? "instituição"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#65758B]">
              Siga esta ordem para deixar o EasyCare pronto para equipe, pacientes, ponto eletrônico, financeiro e famílias.
            </p>
            {nextStep ? (
              <Button
                className="mt-5 h-11 rounded-md bg-[#0B5CAB] font-bold text-white hover:bg-[#084B8A]"
                onClick={() => navigate(nextStep.href)}
              >
                Continuar: {nextStep.title}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Badge className="mt-5 border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">
                Implantação principal concluída
              </Badge>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-[#65758B]">Progresso</p>
                <p className="mt-1 text-3xl font-extrabold text-[#25314B]">{progress}%</p>
              </div>
              <p className="text-sm font-semibold text-[#65758B]">
                {completed}/{steps.length} etapas
              </p>
            </div>
            <Progress value={progress} className="mt-4 h-2" />
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#65758B]">
              <span className="rounded-md bg-white px-2 py-2">
                Trial: {billingIsTrial && trialDaysLeft !== null ? `${trialDaysLeft} dias` : billingStatusLabel(billing)}
              </span>
              <span className="rounded-md bg-white px-2 py-2">
                Até: {formatDate(billing?.subscriptionCurrentPeriodEnd)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <Card key={step.title} className="rounded-lg border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#F0F8FF] text-[#0B5CAB]">
                  <step.icon className="h-5 w-5" />
                </div>
                <Badge
                  variant="outline"
                  className={step.done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"}
                >
                  {step.done ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <Circle className="mr-1 h-3 w-3" />}
                  {step.done ? "Concluído" : "Pendente"}
                </Badge>
              </div>
              <CardTitle className="text-base text-[#25314B]">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="min-h-[48px] text-sm leading-6 text-[#65758B]">{step.description}</p>
              {step.detail && (
                <p className="rounded-md border border-slate-200 bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-[#53657A]">
                  {step.detail}
                </p>
              )}
              <Button asChild variant="outline" className="h-10 w-full rounded-md border-[#C7D6E6] text-[#0B5CAB] hover:bg-[#F0F8FF]">
                <Link href={step.href}>
                  {step.action}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-lg border-slate-200 shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-[#25314B]">
              <HeartHandshake className="h-4 w-4 text-[#0B5CAB]" />
              Próxima rotina recomendada
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {[
              ["1", "Cadastre 1 paciente real e seus responsáveis."],
              ["2", "Crie uma escala simples para testar o ponto."],
              ["3", "Registre uma evolução compartilhada para validar o portal da família."],
            ].map(([number, text]) => (
              <div key={number} className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0B5CAB] text-sm font-bold text-white">
                  {number}
                </span>
                <p className="mt-3 text-sm leading-6 text-[#53657A]">{text}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="easycare-brand-panel rounded-lg border-white/12 text-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Checklist comercial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-white/72">
            <p>Use esta tela em implantação assistida com o cliente. Ela mostra onde a operação ainda está vazia.</p>
            <Button asChild className="h-10 w-full rounded-md bg-[#22D3EE] font-bold text-[#07122E] hover:bg-[#76DFFF]">
              <Link href="/billing">
                Ver assinatura
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
