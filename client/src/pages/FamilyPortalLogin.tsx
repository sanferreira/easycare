import { useState } from "react";
import { Link } from "wouter";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, ArrowRight, ShieldCheck, LockKeyhole, CheckCircle2 } from "lucide-react";
import { maskCnpj } from "@/lib/masks";

const inputClassName =
  "h-11 rounded-md border-[#C7D6E6] bg-white px-3.5 text-[15px] text-[#05203C] placeholder:text-[#93A3B7] focus-visible:border-[#0B5CAB] focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12 focus-visible:ring-offset-0";

export default function FamilyPortalLogin() {
  const [organizationCnpj, setOrganizationCnpj] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/family-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationCnpj, username, password }),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Usuário ou senha inválidos");
      }

      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["family-portal-me"], data.familyMember);
      toast({ title: `Bem-vindo(a), ${data.familyMember.name}!` });
      setLocation("/portal/home");
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao entrar", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="relative flex min-h-screen w-full max-w-[100vw] flex-col overflow-x-hidden text-white"
      style={{
        background:
          "linear-gradient(135deg, #050B1F 0%, #081337 48%, #0D1A40 100%)",
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
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center" aria-label="EasyCare">
            <img src="/brand/logo-easycare-header.png" alt="EasyCare" className="h-10 w-auto object-contain" />
          </Link>
          <Button asChild variant="outline" className="h-10 rounded-md border-white/20 bg-white/5 text-white hover:bg-white/10">
            <Link href="/login">Login da equipe</Link>
          </Button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center overflow-hidden px-5 py-10 sm:px-8 lg:py-14">
        <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <section className="min-w-0 max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-[#22D3EE]/25 bg-white/5 px-3 py-2 text-sm font-extrabold text-[#76DFFF]">
              <ShieldCheck className="h-4 w-4" />
              Portal da Família
            </div>
            <h1 className="mt-6 max-w-full break-words text-3xl font-extrabold leading-tight tracking-normal text-white sm:text-5xl">
              Acesso familiar à rotina de cuidado.
            </h1>
            <p className="mt-5 max-w-full break-words text-base leading-8 text-white/68 sm:text-lg">
              Consulte as informações liberadas pela instituição: evoluções, medicações e ocorrências do paciente.
            </p>
            <div className="mt-8 grid gap-3 text-sm font-semibold text-white/72">
              {[
                "Entrada apenas para familiares autorizados.",
                "Convite enviado pela instituição para o primeiro acesso.",
                "Dados organizados em um portal simples e seguro.",
              ].map((item) => (
                <span key={item} className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#22D3EE]" />
                  {item}
                </span>
              ))}
            </div>
          </section>

          <section className="w-full min-w-0">
            <div className="w-full min-w-0 overflow-hidden rounded-lg border border-[#D5E4F2] bg-white text-[#05203C] shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
              <div className="h-1 bg-[linear-gradient(90deg,#0B5CAB_0%,#11C5D9_52%,#5F5CFF_100%)]" />
              <div className="p-6 sm:p-8">
                <div className="mb-6">
                  <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-md border border-[#CBE4FA] bg-[#F0F8FF] text-[#0B5CAB] shadow-[0_8px_22px_rgba(11,92,171,0.08)]">
                    <LockKeyhole className="h-5 w-5" />
                  </div>
                  <h2 className="text-2xl font-extrabold tracking-normal text-[#25314B]">
                    Entrar no Portal da Família
                  </h2>
                  <p className="mt-2 max-w-full break-words text-sm leading-6 text-[#65758B]">
                    Use CPF, WhatsApp ou usuário cadastrado pela instituição.
                  </p>
                </div>

                <div className="mb-5 rounded-md border border-[#D8E7F5] bg-[#F7FBFC] px-3.5 py-3 text-sm leading-6 text-[#53657A]">
                  Primeiro acesso? Abra o link de convite recebido pela instituição para criar sua senha.
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="mb-1.5 block text-sm font-bold text-[#354258]">
                      Instituição
                    </label>
                    <Input
                      className={inputClassName}
                      placeholder="CNPJ da instituição"
                      value={organizationCnpj}
                      maxLength={18}
                      onChange={(e) => setOrganizationCnpj(maskCnpj(e.target.value))}
                      onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
                      data-testid="input-portal-organization-cnpj"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-bold text-[#354258]">
                      CPF, WhatsApp ou usuário
                    </label>
                    <Input
                      className={inputClassName}
                      placeholder="Digite seu CPF, WhatsApp ou usuário"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
                      data-testid="input-portal-username"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-bold text-[#354258]">
                      Senha
                    </label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        className={`${inputClassName} pr-11`}
                        placeholder="Digite sua senha"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
                        data-testid="input-portal-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#607087] transition hover:bg-[#EAF5FF] hover:text-[#0B5CAB] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12"
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    className="h-12 w-full rounded-md border border-[#0A559F] bg-[#0B5CAB] font-bold text-white shadow-[0_12px_24px_rgba(11,92,171,0.18)] transition hover:bg-[#084B8A]"
                    disabled={loginMutation.isPending || !organizationCnpj || !username || !password}
                    onClick={() => loginMutation.mutate()}
                    data-testid="button-portal-login"
                  >
                    {loginMutation.isPending ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Entrando...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        Acessar portal
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-[#050B1F]/38">
        <div className="mx-auto flex min-h-14 w-full max-w-7xl flex-col items-center justify-between gap-2 px-5 py-3 text-xs text-white/45 sm:flex-row sm:px-8">
          <span>© 2026 EasyCare</span>
          <div className="flex items-center gap-4">
            <Link href="/" className="transition hover:text-white">Página inicial</Link>
            <Link href="/login" className="transition hover:text-white">Login da equipe</Link>
            <Link href="/termos" className="transition hover:text-white">Termos</Link>
            <Link href="/privacidade" className="transition hover:text-white">Privacidade</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
