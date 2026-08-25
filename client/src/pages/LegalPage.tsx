import { Link } from "wouter";
import { ArrowLeft, FileText, LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

type LegalSection = {
  title: string;
  items: string[];
};

const termsSections: LegalSection[] = [
  {
    title: "Uso do sistema",
    items: [
      "O EasyCare é uma plataforma web para gestão operacional, assistencial e financeira de instituições de cuidado.",
      "A instituição contratante é responsável pela veracidade dos dados cadastrados e pela autorização dos usuários que acessam o sistema.",
      "O sistema apoia registros, organização e acompanhamento. Ele não substitui avaliação profissional, prescrição médica ou decisão assistencial.",
    ],
  },
  {
    title: "Contas, acesso e permissões",
    items: [
      "Cada usuário deve usar credenciais próprias e manter sua senha em sigilo.",
      "O gestor da instituição controla perfis, permissões e acessos de equipe e familiares.",
      "A EasyCare pode restringir o acesso em caso de inadimplência, uso indevido, risco de segurança ou violação destes termos.",
    ],
  },
  {
    title: "Assinatura e pagamento",
    items: [
      "O cadastro self-service pode iniciar com período gratuito, quando disponível no checkout.",
      "Pagamentos, dados de cartão, cancelamentos e gestão da assinatura são processados pela Stripe.",
      "Após falha ou pendência de pagamento, a organização pode ficar limitada à tela de regularização até confirmação da Stripe.",
    ],
  },
  {
    title: "Responsabilidades",
    items: [
      "A instituição deve manter respaldo legal para tratar dados de pacientes, familiares e colaboradores.",
      "A EasyCare mantém controles técnicos de acesso, auditoria e organização dos dados, mas a operação diária continua sob responsabilidade da instituição.",
      "Dúvidas comerciais ou operacionais podem ser tratadas pelo canal de suporte informado no sistema.",
    ],
  },
];

const privacySections: LegalSection[] = [
  {
    title: "Dados tratados",
    items: [
      "Podemos tratar dados cadastrais da instituição, usuários, equipe, pacientes, familiares, contratos, ponto eletrônico, registros clínicos e logs de uso.",
      "Alguns dados podem ser sensíveis, como informações de saúde do paciente. Esses dados devem ser inseridos apenas por usuários autorizados.",
      "Dados de pagamento são tratados pela Stripe. A EasyCare não armazena número completo de cartão.",
    ],
  },
  {
    title: "Finalidades",
    items: [
      "Usamos os dados para autenticação, operação do sistema, controle de permissões, geração de relatórios, cobrança, suporte e segurança.",
      "Logs de auditoria registram eventos relevantes, como acessos, alterações de cadastros e convites ao portal da família.",
      "Contatos como e-mail e WhatsApp podem ser usados para suporte, implantação, cobrança e avisos importantes sobre o serviço.",
    ],
  },
  {
    title: "Compartilhamento",
    items: [
      "Dados podem ser compartilhados com provedores necessários à operação, como hospedagem, banco de dados, Stripe e ferramentas de comunicação.",
      "A instituição controla quais familiares recebem acesso ao portal e quais informações são compartilhadas.",
      "Não vendemos dados pessoais.",
    ],
  },
  {
    title: "Segurança e direitos",
    items: [
      "Aplicamos controles de autenticação, permissões, segregação por organização e trilhas de auditoria.",
      "A instituição pode solicitar correção, exportação ou exclusão de dados, respeitando obrigações legais e operacionais aplicáveis.",
      "Incidentes ou solicitações relacionadas a dados devem ser encaminhados ao suporte oficial da EasyCare.",
    ],
  },
];

function LegalLayout({
  title,
  subtitle,
  type,
  sections,
}: {
  title: string;
  subtitle: string;
  type: "terms" | "privacy";
  sections: LegalSection[];
}) {
  const Icon = type === "terms" ? FileText : ShieldCheck;

  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-[#F7FBFC] text-[#05203C]"
      style={{ background: "linear-gradient(180deg, #F7FBFC 0%, #FFFFFF 54%, #EAF5FF 100%)" }}
    >
      <header className="border-b border-[#D8E7F5] bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center" aria-label="EasyCare">
            <img src="/brand/logo-easycare-light-header.png" alt="EasyCare" className="h-10 w-auto object-contain" />
          </Link>
          <Button asChild variant="outline" className="h-10 rounded-md border-[#B8CBE0] text-[#05203C]">
            <Link href="/signup">Começar teste</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 lg:py-16">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-[#0B5CAB]">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>

        <section className="rounded-lg border border-[#D5E4F2] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[#F0F8FF] text-[#0B5CAB]">
            <Icon className="h-6 w-6" />
          </div>
          <h1 className="mt-6 text-3xl font-extrabold tracking-normal text-[#25314B] sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm leading-7 text-[#65758B]">{subtitle}</p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#D8E7F5] bg-[#F7FBFC] px-3 py-2 text-xs font-semibold text-[#53657A]">
            <LockKeyhole className="h-3.5 w-3.5" />
            Última atualização: 24/08/2026
          </p>
        </section>

        <section className="mt-6 space-y-4">
          {sections.map((section) => (
            <article key={section.title} className="rounded-lg border border-[#D5E4F2] bg-white p-6 shadow-sm">
              <h2 className="text-xl font-extrabold tracking-normal text-[#25314B]">{section.title}</h2>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-[#53657A]">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0B5CAB]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-lg border border-[#0B5CAB]/20 bg-[#07122E] p-6 text-white shadow-sm">
          <h2 className="text-xl font-extrabold tracking-normal">Contato</h2>
          <p className="mt-3 text-sm leading-7 text-white/72">
            Para suporte, solicitações comerciais ou pedidos relacionados a dados, use o WhatsApp ou os canais oficiais informados no sistema.
          </p>
        </section>
      </main>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalLayout
      type="terms"
      title="Termos de uso"
      subtitle="Condições gerais para uso do EasyCare por instituições, equipe, gestores e familiares autorizados."
      sections={termsSections}
    />
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout
      type="privacy"
      title="Política de privacidade"
      subtitle="Resumo de como o EasyCare trata dados pessoais, dados sensíveis, logs e informações de cobrança."
      sections={privacySections}
    />
  );
}
