import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Eye, EyeOff, HeartPulse, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type InvitePreview = {
  expiresAt: string;
  member: {
    name: string;
    relationship: string;
  };
  organization: {
    name: string;
    phone?: string | null;
  };
  resident: {
    name: string;
  };
};

function getInviteTokenFromPath() {
  const match = window.location.pathname.match(/\/portal\/convite\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const inputClassName =
  "h-11 rounded-md border-[#C7D6E6] bg-white px-3.5 text-[15px] text-[#05203C] placeholder:text-[#93A3B7] focus-visible:border-[#0B5CAB] focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12 focus-visible:ring-offset-0";

export default function FamilyPortalInvite() {
  const token = useMemo(() => getInviteTokenFromPath(), []);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const inviteQuery = useQuery<InvitePreview>({
    queryKey: ["family-portal-invite", token],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`/api/family-portal/invite/${encodeURIComponent(token)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Convite inválido ou expirado.");
      }
      return res.json();
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: async () => {
      if (password !== passwordConfirmation) {
        throw new Error("As senhas não conferem.");
      }

      const res = await fetch(`/api/family-portal/invite/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Não foi possível ativar o acesso.");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["family-portal-me"], data.familyMember);
      toast({ title: "Acesso ativado com sucesso" });
      setLocation("/portal/home");
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao ativar acesso", description: error.message, variant: "destructive" });
    },
  });

  const invite = inviteQuery.data;
  const canSubmit = password.length >= 8 && passwordConfirmation.length >= 8 && !acceptInviteMutation.isPending;

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden text-white"
      style={{ background: "linear-gradient(135deg, #050B1F 0%, #081337 48%, #0D1A40 100%)" }}
    >
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.75) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.75) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(90deg,rgba(34,211,238,0.08)_0%,rgba(31,111,235,0.04)_42%,rgba(255,255,255,0)_100%)]" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="border-b border-white/10 bg-[#050B1F]/48 backdrop-blur-md">
          <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
            <img src="/brand/logo-easycare-header.png" alt="EasyCare" className="h-10 w-auto object-contain" />
          <Button
            variant="ghost"
            className="text-white/55 hover:bg-white/10 hover:text-white"
            onClick={() => setLocation("/portal")}
          >
            Entrar
          </Button>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:py-14">
          <div className="grid w-full max-w-7xl items-center gap-10 lg:grid-cols-[0.92fr_1.08fr]">
            <section className="hidden lg:block">
              <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-cyan-300">
                <HeartPulse className="h-6 w-6" />
              </div>
              <h1 className="max-w-xl text-4xl font-extrabold leading-tight tracking-normal">
                Portal da Família EasyCare
              </h1>
              <p className="mt-4 max-w-lg text-base leading-8 text-white/68">
                Crie sua senha para acompanhar as informações que a instituição compartilhar sobre o paciente.
              </p>
            </section>

            <section className="overflow-hidden rounded-lg border border-[#D5E4F2] bg-white text-[#05203C] shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
              <div className="h-1 bg-[linear-gradient(90deg,#0B5CAB_0%,#11C5D9_52%,#5F5CFF_100%)]" />
              <div className="p-6 sm:p-8">
              {inviteQuery.isLoading ? (
                <div className="space-y-4">
                  <div className="h-6 w-48 animate-pulse rounded bg-slate-100" />
                  <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
                  <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
                </div>
              ) : inviteQuery.error || !invite ? (
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600">
                    <LockKeyhole className="h-6 w-6" />
                  </div>
                  <h1 className="text-2xl font-extrabold tracking-normal text-[#25314B]">Convite indisponível</h1>
                  <p className="mt-2 text-sm text-[#65758B]">
                    Solicite um novo convite para a instituição responsável.
                  </p>
                  <Button className="mt-6 h-11 w-full rounded-md bg-[#0B5CAB] text-white hover:bg-[#084B8A]" onClick={() => setLocation("/portal")}>
                    Voltar ao portal
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="mb-6">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md border border-[#CBE4FA] bg-[#F0F8FF] text-[#0B5CAB]">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <h1 className="text-2xl font-extrabold tracking-normal text-[#25314B]">Ativar acesso familiar</h1>
                    <p className="mt-2 text-sm leading-6 text-[#65758B]">
                      {invite.organization.name} liberou o acesso de {invite.member.name} para acompanhar {invite.resident.name}.
                    </p>
                    <p className="mt-2 text-xs font-semibold text-[#65758B]">
                      Convite válido até {formatDate(invite.expiresAt)}.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-bold text-[#354258]">
                        Senha
                      </label>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          className={`${inputClassName} pr-11`}
                          placeholder="Mínimo 8 caracteres"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#607087] transition hover:bg-[#EAF5FF] hover:text-[#0B5CAB]"
                          aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-bold text-[#354258]">
                        Confirmar senha
                      </label>
                      <Input
                        type={showPassword ? "text" : "password"}
                        className={inputClassName}
                        placeholder="Repita a senha"
                        value={passwordConfirmation}
                        onChange={(event) => setPasswordConfirmation(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && canSubmit && acceptInviteMutation.mutate()}
                      />
                    </div>

                    <Button
                      className="h-12 w-full gap-2 rounded-md border border-[#0A559F] bg-[#0B5CAB] font-bold text-white shadow-[0_12px_24px_rgba(11,92,171,0.18)] hover:bg-[#084B8A]"
                      disabled={!canSubmit}
                      onClick={() => acceptInviteMutation.mutate()}
                    >
                      {acceptInviteMutation.isPending ? "Ativando..." : "Ativar e entrar"}
                      {!acceptInviteMutation.isPending && <ArrowRight className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
