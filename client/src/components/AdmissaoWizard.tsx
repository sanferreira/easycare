import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  User, Users, FileText, CheckCircle2, ChevronRight, ChevronLeft,
  UserPlus, Phone, Calendar, Bed, Heart, DollarSign, CreditCard,
} from "lucide-react";
import { maskCpf, maskPhoneBR } from "@/lib/masks";

// ─── Schemas ────────────────────────────────────────────────────────────────

const step1Schema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  birthDate: z.string().min(1, "Data de nascimento obrigatória"),
  gender: z.string().optional(),
  nationality: z.string().optional(),
  cpf: z.string().optional(),
  roomNumber: z.string().optional(),
  admissionDate: z.string().min(1, "Data de admissão obrigatória"),
  healthNotes: z.string().optional(),
  allergies: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
});

const step2Schema = z.object({
  skip: z.boolean().default(false),
  name: z.string().optional(),
  relationship: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  isPrimary: z.boolean().default(true),
  portalAccess: z.boolean().default(false),
  portalUsername: z.string().optional(),
  portalPassword: z.string().optional(),
}).refine((d) => {
  if (d.skip) return true;
  if (!d.name || d.name.trim().length < 2) return false;
  if (!d.phone || d.phone.trim().length < 8) return false;
  return true;
}, { message: "Nome e telefone são obrigatórios", path: ["name"] })
  .refine((d) => {
    if (d.skip || !d.portalAccess) return true;
    return d.portalUsername && d.portalUsername.trim().length >= 3;
  }, { message: "Usuário de portal obrigatório (mín. 3 caracteres)", path: ["portalUsername"] });

const step3Schema = z.object({
  skip: z.boolean().default(false),
  plan: z.enum(["standard", "premium", "vip"]).optional(),
  monthlyValue: z.coerce.number().optional(),
  startDate: z.string().optional(),
  paymentDay: z.coerce.number().min(1).max(31).default(5),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
}).refine((d) => {
  if (d.skip) return true;
  if (!d.plan) return false;
  if (!d.monthlyValue || d.monthlyValue < 1) return false;
  if (!d.startDate) return false;
  return true;
}, { message: "Plano, valor e data de início são obrigatórios", path: ["plan"] });

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;
type Step3Data = z.infer<typeof step3Schema>;

// ─── Step indicator ─────────────────────────────────────────────────────────

const STEPS = [
  { label: "Residente", icon: User },
  { label: "Familiar", icon: Users },
  { label: "Contrato", icon: FileText },
  { label: "Conclusão", icon: CheckCircle2 },
];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                  done ? "bg-primary text-white" :
                  active ? "bg-primary/10 text-primary ring-2 ring-primary" :
                  "bg-muted text-muted-foreground"
                }`}
              >
                {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${active ? "text-primary" : "text-muted-foreground"}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mb-4 mx-1 ${i < current ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface AdmissaoWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AdmissaoWizard({ open, onOpenChange }: AdmissaoWizardProps) {
  const [step, setStep] = useState(0);
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null);
  const [step2Data, setStep2Data] = useState<Step2Data | null>(null);
  const [step3Data, setStep3Data] = useState<Step3Data | null>(null);
  const [createdResidentId, setCreatedResidentId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  function reset() {
    setStep(0);
    setStep1Data(null);
    setStep2Data(null);
    setStep3Data(null);
    setCreatedResidentId(null);
  }

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const createAll = useMutation({
    mutationFn: async ({ s1, s2, s3 }: { s1: Step1Data; s2: Step2Data; s3: Step3Data }) => {
      // 1. Create resident
      const resRes = await fetch("/api/residents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...s1, status: "active" }),
      });
      if (!resRes.ok) throw new Error("Erro ao criar residente");
      const resident = await resRes.json();
      const residentId: number = resident.id;

      // 2. Create family member (optional)
      if (!s2.skip && s2.name) {
        const famRes = await fetch(`/api/residents/${residentId}/family`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: s2.name,
            relationship: s2.relationship || "Familiar",
            phone: s2.phone,
            email: s2.email || undefined,
            isPrimary: s2.isPrimary,
            portalAccess: s2.portalAccess,
            portalUsername: s2.portalAccess ? s2.portalUsername : undefined,
            portalPassword: s2.portalAccess ? (s2.portalPassword || "familia123") : undefined,
          }),
        });
        if (!famRes.ok) throw new Error("Erro ao criar familiar");
      }

      // 3. Create contract (optional)
      if (!s3.skip && s3.plan && s3.monthlyValue && s3.startDate) {
        const ctrRes = await fetch("/api/contracts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            residentId,
            plan: s3.plan,
            monthlyValue: s3.monthlyValue,
            startDate: s3.startDate,
            paymentDay: s3.paymentDay,
            paymentMethod: s3.paymentMethod || undefined,
            notes: s3.notes || undefined,
            status: "active",
          }),
        });
        if (!ctrRes.ok) throw new Error("Erro ao criar contrato");
      }

      return residentId;
    },
    onSuccess: (residentId) => {
      setCreatedResidentId(residentId);
      queryClient.invalidateQueries({ queryKey: ["/api/residents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setStep(3);
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  // ─── Step 1 ────────────────────────────────────────────────────────────────

  function Step1() {
    const form = useForm<Step1Data>({
      resolver: zodResolver(step1Schema),
      defaultValues: step1Data || {
        name: "",
        birthDate: "",
        admissionDate: new Date().toISOString().split("T")[0],
        gender: "",
        nationality: "Brasileiro(a)",
        roomNumber: "",
        healthNotes: "",
        allergies: "",
        contactName: "",
        contactPhone: "",
      },
    });

    function onSubmit(data: Step1Data) {
      setStep1Data(data);
      setStep(1);
    }

    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Nome completo *</FormLabel>
                <FormControl><Input placeholder="Ex: Maria Aparecida da Silva" {...field} data-testid="wizard-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="birthDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Data de nascimento *</FormLabel>
                <FormControl><Input type="date" {...field} data-testid="wizard-birthdate" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="admissionDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Data de admissão *</FormLabel>
                <FormControl><Input type="date" {...field} data-testid="wizard-admission" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="gender" render={({ field }) => (
              <FormItem>
                <FormLabel>Gênero</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ""}>
                  <FormControl><SelectTrigger data-testid="wizard-gender"><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="Masculino">Masculino</SelectItem>
                    <SelectItem value="Feminino">Feminino</SelectItem>
                    <SelectItem value="Outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="roomNumber" render={({ field }) => (
              <FormItem>
                <FormLabel>Quarto / Leito</FormLabel>
                <FormControl><Input placeholder="Ex: 101-A" {...field} data-testid="wizard-room" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="cpf" render={({ field }) => (
              <FormItem>
                <FormLabel>CPF</FormLabel>
                <FormControl>
                  <Input
                    placeholder="000.000.000-00"
                    maxLength={14}
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(maskCpf(e.target.value))}
                    data-testid="wizard-cpf"
                  />
                </FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="nationality" render={({ field }) => (
              <FormItem>
                <FormLabel>Nacionalidade</FormLabel>
                <FormControl><Input placeholder="Brasileiro(a)" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="contactName" render={({ field }) => (
              <FormItem>
                <FormLabel>Nome do contato</FormLabel>
                <FormControl><Input placeholder="Ex: João Silva (Filho)" {...field} data-testid="wizard-contact-name" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="contactPhone" render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone do contato</FormLabel>
                <FormControl>
                  <Input
                    placeholder="(11) 99999-0000"
                    maxLength={15}
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(maskPhoneBR(e.target.value))}
                    data-testid="wizard-contact-phone"
                  />
                </FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="healthNotes" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Observações de saúde</FormLabel>
                <FormControl><Textarea placeholder="Diagnósticos, condições relevantes..." rows={2} {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="allergies" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Alergias</FormLabel>
                <FormControl><Input placeholder="Ex: Dipirona, Lactose" {...field} /></FormControl>
              </FormItem>
            )} />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" className="gap-2" data-testid="wizard-next-1">
              Próximo <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  // ─── Step 2 ────────────────────────────────────────────────────────────────

  function Step2() {
    const form = useForm<Step2Data>({
      resolver: zodResolver(step2Schema),
      defaultValues: step2Data || {
        skip: false,
        name: "",
        relationship: "",
        phone: "",
        email: "",
        isPrimary: true,
        portalAccess: false,
        portalUsername: "",
        portalPassword: "",
      },
    });

    const skip = form.watch("skip");
    const portalAccess = form.watch("portalAccess");

    function onSubmit(data: Step2Data) {
      setStep2Data(data);
      setStep(2);
    }

    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField control={form.control} name="skip" render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3 border border-border/50">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="wizard-skip-family" />
                </FormControl>
                <div>
                  <p className="text-sm font-medium">Pular este passo</p>
                  <p className="text-xs text-muted-foreground">Você pode adicionar familiares depois no Prontuário</p>
                </div>
              </div>
            </FormItem>
          )} />

          {!skip && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Nome do familiar *</FormLabel>
                  <FormControl><Input placeholder="Ex: Ana Silva" {...field} data-testid="wizard-family-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="relationship" render={({ field }) => (
                <FormItem>
                  <FormLabel>Parentesco</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl><SelectTrigger data-testid="wizard-relationship"><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["Filho(a)", "Cônjuge", "Neto(a)", "Irmão/Irmã", "Sobrinho(a)", "Responsável legal", "Outro"].map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="(11) 99999-0000"
                      maxLength={15}
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(maskPhoneBR(e.target.value))}
                      data-testid="wizard-family-phone"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>E-mail</FormLabel>
                  <FormControl><Input type="email" placeholder="familiar@email.com" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="portalAccess" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <div className="flex items-center gap-3 bg-primary/5 rounded-xl p-3 border border-primary/20">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="wizard-portal-access" />
                    </FormControl>
                    <div>
                      <p className="text-sm font-medium text-primary">Acesso ao Portal Familiar</p>
                      <p className="text-xs text-muted-foreground">Libera login no portal para acompanhar o residente</p>
                    </div>
                  </div>
                </FormItem>
              )} />
              {portalAccess && (
                <>
                  <FormField control={form.control} name="portalUsername" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usuário de acesso *</FormLabel>
                      <FormControl><Input placeholder="Ex: ana.silva" {...field} data-testid="wizard-portal-user" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="portalPassword" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Senha (padrão: familia123)</FormLabel>
                      <FormControl><Input placeholder="familia123" {...field} /></FormControl>
                    </FormItem>
                  )} />
                </>
              )}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(0)} className="gap-2" data-testid="wizard-back-2">
              <ChevronLeft className="h-4 w-4" /> Voltar
            </Button>
            <Button type="submit" className="gap-2" data-testid="wizard-next-2">
              Próximo <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  // ─── Step 3 ────────────────────────────────────────────────────────────────

  function Step3() {
    const form = useForm<Step3Data>({
      resolver: zodResolver(step3Schema),
      defaultValues: step3Data || {
        skip: false,
        plan: undefined,
        monthlyValue: undefined,
        startDate: step1Data?.admissionDate || new Date().toISOString().split("T")[0],
        paymentDay: 5,
        paymentMethod: "",
        notes: "",
      },
    });

    const skip = form.watch("skip");

    function onSubmit(data: Step3Data) {
      if (!step1Data) return;
      setStep3Data(data);
      createAll.mutate({ s1: step1Data, s2: step2Data!, s3: data });
    }

    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField control={form.control} name="skip" render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3 border border-border/50">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="wizard-skip-contract" />
                </FormControl>
                <div>
                  <p className="text-sm font-medium">Pular este passo</p>
                  <p className="text-xs text-muted-foreground">Você pode criar o contrato depois no Financeiro</p>
                </div>
              </div>
            </FormItem>
          )} />

          {!skip && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="plan" render={({ field }) => (
                <FormItem>
                  <FormLabel>Plano *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl><SelectTrigger data-testid="wizard-plan"><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="premium">Premium</SelectItem>
                      <SelectItem value="vip">VIP</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="monthlyValue" render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor mensal (R$) *</FormLabel>
                  <FormControl><Input type="number" min={0} step={0.01} placeholder="3200" {...field} data-testid="wizard-value" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="startDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Início do contrato *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="paymentDay" render={({ field }) => (
                <FormItem>
                  <FormLabel>Dia de vencimento</FormLabel>
                  <FormControl><Input type="number" min={1} max={31} {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Forma de pagamento</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl><SelectTrigger data-testid="wizard-payment"><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="boleto">Boleto</SelectItem>
                      <SelectItem value="pix">PIX</SelectItem>
                      <SelectItem value="transferencia">Transferência</SelectItem>
                      <SelectItem value="cartao">Cartão</SelectItem>
                      <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Observações do contrato</FormLabel>
                  <FormControl><Textarea rows={2} placeholder="Observações sobre serviços, condições especiais..." {...field} /></FormControl>
                </FormItem>
              )} />
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)} className="gap-2" data-testid="wizard-back-3">
              <ChevronLeft className="h-4 w-4" /> Voltar
            </Button>
            <Button type="submit" className="gap-2" disabled={createAll.isPending} data-testid="wizard-finish">
              {createAll.isPending ? "Salvando..." : "Concluir admissão"} <CheckCircle2 className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  // ─── Step 4 — Confirmação ──────────────────────────────────────────────────

  function Step4() {
    const PLAN_LABEL: Record<string, string> = { standard: "Standard", premium: "Premium", vip: "VIP" };
    return (
      <div className="text-center space-y-6 py-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-foreground">Admissão concluída!</h3>
          <p className="text-sm text-muted-foreground">O residente foi cadastrado com sucesso.</p>
        </div>

        <div className="text-left space-y-3 bg-muted/40 rounded-2xl p-4 border border-border/50">
          {step1Data && (
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Residente</p>
                <p className="font-semibold text-foreground">{step1Data.name}</p>
                {step1Data.roomNumber && <p className="text-xs text-muted-foreground">Quarto {step1Data.roomNumber}</p>}
              </div>
            </div>
          )}
          {step2Data && !step2Data.skip && step2Data.name && (
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Users className="h-4 w-4 text-cyan-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Familiar</p>
                <p className="font-semibold text-foreground">{step2Data.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground">{step2Data.relationship || "Familiar"}</p>
                  {step2Data.portalAccess && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Portal ativo</Badge>
                  )}
                </div>
              </div>
            </div>
          )}
          {step2Data?.skip && (
            <div className="flex items-start gap-3 opacity-50">
              <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Familiar</p>
                <p className="text-sm text-muted-foreground italic">Não cadastrado</p>
              </div>
            </div>
          )}
          {step3Data && !step3Data.skip && step3Data.plan && (
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <DollarSign className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Contrato</p>
                <p className="font-semibold text-foreground">
                  Plano {PLAN_LABEL[step3Data.plan]} — R$ {step3Data.monthlyValue?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/mês
                </p>
                {step3Data.paymentMethod && (
                  <p className="text-xs text-muted-foreground capitalize">{step3Data.paymentMethod} · venc. dia {step3Data.paymentDay}</p>
                )}
              </div>
            </div>
          )}
          {step3Data?.skip && (
            <div className="flex items-start gap-3 opacity-50">
              <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Contrato</p>
                <p className="text-sm text-muted-foreground italic">Não cadastrado</p>
              </div>
            </div>
          )}
        </div>

        <Button className="w-full gap-2" onClick={handleClose} data-testid="wizard-done">
          <CheckCircle2 className="h-4 w-4" /> Fechar
        </Button>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5 text-primary" />
            Nova Admissão
          </DialogTitle>
        </DialogHeader>

        <StepBar current={step} />

        {step === 0 && <Step1 />}
        {step === 1 && <Step2 />}
        {step === 2 && <Step3 />}
        {step === 3 && <Step4 />}
      </DialogContent>
    </Dialog>
  );
}
