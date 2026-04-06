import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { maskCnpj } from "@/lib/masks";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { ArrowRight } from "lucide-react";

const loginSchema = z.object({
  organizationCnpj: z.string().optional(),
  username: z.string().min(1, "Informe o usuÃ¡rio"),
  password: z.string().min(1, "Informe a senha"),
});

export default function Login() {
  const { login, isLoggingIn } = useAuth();

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { organizationCnpj: "", username: "", password: "" },
  });

  function onSubmit(values: z.infer<typeof loginSchema>) {
    login(values);
  }


  return (
    <div
      className="min-h-screen w-full flex"
      style={{
        background:
          "linear-gradient(135deg, #060B1F 0%, #0A0F2C 50%, #0D1A40 100%)",
      }}
    >
      {/* Left panel â€” branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden">
        {/* Grid decoration */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(34,211,238,1) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Glow circles */}
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #1F6FEB, transparent)" }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, #22D3EE, transparent)" }}
        />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            {/* <img
              src="/easycare-logo.png"
              alt="EasyCare"
              className="h-12 w-12 object-contain rounded-2xl"
            /> */}
            <div>
              <p
                className="text-3xl font-bold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                <span className="text-white">Easy</span>
                <span style={{ color: "#22D3EE" }}>Care</span>
              </p>
            </div>
          </div>

          <p
            className="text-sm mt-1 tracking-[0.2em] uppercase font-medium"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            Tecnologia que organiza, cuidado que transforma
          </p>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h2
              className="text-4xl font-bold text-white leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Controle total da sua <span style={{ color: "#22D3EE" }}>ILPI</span>,
              <br />
              com mais seguranÃ§a, organizaÃ§Ã£o e cuidado
            </h2>

            <p
              className="mt-4 text-base leading-relaxed max-w-xl"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              Centralize prontuÃ¡rios, medicaÃ§Ãµes, equipe e atendimentos em um Ãºnico
              sistema. Reduza erros, ganhe tempo e ofereÃ§a mais transparÃªncia para
              familiares e responsÃ¡veis.
            </p>

            <p
              className="text-xs mt-4 uppercase tracking-[0.18em] font-semibold"
              style={{ color: "rgba(255,255,255,0.28)" }}
            >
              Plataforma em nuvem para gestÃ£o moderna de cuidados
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { title: "Controle da unidade", label: "Rotinas, cadastros e equipe em um sÃ³ lugar" },
              { title: "ProntuÃ¡rio integrado", label: "EvoluÃ§Ãµes, medicaÃ§Ãµes e ocorrÃªncias" },
              { title: "Acesso remoto seguro", label: "GestÃ£o online com praticidade e proteÃ§Ã£o" },
              { title: "Conforme LGPD", label: "Mais seguranÃ§a para dados sensÃ­veis" },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl p-4 border border-white/[0.07]"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <p className="text-sm font-semibold" style={{ color: "#22D3EE" }}>
                  {item.title}
                </p>
                <p
                  className="text-xs mt-1 leading-relaxed"
                  style={{ color: "rgba(255,255,255,0.45)" }}
                >
                  {item.label}
                </p>
              </div>
            ))}
          </div>

          <div
            className="rounded-2xl border border-white/[0.06] px-4 py-3 max-w-xl"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <p className="text-sm text-white font-medium">
              Mais controle para a equipe. Mais confianÃ§a para a famÃ­lia.
            </p>
            <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              Ideal para instituiÃ§Ãµes que precisam de organizaÃ§Ã£o, rastreabilidade e
              acompanhamento contÃ­nuo do cuidado.
            </p>
          </div>
        </div>

        <p
          className="relative z-10 text-xs"
          style={{ color: "rgba(255,255,255,0.2)" }}
        >
          Â© 2026 EasyCare Â· Todos os direitos reservados
        </p>
      </div>

      {/* Right panel â€” login form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 relative">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 flex items-center gap-3">
          <img
            src="/easycare-logo.png"
            alt="EasyCare"
            className="h-10 w-10 object-contain rounded-xl"
          />
          <div>
            <p
              className="text-2xl font-bold"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <span className="text-white">Easy</span>
              <span style={{ color: "#22D3EE" }}>Care</span>
            </p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
              GestÃ£o moderna para ILPIs
            </p>
          </div>
        </div>

        <div className="w-full max-w-md space-y-6">
          {/* Form card */}
          <div
            className="rounded-2xl p-8 shadow-2xl border border-white/10"
            style={{
              background: "rgba(255,255,255,0.03)",
              backdropFilter: "blur(20px)",
            }}
          >
            <div className="mb-7">
              <h1
                className="text-2xl font-bold text-white"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Acesse sua conta
              </h1>
              <p
                className="text-sm mt-1 leading-relaxed"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                Gerencie sua unidade, equipe, pacientes e rotinas em um sÃ³ lugar.
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="organizationCnpj"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel
                        className="text-sm font-medium"
                        style={{ color: "rgba(255,255,255,0.7)" }}
                      >
                        CNPJ da organizaÃ§Ã£o
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="00.000.000/0000-00"
                          maxLength={18}
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(maskCnpj(e.target.value))}
                          style={{ background: "rgba(255,255,255,0.06)" }}
                          className="h-11 border-white/10 text-white placeholder:text-white/25"
                          data-testid="input-organization-cnpj"
                        />
                      </FormControl>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                        Para super-admin, deixe este campo em branco.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel
                        className="text-sm font-medium"
                        style={{ color: "rgba(255,255,255,0.7)" }}
                      >
                        UsuÃ¡rio
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Digite seu usuÃ¡rio"
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
                      <FormLabel
                        className="text-sm font-medium"
                        style={{ color: "rgba(255,255,255,0.7)" }}
                      >
                        Senha
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Digite sua senha"
                          {...field}
                          className="h-11 border-white/10 text-white placeholder:text-white/25"
                          style={{ background: "rgba(255,255,255,0.06)" }}
                          data-testid="input-password"
                        />
                      </FormControl>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "rgba(255,255,255,0.42)" }}
                        >
                          Esqueci minha senha
                        </button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-11 font-semibold text-white gap-2 mt-2 btn-glow"
                  style={{
                    background: "linear-gradient(135deg, #1F6FEB 0%, #1a5fd4 100%)",
                  }}
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
                      Acessar sistema
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  )}
                </Button>
              </form>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
}

