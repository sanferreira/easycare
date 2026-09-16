import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowRight, CheckCircle2, Loader2, LockKeyhole } from "lucide-react";

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

const resetSchema = z.object({
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
  confirmPassword: z.string().min(8, "Confirme a senha."),
}).refine((value) => value.password === value.confirmPassword, {
  message: "As senhas não conferem.",
  path: ["confirmPassword"],
});

type ResetValues = z.infer<typeof resetSchema>;

const inputClassName =
  "h-12 min-w-0 rounded-md border-[#C7D6E6] bg-white px-3.5 text-[15px] text-[#05203C] placeholder:text-[#93A3B7] focus-visible:border-[#0B5CAB] focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12 focus-visible:ring-offset-0";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [done, setDone] = useState(false);
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token")?.trim() || "", []);

  const tokenQuery = useQuery({
    queryKey: ["/api/auth/reset-password", token],
    enabled: Boolean(token),
    queryFn: async () => {
      const res = await fetch(`/api/auth/reset-password/${encodeURIComponent(token)}`);
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.message || "Link inválido.");
      return payload as { valid: boolean; message?: string; username?: string; name?: string };
    },
  });

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: ResetValues) => {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: values.password }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.message || "Não foi possível redefinir a senha.");
      return payload as { message: string };
    },
    onSuccess: () => setDone(true),
  });

  const invalid = !token || (tokenQuery.data && !tokenQuery.data.valid) || tokenQuery.isError;

  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-x-hidden text-[#05203C]"
      style={{ background: "linear-gradient(135deg, #050B1F 0%, #081337 48%, #0D1A40 100%)" }}
    >
      <header className="relative z-10 border-b border-white/10 bg-[#050B1F]/48 backdrop-blur-md">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center" aria-label="EasyCare">
            <img src="/brand/logo-easycare-header.png" alt="EasyCare" className="h-10 w-auto object-contain" />
          </Link>
          <Link href="/login" className="text-sm font-bold text-[#76DFFF] transition hover:text-white">
            Entrar
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-10">
        <section className="w-full max-w-md overflow-hidden rounded-lg border border-[#D5E4F2] bg-white shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
          <div className="h-1 bg-[linear-gradient(90deg,#0B5CAB_0%,#11C5D9_52%,#5F5CFF_100%)]" />
          <div className="p-6 sm:p-8">
            {tokenQuery.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#65758B]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Validando link...
              </div>
            ) : done ? (
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-[#EAF5FF] text-[#0B5CAB]">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h1 className="mt-5 text-2xl font-extrabold text-[#25314B]">Senha atualizada</h1>
                <p className="mt-3 text-sm leading-6 text-[#65758B]">
                  Sua nova senha já está ativa. Entre com CNPJ, usuário e a senha nova.
                </p>
                <Button
                  className="mt-6 h-11 w-full rounded-md bg-[#0B5CAB] text-white hover:bg-[#084B8A]"
                  onClick={() => setLocation("/login")}
                >
                  Ir para o login
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ) : invalid ? (
              <div className="text-center">
                <h1 className="text-2xl font-extrabold text-[#25314B]">Link inválido</h1>
                <p className="mt-3 text-sm leading-6 text-[#65758B]">
                  {tokenQuery.data?.message
                    || (tokenQuery.error instanceof Error ? tokenQuery.error.message : null)
                    || "Este link expirou ou já foi usado. Solicite uma nova redefinição."}
                </p>
                <Button asChild className="mt-6 h-11 w-full rounded-md bg-[#0B5CAB] text-white hover:bg-[#084B8A]">
                  <Link href="/esqueci-a-senha">Solicitar novo link</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-md border border-[#CBE4FA] bg-[#F0F8FF] text-[#0B5CAB]">
                    <LockKeyhole className="h-5 w-5" />
                  </div>
                  <h1 className="text-2xl font-extrabold text-[#25314B]">Nova senha</h1>
                  <p className="mt-2 text-sm leading-6 text-[#65758B]">
                    Conta de <strong>{tokenQuery.data?.username}</strong>. Digite a nova senha abaixo.
                  </p>
                </div>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-bold text-[#354258]">Nova senha</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" className={inputClassName} autoComplete="new-password" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-bold text-[#354258]">Confirmar senha</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" className={inputClassName} autoComplete="new-password" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {mutation.isError ? (
                      <p className="text-sm text-red-600">
                        {mutation.error instanceof Error ? mutation.error.message : "Erro ao salvar."}
                      </p>
                    ) : null}

                    <Button
                      type="submit"
                      disabled={mutation.isPending}
                      className="h-12 w-full rounded-md bg-[#0B5CAB] font-bold text-white hover:bg-[#084B8A]"
                    >
                      {mutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          Salvar nova senha
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>
                </Form>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
