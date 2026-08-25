import { useMemo, useRef } from "react";
import { Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Loader2,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { buildSupportWhatsappUrl, supportWhatsappDisplay } from "@/lib/contact";
import { maskCnpj } from "@/lib/masks";

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim();
const embeddedCheckoutConfigured = Boolean(stripePublishableKey);

const signupSchema = z.object({
  organizationName: z.string().trim().min(2, "Informe o nome da instituição."),
  cnpj: z.string().trim().refine((value) => value.replace(/\D/g, "").length === 14, {
    message: "Informe um CNPJ válido.",
  }),
  phone: z.string().trim().min(8, "Informe um telefone."),
  email: z.string().trim().email("Informe um e-mail válido."),
  adminName: z.string().trim().min(2, "Informe seu nome."),
  username: z.string()
    .trim()
    .min(3, "Informe um usuário com pelo menos 3 caracteres.")
    .regex(/^[a-zA-Z0-9._-]+$/, "Use apenas letras, números, ponto, hífen ou underline."),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
  confirmPassword: z.string().min(8, "Confirme a senha."),
}).refine((value) => value.password === value.confirmPassword, {
  message: "As senhas não conferem.",
  path: ["confirmPassword"],
});

type SignupValues = z.infer<typeof signupSchema>;

type SignupResponse = {
  url?: string;
  checkoutPath?: string;
  trialDays: number;
};

const inputClassName =
  "h-11 rounded-md border-[#C7D6E6] bg-white px-3.5 text-[15px] text-[#05203C] placeholder:text-[#93A3B7] focus-visible:border-[#0B5CAB] focus-visible:ring-4 focus-visible:ring-[#0B5CAB]/12 focus-visible:ring-offset-0";

async function parseSignupResponse(res: Response): Promise<SignupResponse> {
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.message || "Não foi possível iniciar seu teste.");
  }
  return payload as SignupResponse;
}

export default function Signup() {
  const { toast } = useToast();
  const checkoutWindowRef = useRef<Window | null>(null);
  const supportUrl = useMemo(
    () => buildSupportWhatsappUrl("Olá! Quero ajuda para começar meu teste grátis do EasyCare."),
    [],
  );

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      organizationName: "",
      cnpj: "",
      phone: "",
      email: "",
      adminName: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });
  const signupMutation = useMutation({
    mutationFn: async (values: SignupValues) => {
      const { confirmPassword: _confirmPassword, ...payload } = values;
      const res = await fetch("/api/public/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...payload,
          deferCheckout: embeddedCheckoutConfigured,
        }),
      });
      return parseSignupResponse(res);
    },
    onSuccess: (data) => {
      queryClient.clear();
      if (data.checkoutPath) {
        const checkoutWindow = checkoutWindowRef.current;
        if (checkoutWindow && !checkoutWindow.closed) {
          checkoutWindow.location.href = data.checkoutPath;
          checkoutWindow.focus();
          checkoutWindow.opener = null;
          checkoutWindowRef.current = null;
          return;
        }

        const openedWindow = window.open(data.checkoutPath, "_blank");
        if (openedWindow) {
          openedWindow.opener = null;
          return;
        }

        window.location.assign(data.checkoutPath);
        return;
      }
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      toast({
        title: "Checkout não iniciado",
        description: "A Stripe não retornou uma sessão de checkout.",
        variant: "destructive",
      });
    },
    onError: (error: Error) => {
      if (checkoutWindowRef.current && !checkoutWindowRef.current.closed) {
        checkoutWindowRef.current.close();
      }
      checkoutWindowRef.current = null;
      toast({
        title: "Cadastro não concluído",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function onSubmit(values: SignupValues) {
    if (embeddedCheckoutConfigured) {
      checkoutWindowRef.current = window.open("/checkout?wait=signup", "_blank");
    }

    signupMutation.mutate({
      ...values,
      username: values.username.trim().toLowerCase(),
    });
  }

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
          <div className="flex items-center gap-3">
            <a
              href={supportUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden h-10 items-center gap-2 rounded-md px-2 text-sm font-bold text-[#76DFFF] transition hover:text-white sm:inline-flex"
            >
              <MessageCircle className="h-4 w-4" />
              Suporte
            </a>
            <Button asChild variant="outline" className="h-10 rounded-md border-white/20 bg-white/5 text-white hover:bg-white/10">
              <Link href="/login">Entrar</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center overflow-hidden px-5 py-10 sm:px-8 lg:py-14">
        <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <section className="min-w-0 max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-[#22D3EE]/25 bg-white/5 px-3 py-2 text-sm font-extrabold text-[#76DFFF]">
              <ShieldCheck className="h-4 w-4" />
              7 dias grátis
            </div>
            <h1 className="mt-6 max-w-full break-words text-3xl font-extrabold leading-tight tracking-normal text-white sm:text-5xl">
              Cadastre sua instituição e comece hoje.
            </h1>
            <p className="mt-5 max-w-full break-words text-base leading-8 text-white/68 sm:text-lg">
              Crie a conta da instituição, configure o acesso do administrador e entre no ambiente seguro da Stripe para ativar o período gratuito.
            </p>
            <div className="mt-8 grid gap-3 text-sm font-semibold text-white/72">
              {[
                "Sem instalação e sem contrato manual.",
                "Assinatura mensal com teste grátis pela Stripe.",
                "Suporte pelo WhatsApp durante a implantação.",
              ].map((item) => (
                <span key={item} className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#22D3EE]" />
                  {item}
                </span>
              ))}
            </div>
            <a
              href={supportUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#76DFFF] transition hover:text-white"
            >
              <MessageCircle className="h-4 w-4" />
              Falar com suporte: {supportWhatsappDisplay}
            </a>
          </section>

          <section className="w-full min-w-0">
            <div className="w-full min-w-0 overflow-hidden rounded-lg border border-[#D5E4F2] bg-white text-[#05203C] shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
              <div className="h-1 bg-[linear-gradient(90deg,#0B5CAB_0%,#11C5D9_52%,#5F5CFF_100%)]" />
              <div className="p-6 sm:p-8">
                <div className="mb-6">
                  <h2 className="text-2xl font-extrabold tracking-normal text-[#25314B]">Começar teste grátis</h2>
                  <p className="mt-2 max-w-full break-words text-sm leading-6 text-[#65758B]">
                    O checkout confirma a assinatura com 7 dias sem cobrança.
                  </p>
                </div>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="organizationName"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-sm font-bold text-[#354258]">Instituição</FormLabel>
                            <FormControl>
                              <Input {...field} className={inputClassName} placeholder="Nome da instituição" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="cnpj"
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
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-bold text-[#354258]">WhatsApp</FormLabel>
                            <FormControl>
                              <Input {...field} className={inputClassName} placeholder="(19) 99999-9999" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-sm font-bold text-[#354258]">E-mail</FormLabel>
                            <FormControl>
                              <Input {...field} type="email" className={inputClassName} placeholder="contato@instituicao.com.br" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="adminName"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-sm font-bold text-[#354258]">Seu nome</FormLabel>
                            <FormControl>
                              <Input {...field} className={inputClassName} placeholder="Responsável pela conta" />
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
                              <Input {...field} className={inputClassName} placeholder="admin" autoComplete="username" />
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
                            <FormLabel className="text-sm font-bold text-[#354258]">Senha</FormLabel>
                            <FormControl>
                              <Input {...field} type="password" className={inputClassName} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="confirmPassword"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-sm font-bold text-[#354258]">Confirmar senha</FormLabel>
                            <FormControl>
                              <Input {...field} type="password" className={inputClassName} placeholder="Digite a senha novamente" autoComplete="new-password" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={signupMutation.isPending}
                      className="h-12 w-full rounded-md border border-[#0A559F] bg-[#0B5CAB] font-bold text-white shadow-[0_12px_24px_rgba(11,92,171,0.18)] transition hover:bg-[#084B8A]"
                    >
                      {signupMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Preparando checkout...
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-4 w-4" />
                          Ativar 7 dias grátis
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>
                </Form>
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
            <Link href="/termos" className="transition hover:text-white">Termos</Link>
            <Link href="/privacidade" className="transition hover:text-white">Privacidade</Link>
            <a href={supportUrl} target="_blank" rel="noreferrer" className="transition hover:text-white">
              WhatsApp
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
