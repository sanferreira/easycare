import { Link } from "wouter";
import {
  ArrowRight,
  BarChart3,
  BedDouble,
  Building2,
  Calculator,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  CreditCard,
  FileText,
  HeartHandshake,
  Home,
  LockKeyhole,
  MessageCircle,
  Pill,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSupportWhatsappUrl, supportWhatsappDisplay } from "@/lib/contact";

const supportWhatsappUrl = buildSupportWhatsappUrl("Olá! Quero conhecer o EasyCare e começar meu teste grátis.");

type CardItem = {
  title: string;
  text: string;
  icon: LucideIcon;
};

const navItems = [
  ["Soluções", "#solucoes"],
  ["Plataforma", "#plataforma"],
  ["Acessos", "#acessos"],
  ["Segmentos", "#segmentos"],
  ["Plano", "#plano"],
  ["Pagamento", "#pagamento"],
  ["FAQ", "#faq"],
];

const proofItems = [
  { label: "Prontuário, medicação e ocorrências", value: "Paciente" },
  { label: "Escalas, ponto eletrônico e permissões", value: "Equipe" },
  { label: "DRE, contratos e calculadora automática", value: "Gestor" },
  { label: "Portal com informações compartilhadas", value: "Família" },
];

const solutionCards: CardItem[] = [
  {
    title: "Prontuário sem bagunça",
    text: "Evoluções, sinais vitais, documentos e ocorrências ficam no histórico do paciente.",
    icon: FileText,
  },
  {
    title: "Medicação no horário",
    text: "Acompanhe prescrições, doses previstas, atrasos e registros de administração.",
    icon: Pill,
  },
  {
    title: "Equipe e escala",
    text: "Monte plantões, acompanhe cuidadores, cargos e acesso de cada perfil.",
    icon: CalendarClock,
  },
  {
    title: "Ponto eletrônico",
    text: "Equipe registra entrada, pausas e saída; o gestor revisa pendências, ajustes e espelho de ponto.",
    icon: Clock3,
  },
  {
    title: "Calculadora automática",
    text: "Contratos, escalas, custos da equipe e contas alimentam previsões de resultado sem planilha solta.",
    icon: Calculator,
  },
  {
    title: "Portal da família",
    text: "Responsáveis acompanham informações compartilhadas pela equipe com acesso próprio e seguro.",
    icon: HeartHandshake,
  },
];

const platformRows: CardItem[] = [
  {
    title: "Dados do paciente",
    text: "Cadastro, familiares, documentos e histórico assistencial.",
    icon: BedDouble,
  },
  {
    title: "Rotina da equipe",
    text: "Escalas, plantões, cargos e ocorrências do dia.",
    icon: Users,
  },
  {
    title: "Ponto e produtividade",
    text: "Batidas, ajustes, aprovações e fechamento mensal do ponto eletrônico.",
    icon: Clock3,
  },
  {
    title: "Gestão do negócio",
    text: "CRM, contratos, mensalidades, DRE e calculadora automática.",
    icon: BarChart3,
  },
];

const accessCards: CardItem[] = [
  {
    title: "Gestor",
    text: "Acompanha indicadores, financeiro, ponto eletrônico, permissões e pendências da operação.",
    icon: UserCog,
  },
  {
    title: "Equipe",
    text: "Registra rotina assistencial, medicações, ocorrências, escalas e marcações de ponto.",
    icon: Users,
  },
  {
    title: "Família",
    text: "Acessa o portal para ver dados compartilhados sobre o paciente, sem entrar na área interna.",
    icon: HeartHandshake,
  },
];

const segmentCards: CardItem[] = [
  {
    title: "ILPIs e casas de repouso",
    text: "Centralize a rotina assistencial, administrativa e financeira da instituição.",
    icon: Building2,
  },
  {
    title: "Home care",
    text: "Acompanhe atendimentos, cuidadores, registros e comunicação com responsáveis.",
    icon: Home,
  },
  {
    title: "Agências de cuidadores",
    text: "Controle equipe, oportunidades comerciais, plantões e prestação de contas.",
    icon: HeartHandshake,
  },
  {
    title: "Operações multiunidade",
    text: "Separe organizações, usuários, permissões e configurações de cada operação.",
    icon: Stethoscope,
  },
];

const paymentSteps = [
  "O cliente cadastra a própria instituição.",
  "A assinatura é ativada no checkout seguro da Stripe com 7 dias grátis.",
  "Quando a Stripe confirma o trial, o acesso da organização é liberado.",
];

const planFeatures = [
  "Pacientes, familiares e portal da família",
  "Prontuário, medicações e ocorrências",
  "Equipe, escalas e ponto eletrônico",
  "Financeiro, contratos e calculadora automática",
  "CRM, permissões e superadmin",
  "Auditoria de acessos e alterações importantes",
];

const faqs = [
  {
    question: "Meus dados e os dados dos pacientes ficam seguros?",
    answer: "Sim. O EasyCare trabalha com acesso por perfil, sessões protegidas e rotina de auditoria para registros importantes. Dados de pagamento ficam na Stripe; o EasyCare guarda apenas o status da assinatura.",
  },
  {
    question: "O EasyCare ajuda na LGPD?",
    answer: "Ajuda na organização e rastreabilidade: permissões por função, histórico de alterações e separação entre acesso da equipe, gestor e família. A adequação final depende também dos processos internos da instituição.",
  },
  {
    question: "O teste grátis cobra algo no começo?",
    answer: "Não. A instituição pode iniciar com 7 dias grátis. Depois do período gratuito, a cobrança segue o plano escolhido no checkout seguro da Stripe.",
  },
  {
    question: "Posso cancelar quando quiser?",
    answer: "Sim. No plano mensal, o cancelamento é livre. Nos planos semestral e anual, o acesso segue até o fim do período contratado, porque o pagamento é feito à vista com desconto.",
  },
  {
    question: "Tem suporte para implantação?",
    answer: "Sim. O cadastro é self-service, mas o suporte acompanha a ativação pelo WhatsApp para ajudar em plano, cobrança, equipe, pacientes, ponto eletrônico e portal da família.",
  },
  {
    question: "Todos os planos têm os mesmos recursos?",
    answer: "Sim. A diferença está no período contratado, na economia e no limite de pacientes. Mensal libera até 30 pacientes, semestral até 40 e anual até 60.",
  },
];

function EasyCareLogo() {
  return (
    <Link href="/" className="inline-flex items-center" aria-label="EasyCare">
      <img src="/brand/logo-easycare-light-header.png" alt="EasyCare" className="h-10 w-auto object-contain" />
    </Link>
  );
}

function TrialCtaPanel() {
  return (
    <div className="rounded-md border border-[#D8E7F5] bg-white p-5 shadow-sm sm:p-6">
      <div className="grid gap-4">
        {[
          ["1", "Cadastre a instituição e o administrador."],
          ["2", "Ative o trial na Stripe sem cobrança imediata."],
          ["3", "Entre no sistema e teste a rotina por 7 dias."],
        ].map(([step, text]) => (
          <div key={step} className="grid grid-cols-[40px_1fr] gap-3 rounded-md bg-[#F7FBFC] p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#0B5CAB] text-sm font-extrabold text-white">
              {step}
            </span>
            <p className="text-sm font-semibold leading-6 text-[#30465F]">{text}</p>
          </div>
        ))}
      </div>
      <Button asChild className="mt-5 h-12 w-full rounded-md bg-[#0B5CAB] text-white hover:bg-[#084B8A]">
        <Link href="/signup">
          Começar teste grátis
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
      <p className="mt-3 text-center text-xs leading-5 text-[#5F7085]">
        Suporte no WhatsApp: {supportWhatsappDisplay}
      </p>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  text?: string;
  centered?: boolean;
}) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className="text-sm font-extrabold uppercase tracking-normal text-[#0B5CAB]">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-normal text-[#05203C] sm:text-4xl">
        {title}
      </h2>
      {text ? <p className="mt-4 text-base leading-7 text-[#53657A]">{text}</p> : null}
    </div>
  );
}

function SolutionCard({ item }: { item: CardItem }) {
  return (
    <article className="group rounded-md border border-[#D8E7F5] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#0B5CAB]/45 hover:shadow-md">
      <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#EAF5FF] text-[#0B5CAB]">
        <item.icon className="h-5 w-5" />
      </div>
      <h3 className="mt-5 text-xl font-extrabold leading-7 tracking-normal text-[#05203C]">{item.title}</h3>
      <p className="mt-3 text-sm leading-6 text-[#53657A]">{item.text}</p>
      <Link href="/signup" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#0B5CAB]">
        Ver no sistema
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </Link>
    </article>
  );
}

function PlatformVisual() {
  return (
    <div className="rounded-md border border-[#D8E7F5] bg-white p-4 shadow-sm">
      <div className="rounded-md bg-[#F3F9FF] p-4">
        <div className="flex items-center justify-between border-b border-[#D8E7F5] pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#0B5CAB]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#24A148]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
          </div>
          <span className="text-xs font-bold uppercase text-[#5F7085]">EasyCare 360</span>
        </div>

        <div className="mt-5 grid gap-3">
          {platformRows.map((row) => (
            <div key={row.title} className="grid gap-3 rounded-md bg-white p-4 sm:grid-cols-[44px_1fr]">
              <span className="flex h-11 w-11 items-center justify-center rounded-md bg-[#EAF5FF] text-[#0B5CAB]">
                <row.icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-extrabold tracking-normal text-[#05203C]">{row.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[#53657A]">{row.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ["42", "pacientes"],
            ["12", "plantões hoje"],
            ["R$", "resultado previsto"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-md bg-[#05203C] p-4 text-white">
              <p className="text-2xl font-extrabold">{value}</p>
              <p className="mt-1 text-xs font-semibold text-white/70">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-[#05203C]">
      <header className="sticky top-0 z-50 border-b border-[#D8E7F5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <EasyCareLogo />

          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="rounded-md px-3 py-2 text-sm font-bold text-[#30465F] transition hover:bg-[#EAF5FF] hover:text-[#0B5CAB]"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="hidden h-10 rounded-md border-[#B8CBE0] text-[#05203C] sm:inline-flex">
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild className="hidden h-10 rounded-md bg-[#0B5CAB] px-4 text-white hover:bg-[#084B8A] sm:inline-flex">
              <Link href="/signup">Teste grátis</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden border-b border-[#D8E7F5] bg-white">
          <img
            src="/landing/easycare-hero.png"
            alt=""
            className="absolute inset-0 -z-10 hidden h-full w-full object-cover lg:block"
            style={{ objectPosition: "64% center" }}
          />
          <div className="absolute inset-0 -z-10 bg-white lg:hidden" />
          <div
            className="absolute inset-0 -z-10 hidden lg:block"
            style={{
              background:
                "linear-gradient(90deg, #ffffff 0%, rgba(255,255,255,0.98) 34%, rgba(255,255,255,0.78) 58%, rgba(255,255,255,0.08) 100%)",
            }}
          />
          <div className="mx-auto flex min-h-[540px] max-w-7xl items-center px-5 py-16 sm:px-8 lg:min-h-[610px]">
            <div className="w-full min-w-0 max-w-2xl">
              {/* <div className="mb-5 inline-flex rounded-md border border-[#BDE3F6] bg-white/85 px-3 py-2 text-sm font-extrabold text-[#0B5CAB]">
                ILPI, casa de repouso e home care
              </div> */}
              <h1 className="max-w-[20rem] break-words text-3xl font-extrabold leading-tight tracking-normal text-[#05203C] sm:max-w-2xl sm:text-5xl lg:text-6xl">
                Menos planilha. Mais controle da rotina.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-[#30465F]">
                Organize pacientes, prontuário, medicação, equipe, ponto eletrônico, escala e financeiro sem depender de papel, WhatsApp e planilhas soltas.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 w-full rounded-md bg-[#0B5CAB] px-6 text-white hover:bg-[#084B8A] sm:w-auto">
                  <Link href="/signup">
                    Começar teste grátis
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-12 w-full rounded-md border-[#B8CBE0] bg-white/80 px-6 text-[#05203C] sm:w-auto">
                  <a href={supportWhatsappUrl} target="_blank" rel="noreferrer">
                    Falar no WhatsApp
                    <MessageCircle className="h-4 w-4" />
                  </a>
                </Button>
              </div>
              <div className="mt-7 grid max-w-full gap-3 text-sm font-semibold text-[#53657A] sm:flex sm:flex-wrap">
                {["Sem instalação", "Acesso por perfil", "Pagamento integrado"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#24A148]" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#F7FBFC]">
          <div className="mx-auto grid max-w-7xl divide-y divide-[#D8E7F5] px-5 sm:px-8 md:grid-cols-4 md:divide-x md:divide-y-0">
            {proofItems.map((item) => (
              <div key={item.value} className="py-6 md:px-5">
                <p className="text-sm font-extrabold uppercase text-[#0B5CAB]">{item.value}</p>
                <p className="mt-2 text-base font-bold leading-6 text-[#05203C]">{item.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="solucoes" className="bg-white px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="Soluções"
              title="A rotina do atendimento em um só lugar."
              text="O EasyCare ajuda a tirar informações importantes de grupos, cadernos e planilhas, sem complicar o dia da equipe."
              centered
            />
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {solutionCards.map((item) => (
                <SolutionCard key={item.title} item={item} />
              ))}
            </div>
          </div>
        </section>

        <section id="plataforma" className="bg-[#F7FBFC] px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <SectionHeading
                eyebrow="Plataforma"
                title="O que estava desorganizado, passa ter organização e controle."
                text="Cada registro fica no módulo certo, com histórico, responsável e acesso conforme o perfil do usuário."
              />
              <div className="mt-7 space-y-4">
                {[
                  "Dashboard com pacientes, pendências e rotina do dia.",
                  "Ponto eletrônico com batida, ajuste, auditoria e fechamento.",
                  "Calculadora automática para mensalidades, custos e resultado previsto.",
                  "Permissões para gestor, equipe e família acessarem somente o necessário.",
                ].map((item) => (
                  <div key={item} className="flex gap-3 text-sm font-semibold leading-6 text-[#30465F]">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#24A148]" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <PlatformVisual />
          </div>
        </section>

        <section id="acessos" className="bg-white px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="Acessos"
              title="Cada perfil entra pelo caminho certo."
              text="Gestor, equipe e família não precisam ver a mesma coisa. O EasyCare separa o acesso por função para proteger dados e simplificar a rotina."
              centered
            />
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {accessCards.map((item) => (
                <article key={item.title} className="rounded-md border border-[#D8E7F5] bg-[#F7FBFC] p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-white text-[#0B5CAB]">
                    <item.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-5 text-2xl font-extrabold tracking-normal text-[#05203C]">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#53657A]">{item.text}</p>
                </article>
              ))}
            </div>
            <div className="mt-6 grid gap-4 rounded-md border border-[#D8E7F5] bg-white p-5 md:grid-cols-3">
              {[
                ["Gestor", "Administra indicadores, ponto, financeiro e permissões."],
                ["Equipe", "Registra cuidado, escala, ocorrências, medicação e ponto."],
                ["Família", "Acompanha somente o que a instituição compartilha no portal."],
              ].map(([profile, text]) => (
                <div key={profile} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#24A148]" />
                  <p className="text-sm font-semibold leading-6 text-[#30465F]">
                    <span className="text-[#05203C]">{profile}:</span> {text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="segmentos" className="bg-[#F7FBFC] px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="Segmentos"
              title="Para quem cuida e administra ao mesmo tempo."
              text="A plataforma atende operações que precisam registrar o cuidado sem perder o controle da equipe e do financeiro."
            />
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {segmentCards.map((segment) => (
                <article key={segment.title} className="rounded-md border border-[#D8E7F5] bg-white p-5">
                  <segment.icon className="h-7 w-7 text-[#0B5CAB]" />
                  <h3 className="mt-5 text-xl font-extrabold leading-7 tracking-normal text-[#05203C]">{segment.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#53657A]">{segment.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="plano" className="bg-white px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <SectionHeading
                eyebrow="Plano"
                title="Planos para cada tamanho de operação."
                text="Escolha mensal, semestral ou anual, todos com 7 dias grátis, acesso completo e ativação segura pela Stripe."
              />
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 rounded-md bg-[#0B5CAB] px-6 text-white hover:bg-[#084B8A]">
                  <Link href="/signup">
                    Ativar 7 dias grátis
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-12 rounded-md border-[#B8CBE0] px-6 text-[#05203C]">
                  <a href={supportWhatsappUrl} target="_blank" rel="noreferrer">Tirar dúvida no WhatsApp</a>
                </Button>
              </div>
            </div>
            <div className="rounded-md border border-[#D8E7F5] bg-[#F7FBFC] p-5 shadow-sm sm:p-6">
              <div className="rounded-md border border-[#CBE4FA] bg-white p-5">
                <p className="text-sm font-extrabold uppercase text-[#0B5CAB]">EasyCare assinatura</p>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <h3 className="text-4xl font-extrabold tracking-normal text-[#05203C]">7 dias grátis</h3>
                  <span className="mb-1 rounded-md bg-[#EAF5FF] px-2 py-1 text-xs font-bold text-[#0B5CAB]">
                    valor no checkout
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[#53657A]">
                  Mensal para até 30 pacientes, semestral para até 40 e anual para até 60. Os valores aparecem no checkout seguro antes da confirmação.
                </p>
                <div className="mt-5 grid gap-2">
                  {planFeatures.map((feature) => (
                    <span key={feature} className="flex items-center gap-2 text-sm font-semibold text-[#30465F]">
                      <CheckCircle2 className="h-4 w-4 text-[#24A148]" />
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="pagamento" className="easycare-brand-panel px-5 py-16 text-white sm:px-8 lg:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-sm font-extrabold uppercase text-[#86D7FF]">Pagamento e acesso</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-normal text-white sm:text-4xl">
                O acesso acompanha a assinatura.
              </h2>
              <p className="mt-4 text-base leading-7 text-white/72">
                Cliente em dia entra no sistema. Assinatura pendente fica limitada à cobrança até regularizar.
              </p>
              <Button asChild className="mt-7 h-12 rounded-md bg-white px-6 text-[#05203C] hover:bg-[#EAF5FF]">
                <Link href="/signup">
                  Começar 7 dias grátis
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="grid gap-4">
              {paymentSteps.map((step, index) => (
                <div key={step} className="grid gap-4 rounded-md border border-white/15 bg-white/[0.06] p-5 sm:grid-cols-[52px_1fr]">
                  <span className="flex h-12 w-12 items-center justify-center rounded-md bg-[#86D7FF] text-lg font-extrabold text-[#05203C]">
                    {index + 1}
                  </span>
                  <p className="text-base font-semibold leading-7 text-white/85">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div className="order-2 lg:order-1">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { title: "Prontuário", icon: ClipboardCheck, color: "#0B5CAB" },
                  { title: "Ponto eletrônico", icon: Clock3, color: "#0F766E" },
                  { title: "Medicações", icon: Pill, color: "#24A148" },
                  { title: "Calculadora", icon: Calculator, color: "#F59E0B" },
                  { title: "Financeiro", icon: CreditCard, color: "#7C3AED" },
                  { title: "Segurança", icon: ShieldCheck, color: "#334155" },
                ].map((item) => (
                  <div key={item.title} className="rounded-md border border-[#D8E7F5] bg-[#F7FBFC] p-5">
                    <span className="flex h-11 w-11 items-center justify-center rounded-md bg-white" style={{ color: item.color }}>
                      <item.icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 text-lg font-extrabold tracking-normal text-[#05203C]">{item.title}</h3>
                    <div className="mt-4 h-2 rounded-full bg-white">
                      <div className="h-full rounded-full" style={{ width: item.title === "Financeiro" ? "62%" : "78%", backgroundColor: item.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <SectionHeading
                eyebrow="No dia a dia"
                title="Menos procura. Mais registro certo."
                text="O sistema foi pensado para a rotina real: consultar informação rápido, registrar o que aconteceu e manter a gestão acompanhando sem depender de mensagens soltas."
              />
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 rounded-md bg-[#0B5CAB] px-6 text-white hover:bg-[#084B8A]">
                  <Link href="/signup">Começar teste grátis</Link>
                </Button>
                <Button asChild variant="outline" className="h-12 rounded-md border-[#B8CBE0] px-6 text-[#05203C]">
                  <Link href="/login">Já sou cliente</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section id="teste" className="bg-[#EAF5FF] px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-sm font-extrabold uppercase text-[#0B5CAB]">Teste grátis</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-normal text-[#05203C] sm:text-4xl">
                Comece com sua própria instituição.
              </h2>
              <p className="mt-4 text-base leading-7 text-[#30465F]">
                O cadastro é self-service. Você cria a instituição, ativa o trial de 7 dias pela Stripe e já entra para testar o sistema.
              </p>
              <div className="mt-7 grid gap-3 text-sm font-semibold text-[#30465F]">
                {["7 dias grátis", "Checkout seguro pela Stripe", "Suporte pelo WhatsApp na implantação"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#24A148]" />
                    {item}
                  </span>
                ))}
              </div>
              <a
                href={supportWhatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#0B5CAB]"
              >
                <MessageCircle className="h-4 w-4" />
                Suporte: {supportWhatsappDisplay}
              </a>
            </div>
            <TrialCtaPanel />
          </div>
        </section>

        <section id="faq" className="bg-white px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto max-w-4xl">
            <SectionHeading eyebrow="FAQ" title="Perguntas frequentes" centered />
            <div className="mt-10 divide-y divide-[#D8E7F5] rounded-md border border-[#D8E7F5] bg-white">
              {faqs.map((item) => (
                <details key={item.question} className="group p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-extrabold text-[#05203C]">
                    {item.question}
                    <ChevronDown className="h-5 w-5 shrink-0 text-[#5F7085] transition group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-[#53657A]">{item.answer}</p>
                </details>
              ))}
            </div>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 rounded-md border border-[#D8E7F5] bg-[#F7FBFC] p-5 text-center sm:flex-row sm:justify-between sm:text-left">
              <div>
                <p className="text-base font-extrabold text-[#05203C]">Ficou alguma dúvida antes de cadastrar?</p>
                <p className="mt-1 text-sm leading-6 text-[#53657A]">Fale direto com o suporte ou comece o teste grátis pelo cadastro self-service.</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button asChild className="h-11 rounded-md bg-[#0B5CAB] px-5 text-white hover:bg-[#084B8A]">
                  <Link href="/signup">Começar teste grátis</Link>
                </Button>
                <Button asChild variant="outline" className="h-11 rounded-md border-[#B8CBE0] px-5 text-[#05203C]">
                  <a href={supportWhatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a>
                </Button>
              </div>
            </div>
          </div>
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
                <Link href="/signup">Começar teste grátis</Link>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-md border-[#B8CBE0] px-6 text-[#05203C]">
                <a href={supportWhatsappUrl} target="_blank" rel="noreferrer">Falar no WhatsApp</a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#D8E7F5] bg-[#F7FBFC] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <EasyCareLogo />
            <p className="mt-3 text-sm text-[#53657A]">Sistema para rotina, cuidado e gestão.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm font-semibold text-[#30465F]">
            <Link href="/login" className="inline-flex items-center gap-2 hover:text-[#0B5CAB]">
              <LockKeyhole className="h-4 w-4" />
              Entrar
            </Link>
            <Link href="/termos" className="inline-flex items-center gap-2 hover:text-[#0B5CAB]">
              Termos
            </Link>
            <Link href="/privacidade" className="inline-flex items-center gap-2 hover:text-[#0B5CAB]">
              Privacidade
            </Link>
            <a href={supportWhatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-[#0B5CAB]">
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
