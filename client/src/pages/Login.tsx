import { useState } from "react";
import { Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowRight, Eye, EyeOff, UserRoundCog, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { buildSupportWhatsappUrl } from "@/lib/contact";
import { maskCnpj } from "@/lib/masks";

const loginSchema = z.object({
  organizationCnpj: z.string().optional(),
  username: z.string().min(1, "Informe o usuário"),
  password: z.string().min(1, "Informe a senha"),
});

type LoginValues = z.infer<typeof loginSchema>;
type AccessMode = "team" | "admin";

const accessModes = [
  {
    id: "team" as const,
    title: "Equipe",
    icon: UsersRound,
  },
  {
    id: "admin" as const,
    title: "Super-admin",
    icon: UserRoundCog,
  },
];

const inputClassName =
  "h-12 min-w-0 rounded-md border-[#C7D6E6] bg-white px-3.5 text-[15px] text-[#05203C] shadow-[inset_0_1px_0_rgba(5,32,60,0.02)] placeholder:text-[#93A3B7] focus-visible:border-[#0B5CAB] focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12 focus-visible:ring-offset-0";
const supportWhatsappUrl = buildSupportWhatsappUrl("Olá! Preciso de ajuda com o acesso ao EasyCare.");

export default function Login() {
  const { login, isLoggingIn } = useAuth();
  const [accessMode, setAccessMode] = useState<AccessMode>("team");
  const [showPassword, setShowPassword] = useState(false);
  const isTeamMode = accessMode === "team";

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { organizationCnpj: "", username: "", password: "" },
  });

  function selectAccessMode(mode: AccessMode) {
    setAccessMode(mode);
    if (mode === "admin") {
      form.setValue("organizationCnpj", "");
    }
  }

  function onSubmit(values: LoginValues) {
    login(isTeamMode ? values : { ...values, organizationCnpj: "" });
  }

  return (
    <div
      className="relative flex min-h-screen w-full max-w-[100vw] flex-col overflow-x-hidden text-[#05203C]"
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-40 border-t border-white/5 bg-[linear-gradient(180deg,rgba(5,11,31,0)_0%,rgba(5,11,31,0.42)_100%)]" />

      <header className="relative z-10 border-b border-white/10 bg-[#050B1F]/48 backdrop-blur-md">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center" aria-label="EasyCare">
            <img
              src="/brand/logo-easycare-header.png"
              alt="EasyCare"
              className="h-10 w-auto object-contain"
            />
          </Link>
          <Link
            href="/signup"
            className="ml-4 inline-flex h-10 shrink-0 items-center rounded-md px-2 text-sm font-bold text-[#76DFFF] transition hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#22D3EE]/20"
          >
            Criar conta
          </Link>
        </div>
      </header>

      <main
        className="relative z-10 flex w-full flex-1 items-center justify-center overflow-hidden px-4 py-8 sm:px-8 lg:py-10"
      >
        <section className="min-w-0" style={{ width: "min(500px, calc(100vw - 2rem))" }}>
          <div className="w-full min-w-0 overflow-hidden rounded-lg border border-[#D5E4F2] bg-white shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
            <div className="h-1 bg-[linear-gradient(90deg,#0B5CAB_0%,#11C5D9_52%,#5F5CFF_100%)]" />
            <div className="p-6 sm:p-10">
              <div className="mb-7">
                {/* <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-md border border-[#CBE4FA] bg-[#F0F8FF] text-[#0B5CAB] shadow-[0_8px_22px_rgba(11,92,171,0.08)]">
                  <LockKeyhole className="h-5 w-5" />
                </div> */}
                <h1 className="text-2xl font-extrabold tracking-normal text-[#25314B] sm:text-3xl">
                  Entre no EasyCare
                </h1>
                <p className="mt-2 text-sm leading-6 text-[#65758B]">
                  Use os dados da sua instituição para continuar.
                </p>
              </div>

              <div className="mb-6 grid gap-1 rounded-md border border-[#E1EAF3] bg-[#F2F6FB] p-1 sm:grid-cols-2">
                {accessModes.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => selectAccessMode(mode.id)}
                    aria-pressed={accessMode === mode.id}
                    className={`inline-flex h-11 items-center justify-center gap-2 rounded-md text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12 ${
                      accessMode === mode.id
                        ? "bg-white text-[#05203C] shadow-[0_1px_2px_rgba(5,32,60,0.1)]"
                        : "text-[#69778B] hover:bg-white/70 hover:text-[#25314B]"
                    }`}
                  >
                    <mode.icon className="h-4 w-4" />
                    {mode.title}
                  </button>
                ))}
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  {isTeamMode ? (
                    <FormField
                      control={form.control}
                      name="organizationCnpj"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-bold text-[#354258]">
                            CNPJ da organização
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="00.000.000/0000-00"
                              maxLength={18}
                              autoComplete="organization"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(event) => field.onChange(maskCnpj(event.target.value))}
                              className={inputClassName}
                              data-testid="input-organization-cnpj"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="rounded-md border border-[#D8E7F5] bg-[#F7FBFC] px-3.5 py-3 text-sm leading-6 text-[#53657A]">
                      Modo interno: entre sem informar CNPJ.
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-bold text-[#354258]">
                          Usuário
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Digite seu usuário"
                            autoComplete="username"
                            {...field}
                            className={inputClassName}
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
                        <FormLabel className="text-sm font-bold text-[#354258]">
                          Senha
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="Digite sua senha"
                              autoComplete="current-password"
                              {...field}
                              className={`${inputClassName} pr-11`}
                              data-testid="input-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((current) => !current)}
                              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#607087] transition hover:bg-[#EAF5FF] hover:text-[#0B5CAB] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12"
                              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                            >
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="h-12 w-full rounded-md border border-[#0A559F] bg-[#0B5CAB] font-bold text-white shadow-[0_12px_24px_rgba(11,92,171,0.18)] transition hover:bg-[#084B8A] active:translate-y-px"
                    disabled={isLoggingIn}
                    data-testid="button-login"
                  >
                    {isLoggingIn ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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

            <div className="border-t border-[#E4ECF5] bg-[#F7FBFC] px-6 py-5 text-center text-sm text-[#53657A] sm:px-10">
              Se houver pagamento pendente, você resolve antes de entrar.
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-[#050B1F]/38 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 w-full max-w-7xl flex-col items-center justify-between gap-2 px-5 py-3 text-xs text-white/45 sm:flex-row sm:px-8">
          <span>© 2026 EasyCare</span>
          <div className="flex items-center gap-4">
            <Link href="/" className="transition hover:text-white">
              Página inicial
            </Link>
            <Link href="/termos" className="transition hover:text-white">
              Termos
            </Link>
            <Link href="/privacidade" className="transition hover:text-white">
              Privacidade
            </Link>
            <a href={supportWhatsappUrl} target="_blank" rel="noreferrer" className="transition hover:text-white">
              WhatsApp
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
