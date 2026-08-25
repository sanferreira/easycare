import { Link } from "wouter";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  LockKeyhole,
  Network,
  ShieldCheck,
  Stethoscope,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type FeaturePoint = {
  title: string;
  text: string;
};

type Metric = {
  value: string;
  label: string;
};

const navItems = [
  ["Produto", "#produto"],
  ["Soluções", "#solucoes"],
  ["Recursos", "#recursos"],
  ["Segurança", "#seguranca"],
  ["Empresa", "#empresa"],
];

const productTabs = ["Visão geral", "Pacientes", "Equipe", "Escalas", "Prontuário", "Financeiro"];

const metrics: Metric[] = [
  { value: "128", label: "pacientes acompanhados" },
  { value: "42", label: "profissionais ativos" },
  { value: "86", label: "atendimentos hoje" },
  { value: "12", label: "pendências abertas" },
];

const modules = [
  "Pacientes",
  "Equipe",
  "Escalas",
  "Prontuário",
  "Financeiro",
  "Documentos",
  "Relatórios",
  "Comunicação",
];

function PremiumLogo() {
  return (
    <Link href="/premium" className="inline-flex items-center" aria-label="EasyCare Premium">
      <img src="/brand/logo-easycare-light-header.png" alt="EasyCare" className="h-10 w-auto object-contain" />
    </Link>
  );
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p className={`text-xs font-bold uppercase tracking-normal ${dark ? "text-[#6EE7F9]" : "text-[#0B5CAB]"}`}>
      {children}
    </p>
  );
}

function DashboardComposition() {
  return (
    <div className="relative min-h-[520px] overflow-visible">
      <div className="absolute -right-10 top-4 h-[470px] w-[470px] rounded-[46%] bg-[linear-gradient(135deg,rgba(34,211,238,0.42),rgba(31,111,235,0.36),rgba(124,58,237,0.34))] blur-2xl" />
      <div className="absolute right-0 top-10 w-[620px] max-w-[110vw] rotate-[-2deg] rounded-md border border-white/60 bg-white/90 p-4 shadow-[0_34px_90px_rgba(5,32,60,0.18)] backdrop-blur">
        <div className="grid min-h-[360px] grid-cols-[150px_1fr] overflow-hidden rounded-md border border-[#D8E7F5]">
          <aside className="bg-[#05203C] p-4 text-white">
            <div className="mb-7 flex items-center gap-2">
              <span className="h-7 w-7 rounded-md bg-[#1F6FEB]" />
              <span className="text-sm font-bold">EasyCare</span>
            </div>
            {["Dashboard", "Pacientes", "Escalas", "Equipe", "Financeiro"].map((item, index) => (
              <div key={item} className={`mb-2 rounded-md px-3 py-2 text-xs font-semibold ${index === 0 ? "bg-white text-[#05203C]" : "text-white/62"}`}>
                {item}
              </div>
            ))}
          </aside>
          <div className="bg-[#F7FBFC] p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-[#0B5CAB]">Operação</p>
                <h3 className="mt-1 text-2xl font-bold tracking-normal text-[#05203C]">Visão do dia</h3>
              </div>
              <span className="rounded-md bg-[#DFF8FB] px-3 py-1 text-xs font-bold text-[#0B5CAB]">ao vivo</span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                ["128", "Pacientes"],
                ["42", "Equipe"],
                ["86", "Atendimentos"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-md border border-[#D8E7F5] bg-white p-4">
                  <p className="text-2xl font-bold text-[#05203C]">{value}</p>
                  <p className="mt-1 text-xs font-semibold text-[#66748A]">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-[1fr_170px] gap-4">
              <div className="rounded-md border border-[#D8E7F5] bg-white p-4">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-bold text-[#05203C]">Agenda</p>
                  <p className="text-xs font-semibold text-[#66748A]">Hoje</p>
                </div>
                {[
                  ["08:00", "Medicação registrada", "Azul"],
                  ["10:30", "Evolução adicionada", "Verde"],
                  ["14:00", "Troca de profissional", "Roxo"],
                ].map(([time, title, color]) => (
                  <div key={title} className="mb-3 grid grid-cols-[46px_1fr] gap-3">
                    <span className="text-xs font-bold text-[#0B5CAB]">{time}</span>
                    <div>
                      <p className="text-sm font-bold text-[#05203C]">{title}</p>
                      <p className="text-xs text-[#66748A]">{color} Residencial</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-[#D8E7F5] bg-white p-4">
                <p className="text-sm font-bold text-[#05203C]">Financeiro</p>
                <div className="mt-5 h-24 rounded-md bg-[linear-gradient(180deg,rgba(34,211,238,0.25),rgba(31,111,235,0.08))]">
                  <div className="flex h-full items-end gap-2 px-3 pb-3">
                    {[34, 58, 44, 76, 64, 88].map((height, index) => (
                      <span key={index} className="w-full rounded-sm bg-[#0B5CAB]" style={{ height: `${height}%` }} />
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-xs font-semibold text-[#66748A]">Mensalidades e contas em uma tela.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute left-4 top-72 w-60 rounded-md border border-[#D8E7F5] bg-white p-4 shadow-[0_20px_50px_rgba(5,32,60,0.12)]">
        <p className="text-xs font-bold uppercase text-[#0B5CAB]">Notificação</p>
        <p className="mt-2 text-sm font-bold text-[#05203C]">Escala ajustada</p>
        <p className="mt-1 text-xs leading-5 text-[#66748A]">Plantão atualizado sem conflito de horário.</p>
      </div>
    </div>
  );
}

function ProductViewport() {
  return (
    <div className="relative">
      <div className="absolute -left-16 top-16 h-72 w-72 rounded-[46%] bg-[#22D3EE]/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-md border border-[#D8E7F5] bg-white shadow-[0_28px_80px_rgba(5,32,60,0.12)]">
        <div className="flex items-center justify-between border-b border-[#D8E7F5] bg-[#F7FBFC] px-5 py-4">
          <div className="flex gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#22C55E]" />
          </div>
          <span className="text-xs font-bold uppercase text-[#66748A]">EasyCare / Operação</span>
        </div>
        <div className="grid min-h-[430px] gap-0 lg:grid-cols-[220px_1fr]">
          <div className="hidden bg-[#05203C] p-5 text-white lg:block">
            {["Visão geral", "Pacientes", "Equipe", "Escalas", "Prontuário", "Financeiro"].map((item, index) => (
              <div key={item} className={`mb-2 rounded-md px-3 py-2 text-sm font-semibold ${index === 0 ? "bg-[#1F6FEB]" : "text-white/58"}`}>
                {item}
              </div>
            ))}
          </div>
          <div className="bg-[#F7FBFC] p-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div>
                <h3 className="text-2xl font-bold tracking-normal text-[#05203C]">Rotina conectada</h3>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Pacientes ativos", "128"],
                    ["Profissionais", "42"],
                    ["Atendimentos hoje", "86"],
                    ["Pendências", "12"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-[#D8E7F5] bg-white p-4">
                      <p className="text-2xl font-bold text-[#05203C]">{value}</p>
                      <p className="mt-1 text-xs font-semibold text-[#66748A]">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-md border border-[#D8E7F5] bg-white p-4">
                  <p className="text-sm font-bold text-[#05203C]">Fluxo de atendimento</p>
                  <div className="mt-5 grid gap-3">
                    {["Cadastro atualizado", "Profissional vinculado", "Escala confirmada", "Registro no prontuário"].map((item, index) => (
                      <div key={item} className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#EAF5FF] text-xs font-bold text-[#0B5CAB]">{index + 1}</span>
                        <span className="text-sm font-semibold text-[#3A465C]">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-[#D8E7F5] bg-white p-4">
                <p className="text-sm font-bold text-[#05203C]">Escala semanal</p>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {Array.from({ length: 20 }).map((_, index) => (
                    <span key={index} className={`h-8 rounded-sm ${index % 5 === 0 ? "bg-[#1F6FEB]" : index % 3 === 0 ? "bg-[#22D3EE]" : "bg-[#E5EDF5]"}`} />
                  ))}
                </div>
                <div className="mt-6 space-y-3">
                  {["Troca de profissional", "Disponibilidade", "Turnos", "Conflitos"].map((item) => (
                    <div key={item} className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-[#66748A]">{item}</span>
                      <span className="h-px flex-1 bg-[#D8E7F5]" />
                      <CheckCircle2 className="h-4 w-4 text-[#22C55E]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureText({ eyebrow, title, text, points }: { eyebrow: string; title: string; text: string; points?: FeaturePoint[] }) {
  return (
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-normal text-[#05203C] lg:text-5xl">{title}</h2>
      <p className="mt-5 max-w-xl text-lg leading-8 text-[#53657A]">{text}</p>
      {points ? (
        <div className="mt-8 space-y-5">
          {points.map((point) => (
            <div key={point.title} className="grid gap-1 border-l border-[#BDE3F6] pl-4">
              <p className="text-sm font-bold text-[#05203C]">{point.title}</p>
              <p className="text-sm leading-6 text-[#66748A]">{point.text}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PatientInterface() {
  return (
    <div className="relative overflow-visible">
      <div className="absolute -right-8 top-6 h-48 w-48 rounded-[42%] bg-[#7C3AED]/15 blur-2xl" />
      <div className="relative rounded-md border border-[#D8E7F5] bg-white p-5 shadow-[0_24px_70px_rgba(5,32,60,0.10)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-[#0B5CAB]">Paciente</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-normal text-[#05203C]">Maria Helena</h3>
          </div>
          <span className="rounded-md bg-[#EAF5FF] px-3 py-1 text-xs font-bold text-[#0B5CAB]">Ativo</span>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_170px]">
          <div className="space-y-3">
            {["Dados pessoais", "Contatos familiares", "Documentos", "Histórico de atendimentos"].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-md bg-[#F7FBFC] px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-[#22D3EE]" />
                <span className="text-sm font-semibold text-[#3A465C]">{item}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md bg-[#05203C] p-4 text-white">
            <p className="text-xs font-bold uppercase text-[#6EE7F9]">Contexto</p>
            <p className="mt-4 text-sm leading-6 text-white/72">Informações importantes sempre próximas do atendimento.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineInterface() {
  return (
    <div className="rounded-md border border-[#D8E7F5] bg-white p-5 shadow-[0_24px_70px_rgba(5,32,60,0.10)]">
      <p className="text-sm font-bold text-[#05203C]">Linha do tempo</p>
      <div className="mt-5 space-y-5">
        {[
          ["08:14", "Observação registrada", "Paciente apresentou boa alimentação."],
          ["10:20", "Medicação administrada", "Dose confirmada pela equipe."],
          ["14:35", "Anexo adicionado", "Documento anexado ao prontuário."],
        ].map(([time, title, text]) => (
          <div key={title} className="grid grid-cols-[54px_1fr] gap-4">
            <span className="text-xs font-bold text-[#0B5CAB]">{time}</span>
            <div className="border-l border-[#BDE3F6] pl-4">
              <p className="text-sm font-bold text-[#05203C]">{title}</p>
              <p className="mt-1 text-sm leading-6 text-[#66748A]">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricsComposition() {
  return (
    <div className="relative grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
      <div>
        <Eyebrow>Operação em tempo real</Eyebrow>
        <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-normal text-[#05203C] lg:text-5xl">
          Entenda sua operação enquanto ela acontece.
        </h2>
        <p className="mt-5 max-w-lg text-lg leading-8 text-[#53657A]">
          Dashboards e indicadores ajudam sua equipe a identificar rapidamente o que precisa de atenção.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="border-t border-[#BDE3F6] pt-5">
            <p className="text-4xl font-semibold text-[#05203C]">{metric.value}</p>
            <p className="mt-2 text-sm font-semibold text-[#66748A]">{metric.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinanceInterface() {
  return (
    <div className="rounded-md border border-[#D8E7F5] bg-white p-5 shadow-[0_22px_70px_rgba(5,32,60,0.10)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-[#05203C]">Financeiro</p>
        <span className="text-xs font-bold text-[#0B5CAB]">Mensal</span>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {[
          ["Receitas", "R$ 82k"],
          ["Despesas", "R$ 31k"],
          ["Em aberto", "R$ 9k"],
        ].map(([label, value]) => (
          <div key={label} className="border-l border-[#BDE3F6] pl-4">
            <p className="text-xl font-semibold text-[#05203C]">{value}</p>
            <p className="mt-1 text-xs font-bold uppercase text-[#66748A]">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-7 h-40 rounded-md bg-[#F7FBFC] p-4">
        <div className="flex h-full items-end gap-3">
          {[38, 66, 44, 72, 58, 84, 70, 91].map((height, index) => (
            <span key={index} className="w-full rounded-sm bg-[linear-gradient(180deg,#22D3EE,#1F6FEB)]" style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AutomationFlow() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <h2 className="max-w-2xl text-4xl font-semibold leading-tight tracking-normal text-[#05203C] lg:text-5xl">
        Menos tarefas repetitivas. Mais tempo para cuidar.
      </h2>
      <div className="mt-10 grid gap-4 lg:grid-cols-5">
        {["Novo paciente cadastrado", "Profissional vinculado", "Escala criada", "Atendimento realizado", "Registro atualizado"].map((item, index) => (
          <div key={item} className="relative">
            <div className="rounded-md border border-[#D8E7F5] bg-white p-4 shadow-sm">
              <span className="text-xs font-bold text-[#0B5CAB]">0{index + 1}</span>
              <p className="mt-3 text-sm font-bold leading-6 text-[#05203C]">{item}</p>
            </div>
            {index < 4 ? <ChevronRight className="absolute -right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-[#0B5CAB] lg:block" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SecuritySection() {
  const items = ["Controle de acesso", "Permissões por usuário", "Registro de atividades", "Proteção de informações", "Boas práticas alinhadas à LGPD"];
  return (
    <div id="seguranca" className="relative overflow-hidden bg-[#06162D] px-5 py-24 text-white sm:px-8 lg:py-32">
      <div className="absolute inset-x-0 -top-24 h-64 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(255,255,255,0))]" />
      <div className="absolute -right-20 top-24 h-80 w-80 rounded-[45%] bg-[#22D3EE]/20 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <Eyebrow dark>Segurança</Eyebrow>
          <h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-normal text-white lg:text-5xl">
            Informações sensíveis merecem proteção séria.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-white/68">
            O EasyCare foi desenvolvido considerando boas práticas de segurança, privacidade e proteção de dados.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item} className="border-l border-[#6EE7F9]/35 pl-4">
              <ShieldCheck className="mb-3 h-5 w-5 text-[#6EE7F9]" />
              <p className="text-sm font-bold text-white">{item}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IntegrationMap() {
  return (
    <div className="relative mx-auto max-w-5xl text-center">
      <div className="absolute inset-0 rounded-[45%] bg-[radial-gradient(circle,rgba(34,211,238,0.25),rgba(124,58,237,0.12),transparent_62%)] blur-2xl" />
      <div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-md border border-[#BDE3F6] bg-white shadow-[0_24px_70px_rgba(5,32,60,0.10)]">
        <Network className="h-8 w-8 text-[#0B5CAB]" />
        <span className="ml-2 text-lg font-bold text-[#05203C]">EasyCare</span>
      </div>
      <div className="relative mt-10 grid gap-4 sm:grid-cols-4">
        {modules.map((module) => (
          <div key={module} className="border-t border-[#BDE3F6] pt-4 text-sm font-bold text-[#3A465C]">
            {module}
          </div>
        ))}
      </div>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <p className="text-sm font-bold text-[#05203C]">{title}</p>
      <div className="mt-4 grid gap-3">
        {links.map((link) => (
          <a key={link} href="#produto" className="text-sm font-medium text-[#66748A] hover:text-[#0B5CAB]">
            {link}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function PremiumLandingPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-white text-[#05203C]">
      <style>{`
        @keyframes premiumFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .premium-float {
          animation: premiumFloat 8s ease-in-out infinite;
        }
      `}</style>

      <header className="fixed inset-x-0 top-0 z-50 bg-white/78 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <PremiumLogo />
          <nav className="hidden items-center gap-2 lg:flex">
            {navItems.map(([label, href]) => (
              <a key={label} href={href} className="rounded-md px-3 py-2 text-sm font-bold text-[#30465F] hover:bg-[#EAF5FF] hover:text-[#0B5CAB]">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="hidden h-10 rounded-md border-[#B8CBE0] text-[#05203C] sm:inline-flex">
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild className="hidden h-10 rounded-md bg-[#0B5CAB] px-4 text-white hover:bg-[#084B8A] sm:inline-flex">
              <a href="#contato">Conhecer</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative min-h-screen px-5 pb-20 pt-32 sm:px-8 lg:pt-40">
          <img src="/landing/easycare-hero.png" alt="" className="absolute right-0 top-20 hidden h-[640px] w-[54vw] object-cover opacity-20 lg:block" />
          <div className="absolute -right-40 top-24 h-[720px] w-[720px] rounded-[46%] bg-[linear-gradient(135deg,rgba(34,211,238,0.35),rgba(31,111,235,0.26),rgba(124,58,237,0.30))] blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <Eyebrow>Gestão de cuidados em uma única plataforma</Eyebrow>
              <h1 className="mt-6 max-w-[21rem] text-4xl font-semibold leading-[1.04] tracking-normal text-[#05203C] sm:max-w-3xl sm:text-6xl lg:text-7xl">
                <span className="block">Tecnologia para</span>
                <span className="block bg-[linear-gradient(135deg,#1F6FEB,#22D3EE,#7C3AED)] bg-clip-text text-transparent">cuidar melhor</span>
                <span className="block">de quem importa.</span>
              </h1>
              <p className="mt-7 max-w-[21rem] text-base leading-7 text-[#53657A] sm:max-w-2xl sm:text-lg sm:leading-8">
                Centralize pacientes, cuidadores, escalas, prontuários, financeiro e toda a operação da sua empresa em uma única plataforma.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 rounded-md bg-[#0B5CAB] px-6 text-white hover:bg-[#084B8A]">
                  <a href="#contato">
                    Conhecer o EasyCare
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="outline" className="h-12 rounded-md border-[#B8CBE0] px-6 text-[#05203C]">
                  <a href="#produto">Ver como funciona</a>
                </Button>
              </div>
            </div>
            <div className="premium-float">
              <DashboardComposition />
            </div>
          </div>
        </section>

        <section id="produto" className="relative px-5 py-16 sm:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-12 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
              <div>
                <Eyebrow>Uma operação mais simples</Eyebrow>
                <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-normal text-[#05203C] lg:text-5xl">
                  Tudo conectado. Tudo sob controle.
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-8 text-[#53657A]">
                  O EasyCare reúne as principais áreas da operação em um único ambiente, sem depender de dezenas de sistemas diferentes.
                </p>
              </div>
              <div className="flex gap-5 overflow-x-auto border-b border-[#BDE3F6] pb-3">
                {productTabs.map((tab, index) => (
                  <a key={tab} href="#solucoes" className={`shrink-0 text-sm font-bold ${index === 0 ? "text-[#0B5CAB]" : "text-[#66748A]"}`}>
                    {tab}
                  </a>
                ))}
              </div>
            </div>
            <div className="mt-12">
              <ProductViewport />
            </div>
          </div>
        </section>

        <section id="solucoes" className="px-5 py-16 sm:px-8 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <FeatureText
              eyebrow="Pacientes"
              title="Toda a jornada do paciente em um único lugar."
              text="Centralize dados pessoais, contatos, histórico de atendimentos, documentos e informações importantes para que sua equipe tenha sempre o contexto necessário."
            />
            <PatientInterface />
          </div>
        </section>

        <section className="px-5 py-16 sm:px-8 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="order-2 lg:order-1">
              <ProductViewport />
            </div>
            <div className="order-1 lg:order-2">
              <FeatureText
                eyebrow="Gestão de equipe"
                title="As pessoas certas, no lugar certo, na hora certa."
                text="Organize cuidadores e colaboradores, acompanhe disponibilidade, documentos, jornadas e informações essenciais para sua operação."
                points={[
                  { title: "Perfis completos", text: "Dados e documentos centralizados." },
                  { title: "Disponibilidade", text: "Visualize facilmente quem está disponível." },
                  { title: "Organização", text: "Menos planilhas e menos processos manuais." },
                ]}
              />
            </div>
          </div>
        </section>

        <section id="recursos" className="px-5 py-16 sm:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
              <FeatureText
                eyebrow="Escalas"
                title="Montar escalas não precisa ser complicado."
                text="Visualize profissionais, pacientes e horários em uma agenda clara e organizada."
              />
              <ProductViewport />
            </div>
          </div>
        </section>

        <section className="px-5 py-16 sm:px-8 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <FeatureText
              eyebrow="Prontuário digital"
              title="Informação organizada para um cuidado mais humano."
              text="Registre acompanhamentos, observações, evoluções e informações importantes de cada atendimento."
            />
            <TimelineInterface />
          </div>
        </section>

        <section className="px-5 py-16 sm:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <MetricsComposition />
          </div>
        </section>

        <section className="px-5 py-16 sm:px-8 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <FeatureText
              eyebrow="Gestão financeira"
              title="Mais clareza sobre cada movimentação."
              text="Acompanhe cobranças, pagamentos, taxas e movimentações financeiras diretamente dentro da plataforma."
            />
            <FinanceInterface />
          </div>
        </section>

        <section className="px-5 py-16 sm:px-8 lg:py-28">
          <AutomationFlow />
        </section>

        <SecuritySection />

        <section className="px-5 py-20 sm:px-8 lg:py-32">
          <IntegrationMap />
        </section>

        <section id="contato" className="relative px-5 py-20 sm:px-8 lg:py-32">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(34,211,238,0.22),transparent_35%),radial-gradient(circle_at_30%_80%,rgba(124,58,237,0.18),transparent_38%)]" />
          <div className="relative mx-auto max-w-5xl text-center">
            <h2 className="mx-auto max-w-3xl text-5xl font-semibold leading-tight tracking-normal text-[#05203C] lg:text-6xl">
              Sua operação pode ser mais simples.
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#53657A]">
              Descubra como o EasyCare pode ajudar sua empresa a organizar processos, reduzir tarefas manuais e oferecer uma experiência melhor para pacientes, profissionais e gestores.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild className="h-12 rounded-md bg-[#0B5CAB] px-6 text-white hover:bg-[#084B8A]">
                <a href="mailto:comercial@easycare.com.br">Conhecer o EasyCare</a>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-md border-[#B8CBE0] px-6 text-[#05203C]">
                <a href="mailto:comercial@easycare.com.br">Falar com nossa equipe</a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer id="empresa" className="border-t border-[#D8E7F5] bg-[#F7FBFC] px-5 py-12 sm:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <PremiumLogo />
            <p className="mt-5 max-w-sm text-sm leading-6 text-[#66748A]">EasyCare — Gestão inteligente, cuidado humano.</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-5">
            <FooterColumn title="Produto" links={["Visão geral", "Pacientes", "Equipe"]} />
            <FooterColumn title="Recursos" links={["Escalas", "Prontuário", "Financeiro"]} />
            <FooterColumn title="Empresa" links={["Sobre nós", "Contato"]} />
            <FooterColumn title="Suporte" links={["Ajuda", "Status"]} />
            <FooterColumn title="Legal" links={["Termos de uso", "Privacidade", "LGPD"]} />
          </div>
        </div>
      </footer>
    </div>
  );
}
