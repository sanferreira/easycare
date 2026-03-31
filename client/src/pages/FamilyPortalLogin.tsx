import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, ArrowRight, Users, FileText, Shield, Clock } from "lucide-react";

export default function FamilyPortalLogin() {
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
        body: JSON.stringify({ username, password }),
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
      className="min-h-screen w-full flex"
      style={{ background: "linear-gradient(135deg, #060B1F 0%, #0A0F2C 50%, #0D1A40 100%)" }}
    >
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden">
        {/* Grid decoration */}
        <div className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: "linear-gradient(rgba(34,211,238,1) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Glow circles — cyan themed */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-15 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #22D3EE, transparent)" }} />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #06b6d4, transparent)" }} />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <img src="/easycare-logo.png" alt="EasyCare" className="h-12 w-12 object-contain rounded-2xl" />
            <div>
              <p className="text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                <span className="text-white">Easy</span>
                <span style={{ color: "#22D3EE" }}>Care</span>
              </p>
            </div>
          </div>
          <p className="text-sm mt-1 tracking-[0.2em] uppercase font-medium" style={{ color: "rgba(255,255,255,0.35)" }}>
            Portal da Família
          </p>
        </div>

        {/* Content */}
        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-4xl font-bold text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>
              Acompanhe o cuidado<br />do seu <span style={{ color: "#22D3EE" }}>familiar</span>
            </h2>
            <p className="mt-4 text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              Acesse evoluções diárias, medicações e ocorrências com segurança e transparência — em qualquer lugar.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: FileText, label: "Evoluções compartilhadas", color: "#22D3EE" },
              { icon: Shield, label: "Acesso seguro e privado", color: "#22D3EE" },
              { icon: Clock, label: "Informações em tempo real", color: "#22D3EE" },
              { icon: Users, label: "Portal exclusivo da família", color: "#22D3EE" },
            ].map(({ icon: Icon, label, color }) => (
              <div key={label} className="rounded-xl p-3.5 border border-white/[0.07]"
                style={{ background: "rgba(255,255,255,0.04)" }}>
                <Icon className="h-4 w-4 mb-2" style={{ color }} />
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
          © 2025 EasyCare · Acesso exclusivo para responsáveis cadastrados
        </p>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 relative">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 flex items-center gap-3">
          <img src="/easycare-logo.png" alt="EasyCare" className="h-10 w-10 object-contain rounded-xl" />
          <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
            <span className="text-white">Easy</span>
            <span style={{ color: "#22D3EE" }}>Care</span>
          </p>
        </div>

        <div className="w-full max-w-md space-y-4">
          {/* Form card */}
          <div className="rounded-2xl p-8 shadow-2xl border border-white/10"
            style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(20px)" }}>
            <div className="mb-7">
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
                Acesso de Responsável
              </h1>
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
                Entre com as credenciais fornecidas pela ILPI
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5" style={{ color: "rgba(255,255,255,0.7)", fontFamily: "var(--font-display)" }}>
                  Usuário
                </label>
                <Input
                  className="h-11 border-white/10 text-white placeholder:text-white/25"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                  placeholder="ex: joao.silva"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
                  data-testid="input-portal-username"
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5" style={{ color: "rgba(255,255,255,0.7)", fontFamily: "var(--font-display)" }}>
                  Senha
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    className="h-11 border-white/10 text-white placeholder:text-white/25 pr-10"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
                    data-testid="input-portal-password"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "rgba(255,255,255,0.3)" }}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                className="w-full h-11 font-semibold gap-2 mt-2"
                style={{ background: "linear-gradient(135deg, #22D3EE 0%, #06b6d4 100%)", color: "#0A0F2C", fontFamily: "var(--font-display)" }}
                disabled={loginMutation.isPending || !username || !password}
                onClick={() => loginMutation.mutate()}
                data-testid="button-portal-login"
              >
                {loginMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-[#0A0F2C]/30 border-t-[#0A0F2C] rounded-full animate-spin" />
                    Entrando...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Acessar Portal
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Demo accounts */}
          <div className="rounded-2xl p-5 border border-white/[0.07]"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[11px] uppercase tracking-widest font-semibold mb-3"
              style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-display)" }}>
              Contas de demonstração · senha: <span style={{ color: "#22D3EE" }}>familia123</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "João Silva", user: "joao.silva", desc: "Bem Viver ILPI" },
                { label: "Ana Santos", user: "ana.santos", desc: "Bem Viver ILPI" },
                { label: "Cláudia Rocha", user: "claudia.rocha", desc: "Lar Esperança" },
                { label: "Ricardo Moraes", user: "ricardo.moraes", desc: "Lar Esperança" },
              ].map((acc) => (
                <button
                  key={acc.user}
                  type="button"
                  onClick={() => { setUsername(acc.user); setPassword("familia123"); }}
                  className="text-left px-3 py-2.5 rounded-xl border border-white/[0.07] hover:border-white/20 transition-all group"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                  data-testid={`demo-family-${acc.user}`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Users className="h-3 w-3 shrink-0" style={{ color: "#22D3EE" }} />
                    <p className="text-xs font-semibold text-white truncate">{acc.label}</p>
                  </div>
                  <p className="text-[10px] truncate pl-4" style={{ color: "rgba(255,255,255,0.35)" }}>{acc.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="text-center">
            <a href="/login" className="text-xs hover:underline transition-all" style={{ color: "rgba(255,255,255,0.3)" }}>
              ← Voltar ao login da equipe
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
