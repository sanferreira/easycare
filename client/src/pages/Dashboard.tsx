import { useStats } from "@/hooks/use-stats";
import { useAuth } from "@/hooks/use-auth";
import { useResidents } from "@/hooks/use-residents";
import { useQuery } from "@tanstack/react-query";
import {
  Users, BedDouble, Pill, AlertCircle, Calendar, TrendingUp,
  Activity, ArrowRight, ChevronRight, Download, BarChart2, PieChartIcon, Clock3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLocation } from "wouter";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

const BRAND = {
  blue:   "#1F6FEB",
  cyan:   "#22D3EE",
  green:  "#22C55E",
  yellow: "#F59E0B",
  red:    "#EF4444",
  purple: "#A855F7",
};

function KpiCard({ title, value, desc, icon: Icon, color, gradient, to }: {
  title: string; value: string | number; desc: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; gradient: string; to: string;
}) {
  const [, navigate] = useLocation();
  return (
    <button
      onClick={() => navigate(to)}
      className="relative bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden p-5 group hover:shadow-md hover:border-border transition-all duration-200 text-left w-full cursor-pointer"
      data-testid={`kpi-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: `linear-gradient(135deg, ${gradient}10 0%, transparent 60%)` }} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold mt-1.5 text-foreground tracking-tight" style={{ fontFamily: "var(--font-display)" }}>{value}</p>
          <p className="text-xs text-muted-foreground mt-1.5">{desc}</p>
        </div>
        <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110" style={{ background: `${color}18` }}>
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: `${color}15` }}>
          <div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${color}, ${gradient})`, width: "65%" }} />
        </div>
        <span className="text-[10px] font-medium opacity-0 group-hover:opacity-60 transition-opacity" style={{ color }}>Ver →</span>
      </div>
    </button>
  );
}

function EmptyState({ title, text, actionLabel, to, icon: Icon = AlertCircle }: {
  title: string;
  text: string;
  actionLabel: string;
  to: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const [, navigate] = useLocation();
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{text}</p>
      <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={() => navigate(to)}>
        {actionLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl shadow-lg px-3 py-2 text-sm">
      {label && <p className="font-semibold text-foreground mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? p.fill }}>{p.name}: <span className="font-semibold">{typeof p.value === "number" && p.name?.toLowerCase().includes("r$") ? `R$ ${p.value.toLocaleString("pt-BR")}` : p.value}</span></p>
      ))}
    </div>
  );
};

const CustomPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.07) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>{`${(percent * 100).toFixed(0)}%`}</text>;
};

function downloadCSV(rows: string[][], filename: string) {
  const sep = ";";
  const content = rows
    .map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(sep))
    .join("\r\n");
  // Encode as Windows-1252 (Latin-1) — padrão do Excel em pt-BR
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) {
    bytes[i] = content.charCodeAt(i) & 0xff;
  }
  const blob = new Blob([bytes], { type: "text/csv;charset=windows-1252;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const { data: stats, isLoading } = useStats();
  const { user } = useAuth();
  const { data: residents = [] } = useResidents({ status: "active" });
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: shifts = [] } = useQuery<any[]>({
    queryKey: ["/api/shift-assignments"],
    queryFn: async () => {
      const res = await fetch("/api/shift-assignments", { credentials: "include" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
  });

  const { data: fees = [] } = useQuery<any[]>({
    queryKey: ["/api/monthly-fees"],
    queryFn: async () => {
      const res = await fetch("/api/monthly-fees", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: occurrences = [] } = useQuery<any[]>({
    queryKey: ["/api/occurrences"],
    queryFn: async () => {
      const res = await fetch("/api/occurrences", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: medications = [] } = useQuery<any[]>({
    queryKey: ["/api/medications"],
    queryFn: async () => {
      const res = await fetch("/api/medications", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: staff = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", "dashboard-health"],
    queryFn: async () => {
      const res = await fetch("/api/staff", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  const activeShifts = shifts.filter((s: any) => now >= new Date(s.startTime) && now <= new Date(s.endTime));
  const shiftsThisMonth = shifts.filter((s: any) => {
    const start = new Date(s.startTime);
    return start >= currentMonthStart && start < nextMonthStart;
  });
  const activeStaff = staff.filter((member: any) => member.active !== false);
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const timeClockPendingTotal =
    (stats?.timeClockPendingApprovals ?? 0)
    + (stats?.timeClockPendingAdjustments ?? 0)
    + (stats?.timeClockIncompleteToday ?? 0)
    + (stats?.timeClockOutOfRangeToday ?? 0);
  const totalResidents = stats?.totalResidents ?? 0;
  const capacity = stats?.capacity ?? 0;
  const activeContracts = stats?.activeContracts ?? 0;
  const financialPendingTotal = fees.filter((fee: any) => fee.status === "pending" || fee.status === "overdue").length;
  const operationHealthItems = [
    {
      title: "Pacientes ativos",
      value: totalResidents,
      helper: totalResidents === 0 ? "Cadastre o primeiro paciente para iniciar prontuário, família e financeiro." : `${totalResidents} de ${capacity} vagas do plano`,
      to: "/residents",
      color: BRAND.blue,
    },
    {
      title: "Equipe ativa",
      value: activeStaff.length,
      helper: activeStaff.length === 0 ? "Cadastre cuidadores, enfermagem e gestores para operar escalas e ponto." : `${activeStaff.length} colaborador${activeStaff.length === 1 ? "" : "es"} com acesso operacional`,
      to: "/staff",
      color: BRAND.cyan,
    },
    {
      title: "Escalas do mês",
      value: shiftsThisMonth.length,
      helper: shiftsThisMonth.length === 0 ? "Monte as escalas do mês para alimentar rotina e ponto eletrônico." : "Plantões programados neste mês",
      to: "/escalas",
      color: BRAND.purple,
    },
    {
      title: "Ponto pendente",
      value: timeClockPendingTotal,
      helper: timeClockPendingTotal > 0 ? "Existem batidas, ajustes ou jornadas para revisar." : "Sem pendências críticas no ponto agora",
      to: "/ponto-eletronico",
      color: timeClockPendingTotal > 0 ? BRAND.red : BRAND.green,
    },
    {
      title: "Financeiro pendente",
      value: financialPendingTotal,
      helper: financialPendingTotal > 0 ? "Há mensalidades pendentes ou vencidas para acompanhar." : "Sem mensalidades pendentes carregadas",
      to: "/financeiro",
      color: financialPendingTotal > 0 ? BRAND.yellow : BRAND.green,
    },
  ];
  const setupGaps = [
    totalResidents === 0 ? { label: "Sem pacientes", to: "/residents" } : null,
    activeStaff.length === 0 ? { label: "Sem equipe", to: "/staff" } : null,
    shiftsThisMonth.length === 0 ? { label: "Sem escala no mês", to: "/escalas" } : null,
    financialPendingTotal === 0 && activeContracts === 0 ? { label: "Sem contratos/financeiro", to: "/financeiro" } : null,
    totalResidents > 0 ? { label: "Revise familiares e portal", to: "/residents" } : null,
  ].filter(Boolean) as Array<{ label: string; to: string }>;

  // ── Chart data ──────────────────────────────────────────────────────────────

  const feePieData = (() => {
    const groups = { paid: 0, pending: 0, overdue: 0 };
    fees.forEach((f: any) => { if (f.status in groups) groups[f.status as keyof typeof groups]++; });
    return [
      { name: "Pagos",     value: groups.paid,    color: BRAND.green  },
      { name: "Pendentes", value: groups.pending,  color: BRAND.yellow },
      { name: "Vencidos",  value: groups.overdue,  color: BRAND.red    },
    ].filter(d => d.value > 0);
  })();

  const occurrenceBarData = (() => {
    const map: Record<string, { low: number; medium: number; high: number }> = {};
    occurrences.forEach((o: any) => {
      if (!map[o.type]) map[o.type] = { low: 0, medium: 0, high: 0 };
      if (o.severity in map[o.type]) map[o.type][o.severity as keyof typeof map[string]]++;
    });
    return Object.entries(map).map(([type, counts]) => ({
      type: type.length > 12 ? type.slice(0, 12) + "…" : type,
      Baixa: counts.low, Média: counts.medium, Alta: counts.high,
    }));
  })();

  const feeAmountData = (() => {
    const months: Record<string, { name: string; Pagos: number; Pendentes: number; Vencidos: number }> = {};
    fees.forEach((f: any) => {
      const m = f.referenceMonth ?? format(new Date(f.createdAt), "yyyy-MM");
      const [yr, mo] = m.split("-");
      const label = format(new Date(Number(yr), Number(mo) - 1, 1), "MMM/yy", { locale: ptBR });
      if (!months[m]) months[m] = { name: label, Pagos: 0, Pendentes: 0, Vencidos: 0 };
      const val = (f.amount ?? 0) + (f.fine ?? 0) - (f.discount ?? 0);
      if (f.status === "paid")    months[m].Pagos    += val;
      if (f.status === "pending") months[m].Pendentes += val;
      if (f.status === "overdue") months[m].Vencidos  += val;
    });
    return Object.values(months);
  })();

  // ── CSV Report ───────────────────────────────────────────────────────────────

  function handleDownloadReport() {
    const today = format(new Date(), "dd/MM/yyyy");
    const rows: string[][] = [];

    rows.push([`RELATÓRIO EASYCARE — ${user?.organizationName ?? ""}`, "", "", "", `Gerado em: ${today}`]);
    rows.push([]);

    rows.push(["=== RESIDENTES ATIVOS ===", "", "", "", ""]);
    rows.push(["Nome", "Quarto", "Data Admissão", "Alergias", "Contato"]);
    residents.forEach((r: any) => {
      rows.push([r.name, r.roomNumber ?? "—", r.admissionDate ? format(new Date(r.admissionDate + "T00:00:00"), "dd/MM/yyyy") : "—", r.allergies ?? "—", r.contactName ?? "—"]);
    });
    rows.push([]);

    rows.push(["=== MENSALIDADES ===", "", "", "", ""]);
    rows.push(["Paciente", "Mês Referência", "Valor (R$)", "Status", "Pago em"]);
    fees.forEach((f: any) => {
      const statusLabel = f.status === "paid" ? "Pago" : f.status === "pending" ? "Pendente" : "Vencido";
      rows.push([f.residentName ?? "—", f.referenceMonth ?? "—", String(f.amount ?? 0), statusLabel, f.paidAt ? format(new Date(f.paidAt), "dd/MM/yyyy") : "—"]);
    });
    rows.push([]);

    rows.push(["=== MEDICAÇÕES ATIVAS ===", "", "", "", ""]);
    rows.push(["Paciente", "Medicamento", "Dosagem", "Frequência", "Status"]);
    medications.filter((m: any) => m.status === "active").forEach((m: any) => {
      rows.push([m.residentName ?? "—", m.name, m.dosage, m.frequency, "Ativo"]);
    });
    rows.push([]);

    rows.push(["=== OCORRÊNCIAS ABERTAS ===", "", "", "", ""]);
    rows.push(["Paciente", "Tipo", "Descrição", "Severidade", "Data"]);
    occurrences.filter((o: any) => o.status === "open").forEach((o: any) => {
      const sev = o.severity === "low" ? "Baixa" : o.severity === "medium" ? "Média" : "Alta";
      rows.push([o.residentName ?? "—", o.type, o.description, sev, format(new Date(o.createdAt), "dd/MM/yyyy")]);
    });

    downloadCSV(rows, `relatório-easycare-${format(new Date(), "yyyy-MM-dd")}.csv`);
    toast({ title: "Relatório baixado!", description: "O arquivo CSV foi salvo no seu computador." });
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-full max-w-72 bg-muted rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-36 bg-muted rounded-2xl" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-56 bg-muted rounded-2xl lg:col-span-2" />
          <div className="h-56 bg-muted rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium text-muted-foreground">
              {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          </div>
          <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            {greeting},{" "}
            <span className="gradient-text">{user?.name?.split(" ")[0] ?? "usuário"}</span>
          </h1>
          {user?.organizationName && (
            <p className="text-muted-foreground mt-0.5 text-sm">{user.organizationName}</p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
          <Button
            variant="outline" size="sm"
            className="w-full justify-center gap-2 shadow-sm hover:shadow-md transition-all sm:w-auto"
            onClick={handleDownloadReport}
            data-testid="button-download-report"
          >
            <Download className="h-4 w-4" />
            Baixar Relatório
          </Button>
          <button
            onClick={() => navigate("/escalas")}
            className="flex w-full items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group sm:w-auto"
            data-testid="button-active-shifts-header"
          >
            <div className={`h-2 w-2 rounded-full shrink-0 ${activeShifts.length > 0 ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`} />
           <p className="text-sm font-medium text-foreground">
              {activeShifts.length > 0
                ? `${activeShifts.length} ${activeShifts.length > 1 ? "plantões" : "plantão"} em andamento`
                : "Nenhum plantão ativo agora"}
            </p>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity -ml-1" />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="Pacientes Ativos" value={stats.totalResidents} desc="Cadastrados no sistema" icon={Users} color={BRAND.blue} gradient={BRAND.cyan} to="/residents" />
        <KpiCard title="Taxa de Ocupação" value={`${stats.occupancyRate}%`} desc={`${stats.totalResidents} de ${stats.capacity} vagas ocupadas`} icon={BedDouble} color={BRAND.cyan} gradient={BRAND.blue} to="/residents" />
        <KpiCard title="Medicações Ativas" value={stats.activeMedications} desc="Prescrições vigentes" icon={Pill} color={BRAND.green} gradient={BRAND.cyan} to="/residents" />
        <KpiCard title="Doses em Atraso" value={stats.overdueMedicationDoses} desc="Pendentes até agora" icon={AlertCircle} color={BRAND.red} gradient={BRAND.yellow} to="/prontuario" />
        <KpiCard title="Pendências de Ponto" value={timeClockPendingTotal} desc="Ações para revisar" icon={Clock3} color={timeClockPendingTotal > 0 ? BRAND.red : BRAND.green} gradient={BRAND.yellow} to="/ponto-eletronico" />
        <KpiCard title="Plantões Agora" value={activeShifts.length} desc="Em andamento agora" icon={Activity} color={BRAND.purple} gradient={BRAND.blue} to="/escalas" />
      </div>

      {timeClockPendingTotal > 0 && (
        <button
          type="button"
          onClick={() => navigate("/ponto-eletronico")}
          className="flex w-full flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-amber-800 shadow-sm transition hover:border-amber-300 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
          data-testid="alert-time-clock-pending"
        >
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Pendências de ponto aguardando ação</p>
              <p className="mt-0.5 text-xs">
                {(stats.timeClockPendingApprovals ?? 0)} batida(s) sem escala, {(stats.timeClockPendingAdjustments ?? 0)} ajuste(s), {(stats.timeClockIncompleteToday ?? 0)} jornada(s) incompleta(s) hoje e {(stats.timeClockOutOfRangeToday ?? 0)} tentativa(s) fora do raio hoje.
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold">Abrir ponto</span>
        </button>
      )}

      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Saúde da operação
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Indicadores rápidos para saber se a operação está pronta para rodar hoje.
              </p>
            </div>
            <Badge variant={setupGaps.length > 0 ? "secondary" : "default"} className="w-fit">
              {setupGaps.length > 0 ? `${setupGaps.length} ponto(s) para revisar` : "Operação em dia"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {operationHealthItems.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => navigate(item.to)}
                className="rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
                data-testid={`operation-health-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.title}</p>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                </div>
                <p className="mt-3 text-2xl font-bold text-foreground">{item.value}</p>
                <p className="mt-1 min-h-[38px] text-xs leading-5 text-muted-foreground">{item.helper}</p>
              </button>
            ))}
          </div>
          {setupGaps.length > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-950">Próximos ajustes recomendados</p>
                <p className="mt-1 text-xs leading-5 text-blue-800/75">
                  Resolva os vazios antes de escalar o uso para equipe, família e financeiro.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {setupGaps.map((gap) => (
                  <button
                    key={gap.label}
                    type="button"
                    onClick={() => navigate(gap.to)}
                    className="inline-flex h-8 items-center rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    {gap.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Bar chart — financial by month */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                Resumo Financeiro por Competência
              </CardTitle>
              <button onClick={() => navigate("/financeiro")} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors" data-testid="button-view-financeiro">
                Ver detalhes <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {feeAmountData.length === 0 ? (
              <EmptyState
                title="Sem dados financeiros ainda"
                text="Cadastre contratos e mensalidades para visualizar recebimentos, pendências e vencidos por competência."
                actionLabel="Abrir financeiro"
                to="/financeiro"
                icon={BarChart2}
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={feeAmountData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="Pagos"     fill={BRAND.green}  radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="Pendentes" fill={BRAND.yellow} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="Vencidos"  fill={BRAND.red}    radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pie chart — fee status */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 text-primary" />
              Status das Mensalidades
            </CardTitle>
          </CardHeader>
          <CardContent>
            {feePieData.length === 0 ? (
              <EmptyState
                title="Sem mensalidades registradas"
                text="Quando houver mensalidades cadastradas, este gráfico mostra pagas, pendentes e vencidas."
                actionLabel="Cadastrar cobrança"
                to="/financeiro"
                icon={PieChartIcon}
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={feePieData} cx="50%" cy="50%"
                    innerRadius={55} outerRadius={88}
                    paddingAngle={3} dataKey="value"
                    labelLine={false} label={<CustomPieLabel />}
                  >
                    {feePieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    iconType="circle" iconSize={8}
                    wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                    formatter={(value, entry: any) => (
                      <span style={{ color: "hsl(var(--foreground))" }}>
                        {value} <span style={{ color: entry.color, fontWeight: 700 }}>({entry.payload.value})</span>
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Occurrences + Residents */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent residents */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Pacientes</CardTitle>
              <button onClick={() => navigate("/residents")} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors" data-testid="button-view-all-residents">
                Ver todos <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {residents.length === 0 ? (
              <EmptyState
                title="Nenhum paciente ativo"
                text="Cadastre o primeiro paciente para liberar prontuário, medicações, familiares e contrato financeiro."
                actionLabel="Cadastrar paciente"
                to="/residents"
                icon={Users}
              />
            ) : (
              <div className="divide-y divide-border/60">
                {residents.slice(0, 5).map((r: any) => (
                  <button key={r.id} onClick={() => navigate("/residents")}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 w-full text-left group hover:bg-muted/30 -mx-1 px-1 rounded-lg transition-colors"
                    data-testid={`row-resident-${r.id}`}
                  >
                    <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 text-white"
                      style={{ background: "linear-gradient(135deg, #1F6FEB, #22D3EE)" }}>
                      {r.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground">Quarto {r.roomNumber}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={r.status === "active" ? "default" : "secondary"} className="text-xs">
                        {r.status === "active" ? "Ativo" : r.status}
                      </Badge>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
                {residents.length > 5 && (
                  <button onClick={() => navigate("/residents")} className="text-xs text-primary hover:text-primary/80 font-medium text-center pt-3 w-full transition-colors">
                    +{residents.length - 5} paciente{residents.length - 5 > 1 ? "s" : ""} — Ver todos
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Occurrences bar */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" style={{ color: BRAND.yellow }} />
                  Ocorrências por Tipo
                </CardTitle>
                <button onClick={() => navigate("/residents")} className="text-xs text-primary hover:text-primary/80 font-medium" data-testid="button-view-occurrences">
                  Ver <ArrowRight className="h-3 w-3 inline" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="pb-3">
              {occurrenceBarData.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center">
                  <p className="text-sm font-semibold text-foreground">Nenhuma ocorrência aberta</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Quando a equipe registrar ocorrências, elas aparecem aqui por tipo e gravidade.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={occurrenceBarData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="type" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="Baixa"  stackId="a" fill={BRAND.green}  radius={[0, 0, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="Média"  stackId="a" fill={BRAND.yellow} radius={[0, 0, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="Alta"   stackId="a" fill={BRAND.red}    radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Metrics summary */}
          <Card className="shadow-sm cursor-pointer hover:shadow-md transition-all group"
            style={{ background: "linear-gradient(135deg, #0A0F2C 0%, #0D1A40 100%)" }}
            data-testid="card-metrics-summary"
          >
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4" style={{ color: BRAND.cyan }} />
                <p className="text-sm font-semibold text-white">Visão Geral</p>
              </div>
              <div className="space-y-3">
                {[
                  { label: "Pacientes", val: `${stats.totalResidents} / ${stats.capacity}`, color: BRAND.blue, to: "/residents" },
                  { label: "Medicações", val: stats.activeMedications, color: BRAND.green, to: "/residents" },
                  { label: "Doses atrasadas", val: stats.overdueMedicationDoses, color: BRAND.red, to: "/prontuario" },
                  { label: "Plantões ativos", val: activeShifts.length, color: BRAND.cyan, to: "/escalas" },
                  { label: "Pendências de ponto", val: timeClockPendingTotal, color: timeClockPendingTotal > 0 ? BRAND.red : BRAND.green, to: "/ponto-eletronico" },
                  { label: "Ocorrências abertas", val: stats.pendingOccurrences, color: BRAND.yellow, to: "/residents" },
                  { label: "Mensalidades vencidas", val: stats.overdueFeesCount, color: BRAND.red, to: "/financeiro" },
                ].map((item) => (
                  <button key={item.label} onClick={() => navigate(item.to)}
                    className="flex items-center justify-between w-full hover:opacity-80 transition-opacity group/item"
                    data-testid={`metric-row-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{item.label}</p>
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-bold" style={{ color: item.color }}>{item.val}</p>
                      <ChevronRight className="h-3 w-3 opacity-0 group-hover/item:opacity-60 transition-opacity" style={{ color: item.color }} />
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Shifts row */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Plantões em Andamento
            </CardTitle>
            <button onClick={() => navigate("/escalas")} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors" data-testid="button-view-escalas">
              Gerenciar escalas <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {activeShifts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-foreground">Nenhum plantão ativo agora</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Se a operação já está rodando, confira se as escalas do mês foram criadas.</p>
              <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={() => navigate("/escalas")}>
                Gerenciar escalas
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {activeShifts.map((s: any) => {
                const start = new Date(s.startTime);
                const end = new Date(s.endTime);
                const sameDay = format(start, "ddMM") === format(end, "ddMM");
                return (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{s.staffName}</p>
                      {s.residentName && <p className="text-xs text-muted-foreground truncate">Cuidando: {s.residentName}</p>}
                      <p className="text-xs text-muted-foreground">
                        {sameDay
                          ? `${format(start, "dd/MM")} · ${format(start, "HH:mm")} — ${format(end, "HH:mm")}`
                          : `${format(start, "dd/MM HH:mm")} — ${format(end, "dd/MM HH:mm")}`}
                      </p>
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
