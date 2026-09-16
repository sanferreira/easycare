import { useMemo, useState } from "react";
import { Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Mail } from "lucide-react";

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
import { buildSupportWhatsappUrl } from "@/lib/contact";
import { maskCnpj } from "@/lib/masks";

const forgotSchema = z.object({
  organizationCnpj: z.string().trim().refine((value) => value.replace(/\D/g, "").length === 14, {
    message: "Informe um CNPJ válido.",
  }),
  username: z.string().trim().min(1, "Informe o usuário."),
  email: z.string().trim().email("Informe um e-mail válido."),
});

type ForgotValues = z.infer<typeof forgotSchema>;

const inputClassName =
  "h-12 min-w-0 rounded-md border-[#C7D6E6] bg-white px-3.5 text-[15px] text-[#05203C] placeholder:text-[#93A3B7] focus-visible:border-[#0B5CAB] focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12 focus-visible:ring-offset-0";

export default function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false);
  const supportUrl = useMemo(
    () => buildSupportWhatsappUrl("Olá! Preciso de ajuda para redefinir minha senha no EasyCare."),
    [],
  );

  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { organizationCnpj: "", username: "", email: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: ForgotValues) => {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          username: values.username.trim().toLowerCase(),
          email: values.email.trim().toLowerCase(),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.message || "Não foi possível enviar o e-mail.");
      return payload as { message: string };
    },
    onSuccess: () => setSubmitted(true),
  });

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
            Voltar ao login
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-10">
        <section className="w-full max-w-md overflow-hidden rounded-lg border border-[#D5E4F2] bg-white shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
          <div className="h-1 bg-[linear-gradient(90deg,#0B5CAB_0%,#11C5D9_52%,#5F5CFF_100%)]" />
          <div className="p-6 sm:p-8">
            {submitted ? (
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-[#EAF5FF] text-[#0B5CAB]">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h1 className="mt-5 text-2xl font-extrabold text-[#25314B]">Verifique seu e-mail</h1>
                <p className="mt-3 text-sm leading-6 text-[#65758B]">
                  Se os dados estiverem corretos, enviamos um link para redefinir a senha. O link vale por 60 minutos.
                </p>
                <Button asChild className="mt-6 h-11 w-full rounded-md bg-[#0B5CAB] text-white hover:bg-[#084B8A]">
                  <Link href="/login">
                    Voltar ao login
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-md border border-[#CBE4FA] bg-[#F0F8FF] text-[#0B5CAB]">
                    <Mail className="h-5 w-5" />
                  </div>
                  <h1 className="text-2xl font-extrabold text-[#25314B]">Esqueci a senha</h1>
                  <p className="mt-2 text-sm leading-6 text-[#65758B]">
                    Informe CNPJ, usuário e e-mail cadastrados. Enviaremos um link seguro.
                  </p>
                </div>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="organizationCnpj"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-bold text-[#354258]">CNPJ</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ""}
                              onChange={(event) => field.onChange(maskCnpj(event.target.value))}
                              maxLength={18}
                              className={inputClassName}
                              placeholder="00.000.000/0000-00"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-bold text-[#354258]">Usuário</FormLabel>
                          <FormControl>
                            <Input {...field} className={inputClassName} placeholder="Seu usuário" autoComplete="username" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-bold text-[#354258]">E-mail</FormLabel>
                          <FormControl>
                            <Input {...field} type="email" className={inputClassName} placeholder="E-mail da conta" autoComplete="email" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {mutation.isError ? (
                      <p className="text-sm text-red-600">
                        {mutation.error instanceof Error ? mutation.error.message : "Erro ao enviar."}
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
                          Enviando...
                        </>
                      ) : (
                        <>
                          Enviar link
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>
                </Form>

                <div className="mt-5 flex items-center justify-between text-sm">
                  <Link href="/login" className="inline-flex items-center gap-1 font-semibold text-[#0B5CAB]">
                    <ArrowLeft className="h-4 w-4" />
                    Login
                  </Link>
                  <a href={supportUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#65758B] hover:text-[#0B5CAB]">
                    Suporte
                  </a>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
