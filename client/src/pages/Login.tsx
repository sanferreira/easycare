import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
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
  organizationId: z.number().int().positive().optional(),
  username: z.string().min(1, "Informe o usuário"),
  password: z.string().min(1, "Informe a senha"),
});

type DemoAccount = {
  id: string;
  label: string;
  user: string;
  pass: string;
  icon: "building" | "shield";
  desc: string;
  organizationName?: string;
};

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "bem-viver",
    label: "Bem Viver ILPI",
    user: "admin",
    pass: "admin",
    icon: "building",
    desc: "Acesso administrativo da unidade",
    organizationName: "Bem Viver ILPI",
  },
  {
    label: "Lar Esperança",
    id: "lar-esperanca",
    user: "admin2",
    pass: "admin2",
    icon: "building",
    organizationName: "Lar Esperanca",
    desc: "Ambiente de demonstração da unidade",
  },
  {
    label: "Super Admin",
    id: "super-admin",
    user: "superadmin",
    pass: "superadmin",
    icon: "shield",
    desc: "Acesso total à plataforma",
  },
];

export default function Login() {
  const { login, isLoggingIn } = useAuth();
  const organizationsQuery = useQuery({
    queryKey: ["auth-organizations"],
    queryFn: async () => {
      const res = await fetch(api.auth.organizations.path, { credentials: "include" });
      if (!res.ok) throw new Error("Falha ao carregar organizacoes");
      return res.json() as Promise<Array<{ id: number; name: string }>>;
    },
    staleTime: 60_000,
    retry: false,
  });

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { organizationId: undefined, username: "", password: "" },
  });

  function onSubmit(values: z.infer<typeof loginSchema>) {
    login(values);
  }

  function fillCredentials(account: DemoAccount) {
    form.setValue("username", account.user);
    form.setValue("password", account.pass);

    if (!account.organizationName) {
      form.setValue("organizationId", undefined);
      form.clearErrors("organizationId");
      return;
    }

    const normalizeText = (value: string) =>
      value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const expectedName = normalizeText(account.organizationName);
    const organization = organizationsQuery.data?.find(
      (org) => normalizeText(org.name) === expectedName,
    );
    form.setValue("organizationId", organization?.id);
    form.clearErrors();
  }

  return (
    <div
      className="min-h-screen w-full flex"
      style={{
        background:
          "linear-gradient(135deg, #060B1F 0%, #0A0F2C 50%, #0D1A40 100%)",
      }}
    >
      {/* Left panel — branding */}
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
            <img
              src="/easycare-logo.png"
              alt="EasyCare"
              className="h-12 w-12 object-contain rounded-2xl"
            />
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
              com mais segurança, organização e cuidado
            </h2>

            <p
              className="mt-4 text-base leading-relaxed max-w-xl"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              Centralize prontuários, medicações, equipe e atendimentos em um único
              sistema. Reduza erros, ganhe tempo e ofereça mais transparência para
              familiares e responsáveis.
            </p>

            <p
              className="text-xs mt-4 uppercase tracking-[0.18em] font-semibold"
              style={{ color: "rgba(255,255,255,0.28)" }}
            >
              Plataforma em nuvem para gestão moderna de cuidados
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { title: "Controle da unidade", label: "Rotinas, cadastros e equipe em um só lugar" },
              { title: "Prontuário integrado", label: "Evoluções, medicações e ocorrências" },
              { title: "Acesso remoto seguro", label: "Gestão online com praticidade e proteção" },
              { title: "Conforme LGPD", label: "Mais segurança para dados sensíveis" },
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
              Mais controle para a equipe. Mais confiança para a família.
            </p>
            <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              Ideal para instituições que precisam de organização, rastreabilidade e
              acompanhamento contínuo do cuidado.
            </p>
          </div>
        </div>

        <p
          className="relative z-10 text-xs"
          style={{ color: "rgba(255,255,255,0.2)" }}
        >
          © 2026 EasyCare · Todos os direitos reservados
        </p>
      </div>

      {/* Right panel — login form */}
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
              Gestão moderna para ILPIs
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
                Gerencie sua unidade, equipe, pacientes e rotinas em um só lugar.
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="organizationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel
                        className="text-sm font-medium"
                        style={{ color: "rgba(255,255,255,0.7)" }}
                      >
                        Organizacao
                      </FormLabel>
                      <FormControl>
                        <select
                          value={field.value ? String(field.value) : ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            field.onChange(value ? Number(value) : undefined);
                          }}
                          className="h-11 w-full rounded-md border border-white/10 px-3 text-sm text-white"
                          style={{ background: "rgba(255,255,255,0.06)" }}
                          data-testid="select-organization"
                        >
                          <option value="" style={{ color: "#0A0F2C" }}>
                            Super Admin (sem organizacao)
                          </option>
                          {(organizationsQuery.data || []).map((organization) => (
                            <option
                              key={organization.id}
                              value={organization.id}
                              style={{ color: "#0A0F2C" }}
                            >
                              {organization.name}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      {organizationsQuery.isLoading ? (
                        <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                          Carregando organizacoes...
                        </p>
                      ) : null}
                      {organizationsQuery.isError ? (
                        <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                          Nao foi possivel carregar a lista de organizacoes.
                        </p>
                      ) : null}
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
                        Usuário
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Digite seu usuário"
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

          {/* Demo accounts */}
          <div
            className="rounded-2xl p-5 border border-white/[0.07]"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <p
              className="text-[11px] uppercase tracking-widest font-semibold mb-1"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              Acesso rápido para teste
            </p>

            <p
              className="text-xs mb-3"
              style={{ color: "rgba(255,255,255,0.38)" }}
            >
              Clique em uma conta abaixo para preencher o login automaticamente.
            </p>

            <div className="space-y-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => fillCredentials(acc)}
                  data-testid={`demo-account-${acc.id}`}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-white/[0.07] hover:border-white/20 transition-all text-left group"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <div
                    className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background:
                        acc.icon === "shield"
                          ? "rgba(251,191,36,0.15)"
                          : "rgba(31,111,235,0.2)",
                    }}
                  >
                    {acc.icon === "shield" ? (
                      <ShieldAlert className="h-4 w-4 text-amber-400" />
                    ) : (
                      <Building2 className="h-4 w-4" style={{ color: "#22D3EE" }} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white leading-tight">
                      {acc.label}
                    </p>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      {acc.desc}
                    </p>
                    <p
                      className="text-[11px] mt-1"
                      style={{ color: "rgba(255,255,255,0.28)" }}
                    >
                      {acc.organizationName ? `${acc.organizationName} - ` : ""}
                      {acc.user} / {acc.pass}
                    </p>
                  </div>

                  <ArrowRight
                    className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                    style={{ color: "#22D3EE" }}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
