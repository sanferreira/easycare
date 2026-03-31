import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Building2, ShieldAlert, ArrowRight } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "Informe o usuário"),
  password: z.string().min(1, "Informe a senha"),
});

const DEMO_ACCOUNTS = [
  { label: "Bem Viver ILPI", user: "admin", pass: "admin", icon: "building", desc: "Casa de repouso 1" },
  { label: "Lar Esperança", user: "admin2", pass: "admin2", icon: "building", desc: "Casa de repouso 2" },
  { label: "Super Admin", user: "superadmin", pass: "superadmin", icon: "shield", desc: "Acesso total ao sistema" },
];

export default function Login() {
  const { login, isLoggingIn } = useAuth();

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  function onSubmit(values: z.infer<typeof loginSchema>) {
    login(values);
  }

  function fillCredentials(user: string, pass: string) {
    form.setValue("username", user);
    form.setValue("password", pass);
    form.clearErrors();
  }

  return (
    <div
      className="min-h-screen w-full flex"
      style={{ background: "linear-gradient(135deg, #060B1F 0%, #0A0F2C 50%, #0D1A40 100%)" }}
    >
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden">
        {/* Grid decoration */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "linear-gradient(rgba(34,211,238,1) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Glow circles */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #1F6FEB, transparent)" }} />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #22D3EE, transparent)" }} />

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
            Gestão Inteligente, Cuidado Humano.
          </p>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-4xl font-bold text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>
              O sistema completo<br />para sua <span style={{ color: "#22D3EE" }}>ILPI</span>
            </h2>
            <p className="mt-4 text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              Gerencie residentes, medicações, equipe, escalas e ocorrências em uma plataforma integrada e intuitiva.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { num: "100%", label: "Baseado em nuvem" },
              { num: "Multi", label: "Unidades na mesma conta" },
              { num: "24/7", label: "Disponibilidade" },
              { num: "LGPD", label: "Conformidade garantida" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl p-3.5 border border-white/[0.07]"
                style={{ background: "rgba(255,255,255,0.04)" }}>
                <p className="text-lg font-bold" style={{ color: "#22D3EE" }}>{item.num}</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
          © 2025 EasyCare · Todos os direitos reservados
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

        <div className="w-full max-w-md space-y-6">
          {/* Form card */}
          <div className="rounded-2xl p-8 shadow-2xl border border-white/10"
            style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(20px)" }}>
            <div className="mb-7">
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
                Bem-vindo de volta
              </h1>
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
                Entre com suas credenciais para acessar o sistema
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>
                        Usuário
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="seu.usuario"
                          {...field}
                          className="h-11 border-white/10 text-white placeholder:text-white/25"
                          style={{ background: "rgba(255,255,255,0.06)" }}
                          data-testid="input-username"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>
                        Senha
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          {...field}
                          className="h-11 border-white/10 text-white placeholder:text-white/25"
                          style={{ background: "rgba(255,255,255,0.06)" }}
                          data-testid="input-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full h-11 font-semibold text-white gap-2 mt-2 btn-glow"
                  style={{ background: "linear-gradient(135deg, #1F6FEB 0%, #1a5fd4 100%)" }}
                  disabled={isLoggingIn}
                  data-testid="button-login"
                >
                  {isLoggingIn ? (
                    <span className="flex items-center gap-2">
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Entrando...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Entrar
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  )}
                </Button>
              </form>
            </Form>
          </div>

          {/* Demo accounts */}
          <div className="rounded-2xl p-5 border border-white/[0.07]"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[11px] uppercase tracking-widest font-semibold mb-3"
              style={{ color: "rgba(255,255,255,0.3)" }}>
              Contas de demonstração
            </p>
            <div className="space-y-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.user}
                  type="button"
                  onClick={() => fillCredentials(acc.user, acc.pass)}
                  data-testid={`demo-account-${acc.user}`}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-white/[0.07] hover:border-white/20 transition-all text-left group"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <div
                    className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: acc.icon === "shield"
                        ? "rgba(251,191,36,0.15)"
                        : "rgba(31,111,235,0.2)",
                    }}
                  >
                    {acc.icon === "shield"
                      ? <ShieldAlert className="h-4 w-4 text-amber-400" />
                      : <Building2 className="h-4 w-4" style={{ color: "#22D3EE" }} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white leading-tight">{acc.label}</p>
                    <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {acc.user} / {acc.pass}
                    </p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                    style={{ color: "#22D3EE" }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
