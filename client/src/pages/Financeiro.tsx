import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useResidents } from "@/hooks/use-residents";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DollarSign, FileText, Plus, TrendingUp, AlertCircle, CheckCircle2,
  Clock, User, Trash2, Pencil
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Contract, MonthlyFee } from "@shared/schema";

const PLAN_LABELS: Record<string, string> = {
  standard: "Standard",
  premium: "Premium",
  vip: "VIP",
};

const STATUS_FEE: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pendente", color: "#F59E0B", bg: "#FEF3C7" },
  paid: { label: "Pago", color: "#22C55E", bg: "#DCFCE7" },
  overdue: { label: "Em Atraso", color: "#EF4444", bg: "#FEE2E2" },
  cancelled: { label: "Cancelado", color: "#6B7280", bg: "#F3F4F6" },
};

const STATUS_CONTRACT: Record<string, { label: string; color: string }> = {
  active: { label: "Ativo", color: "#22C55E" },
  suspended: { label: "Suspenso", color: "#F59E0B" },
  terminated: { label: "Encerrado", color: "#EF4444" },
};

const contractSchema = z.object({
  residentId: z.coerce.number().min(1, "Residente obrigatório"),
  plan: z.enum(["standard", "premium", "vip"]),
  monthlyValue: z.coerce.number().min(1, "Valor obrigatório"),
  startDate: z.string().min(1, "Data obrigatória"),
  endDate: z.string().optional(),
  paymentDay: z.coerce.number().min(1).max(31).default(5),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
});

const feeSchema = z.object({
  contractId: z.coerce.number().min(1, "Contrato obrigatório"),
  residentId: z.coerce.number().min(1),
  referenceMonth: z.string().min(1, "Mês obrigatório"),
  dueDate: z.string().min(1, "Vencimento obrigatório"),
  amount: z.coerce.number().min(1, "Valor obrigatório"),
  discount: z.coerce.number().default(0),
  fine: z.coerce.number().default(0),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]).default("pending"),
  notes: z.string().optional(),
});

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function KpiCard({ title, value, sub, icon: Icon, color }: any) {
  return (
    <div className="bg-card rounded-2xl border border-border/60 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: `${color}18` }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export default function Financeiro() {
  const [contractOpen, setContractOpen] = useState(false);
  const [feeOpen, setFeeOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<(Contract & { residentName?: string }) | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { data: residents = [] } = useResidents({ status: "active" });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery<(Contract & { residentName?: string })[]>({
    queryKey: ["/api/contracts"],
    queryFn: async () => {
      const res = await fetch("/api/contracts", { credentials: "include" });
      return res.json();
    },
  });

  const { data: fees = [], isLoading: feesLoading } = useQuery<(MonthlyFee & { residentName?: string })[]>({
    queryKey: ["/api/monthly-fees"],
    queryFn: async () => {
      const res = await fetch("/api/monthly-fees", { credentials: "include" });
      return res.json();
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function effectiveStatus(fee: any): string {
    if (fee.status === "pending" && fee.dueDate) {
      const due = new Date(fee.dueDate + "T00:00:00");
      if (due < today) return "overdue";
    }
    return fee.status;
  }

  const totalPendingFees = fees.filter(f => effectiveStatus(f) === "pending").reduce((acc, f) => acc + (f.amount ?? 0), 0);
  const totalOverdue = fees.filter(f => effectiveStatus(f) === "overdue").reduce((acc, f) => acc + (f.amount ?? 0), 0);
  const totalReceived = fees.filter(f => f.status === "paid").reduce((acc, f) => acc + (f.amount ?? 0), 0);
  const activeContracts = contracts.filter(c => c.status === "active").length;

  // Delete contract
  const deleteContract = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/contracts/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir contrato");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      toast({ title: "Contrato excluído" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir contrato" }),
  });

  // Update contract status
  const updateContractStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar contrato");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setEditingContract(null);
      toast({ title: "Contrato atualizado" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao atualizar contrato" }),
  });

  // Delete monthly fee
  const deleteMonthlyFee = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/monthly-fees/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir cobrança");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/monthly-fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Cobrança excluída" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir cobrança" }),
  });

  // Mark as paid
  const markPaid = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/monthly-fees/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid", paidAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/monthly-fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Mensalidade registrada como paga" });
    },
  });

  // Contract form
  const contractForm = useForm<z.infer<typeof contractSchema>>({
    resolver: zodResolver(contractSchema),
    defaultValues: { plan: "standard", paymentDay: 5, monthlyValue: 3200, startDate: new Date().toISOString().split("T")[0] },
  });

  const createContract = useMutation({
    mutationFn: async (data: z.infer<typeof contractSchema>) => {
      const res = await fetch("/api/contracts", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setContractOpen(false);
      contractForm.reset();
      toast({ title: "Contrato criado com sucesso" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao criar contrato" }),
  });

  // Fee form
  const feeForm = useForm<z.infer<typeof feeSchema>>({
    resolver: zodResolver(feeSchema),
    defaultValues: { status: "pending", discount: 0, fine: 0 },
  });

  const createFee = useMutation({
    mutationFn: async (data: z.infer<typeof feeSchema>) => {
      const res = await fetch("/api/monthly-fees", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/monthly-fees"] });
      setFeeOpen(false);
      feeForm.reset();
      toast({ title: "Cobrança criada" });
    },
  });

  // Watch contract ID to auto-fill resident
  const watchedContractId = feeForm.watch("contractId");
  const selectedContract = contracts.find((c) => c.id === Number(watchedContractId));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            Financeiro
          </h1>
          <p className="text-muted-foreground mt-1">Contratos, mensalidades e controle de pagamentos</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={contractOpen} onOpenChange={setContractOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-new-contract">
                <FileText className="h-4 w-4" />Novo Contrato
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Novo Contrato</DialogTitle></DialogHeader>
              <Form {...contractForm}>
                <form onSubmit={contractForm.handleSubmit((d) => createContract.mutate(d))} className="space-y-4">
                  <FormField control={contractForm.control} name="residentId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Residente *</FormLabel>
                      <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value?.toString() ?? ""}>
                        <FormControl><SelectTrigger data-testid="select-contract-resident"><SelectValue placeholder="Selecionar residente" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {residents.map((r: any) => (
                            <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={contractForm.control} name="plan" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Plano *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="premium">Premium</SelectItem>
                            <SelectItem value="vip">VIP</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={contractForm.control} name="monthlyValue" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor Mensal (R$) *</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} data-testid="input-monthly-value" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={contractForm.control} name="startDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Início *</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={contractForm.control} name="paymentDay" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Dia Vencimento</FormLabel>
                        <FormControl><Input type="number" min={1} max={31} {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={contractForm.control} name="paymentMethod" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Forma de Pagamento</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="pix">PIX</SelectItem>
                          <SelectItem value="boleto">Boleto</SelectItem>
                          <SelectItem value="debito_automatico">Débito Automático</SelectItem>
                          <SelectItem value="dinheiro">Dinheiro</SelectItem>
                          <SelectItem value="transferencia">Transferência</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={contractForm.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Observações</FormLabel>
                      <FormControl><Textarea rows={2} {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setContractOpen(false)}>Cancelar</Button>
                    <Button type="submit" disabled={createContract.isPending}>Criar Contrato</Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog open={feeOpen} onOpenChange={setFeeOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 btn-glow" data-testid="button-new-fee">
                <Plus className="h-4 w-4" />Nova Cobrança
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Lançar Mensalidade</DialogTitle></DialogHeader>
              <Form {...feeForm}>
                <form onSubmit={feeForm.handleSubmit((d) => createFee.mutate(d))} className="space-y-4">
                  <FormField control={feeForm.control} name="contractId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contrato *</FormLabel>
                      <Select onValueChange={(v) => {
                        field.onChange(Number(v));
                        const c = contracts.find(ct => ct.id === Number(v));
                        if (c) {
                          feeForm.setValue("residentId", c.residentId);
                          feeForm.setValue("amount", c.monthlyValue ?? 0);
                        }
                      }} value={field.value?.toString() ?? ""}>
                        <FormControl><SelectTrigger data-testid="select-fee-contract"><SelectValue placeholder="Selecionar contrato" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {contracts.filter(c => c.status === "active").map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.residentName} — {PLAN_LABELS[c.plan ?? "standard"]} ({formatCurrency(c.monthlyValue ?? 0)}/mês)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={feeForm.control} name="referenceMonth" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mês Referência *</FormLabel>
                        <FormControl><Input type="month" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={feeForm.control} name="dueDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vencimento *</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={feeForm.control} name="amount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor (R$)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={feeForm.control} name="discount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Desconto</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={feeForm.control} name="fine" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Multa</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={feeForm.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Observações</FormLabel>
                      <FormControl><Textarea rows={2} {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setFeeOpen(false)}>Cancelar</Button>
                    <Button type="submit" disabled={createFee.isPending}>Lançar</Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Contratos Ativos" value={activeContracts} sub="residentes com contrato" icon={FileText} color="#1F6FEB" />
        <KpiCard title="A Receber" value={formatCurrency(totalPendingFees)} sub="mensalidades pendentes" icon={Clock} color="#F59E0B" />
        <KpiCard title="Em Atraso" value={formatCurrency(totalOverdue)} sub="requerem atenção" icon={AlertCircle} color="#EF4444" />
        <KpiCard title="Recebido" value={formatCurrency(totalReceived)} sub="histórico de pagamentos" icon={TrendingUp} color="#22C55E" />
      </div>

      <Tabs defaultValue="fees">
        <TabsList>
          <TabsTrigger value="fees" data-testid="tab-fees">
            <DollarSign className="h-3.5 w-3.5 mr-1.5" />Mensalidades
          </TabsTrigger>
          <TabsTrigger value="contracts" data-testid="tab-contracts">
            <FileText className="h-3.5 w-3.5 mr-1.5" />Contratos
          </TabsTrigger>
        </TabsList>

        {/* FEES TAB */}
        <TabsContent value="fees" className="mt-4">
          {feesLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)}</div>
          ) : fees.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <DollarSign className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p>Nenhuma cobrança lançada.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {fees.map((fee: any) => {
                const eff = effectiveStatus(fee);
                const s = STATUS_FEE[eff] ?? { label: eff, color: "#888", bg: "#F3F4F6" };
                const total = (fee.amount ?? 0) + (fee.fine ?? 0) - (fee.discount ?? 0);
                return (
                  <div key={fee.id} className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-4" data-testid={`fee-${fee.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-foreground text-sm">{fee.residentName}</p>
                        <Badge className="text-xs" style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}30` }}>
                          {s.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Referência: {fee.referenceMonth} · Vencimento: {fee.dueDate ? format(new Date(fee.dueDate + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                      </p>
                      {fee.paidAt && (
                        <p className="text-xs text-green-600 mt-0.5">
                          Pago em {format(new Date(fee.paidAt), "dd/MM/yyyy", { locale: ptBR })}
                          {fee.paymentMethod && ` · ${fee.paymentMethod}`}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-foreground">{formatCurrency(total)}</p>
                      {(fee.discount ?? 0) > 0 && <p className="text-xs text-green-600">-{formatCurrency(fee.discount)} desconto</p>}
                      {(fee.fine ?? 0) > 0 && <p className="text-xs text-red-600">+{formatCurrency(fee.fine)} multa</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(eff === "pending" || eff === "overdue") && (
                        <Button size="sm" variant="outline" className="gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                          onClick={() => markPaid.mutate(fee.id)}
                          disabled={markPaid.isPending}
                          data-testid={`button-pay-${fee.id}`}
                        >
                          <CheckCircle2 className="h-4 w-4" />Registrar Pagamento
                        </Button>
                      )}
                      <Button
                        size="sm" variant="ghost"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                        disabled={deleteMonthlyFee.isPending}
                        onClick={() => {
                          confirm({
                            title: "Excluir cobrança",
                            description: `Excluir esta cobrança de ${fee.residentName}?`,
                            confirmText: "Excluir",
                            pendingText: "Excluindo...",
                            variant: "destructive",
                            onConfirm: () => deleteMonthlyFee.mutateAsync(fee.id),
                          });
                        }}
                        data-testid={`button-delete-fee-${fee.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* CONTRACTS TAB */}
        <TabsContent value="contracts" className="mt-4">
          {contractsLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)}</div>
          ) : contracts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p>Nenhum contrato cadastrado.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {contracts.map((c: any) => {
                const s = STATUS_CONTRACT[c.status] ?? { label: c.status, color: "#888" };
                return (
                  <div key={c.id} className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-4" data-testid={`contract-${c.id}`}>
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#1F6FEB18" }}>
                      <User className="h-4 w-4" style={{ color: "#1F6FEB" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <p className="font-semibold text-foreground text-sm">{c.residentName}</p>
                        <Badge className="text-xs" style={{ color: s.color, border: `1px solid ${s.color}30`, background: `${s.color}10` }}>
                          {s.label}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">{PLAN_LABELS[c.plan ?? "standard"]}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Desde {c.startDate ? format(new Date(c.startDate + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                        {c.paymentDay && ` · Vence dia ${c.paymentDay}`}
                        {c.paymentMethod && ` · ${c.paymentMethod}`}
                      </p>
                      {c.notes && <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{c.notes}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xl font-bold text-foreground">{formatCurrency(c.monthlyValue ?? 0)}</p>
                      <p className="text-xs text-muted-foreground">por mês</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setEditingContract(c)}
                        data-testid={`button-edit-contract-${c.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        disabled={deleteContract.isPending}
                        onClick={() => {
                          confirm({
                            title: "Excluir contrato",
                            description: `Excluir contrato de ${c.residentName}? Esta ação não pode ser desfeita.`,
                            confirmText: "Excluir",
                            pendingText: "Excluindo...",
                            variant: "destructive",
                            onConfirm: () => deleteContract.mutateAsync(c.id),
                          });
                        }}
                        data-testid={`button-delete-contract-${c.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit contract status dialog */}
      <Dialog open={!!editingContract} onOpenChange={(o) => { if (!o) setEditingContract(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar Status do Contrato</DialogTitle>
          </DialogHeader>
          {editingContract && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Contrato de <strong>{editingContract.residentName}</strong> — Plano {PLAN_LABELS[editingContract.plan ?? "standard"]}
              </p>
              <div className="space-y-2">
                {(["active", "suspended", "terminated"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-sm font-medium transition-all ${
                      editingContract.status === s
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/50 text-foreground"
                    }`}
                    onClick={() => updateContractStatus.mutate({ id: editingContract.id, status: s })}
                    disabled={updateContractStatus.isPending}
                    data-testid={`contract-status-${s}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: STATUS_CONTRACT[s]?.color }} />
                    {STATUS_CONTRACT[s]?.label}
                    {editingContract.status === s && <span className="ml-auto text-xs text-primary">Atual</span>}
                  </button>
                ))}
              </div>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setEditingContract(null)}>Fechar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
