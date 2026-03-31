import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMedications, useCreateMedication, useUpdateMedication } from "@/hooks/use-medications";
import { useResidents } from "@/hooks/use-residents";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pill, Trash2, ClipboardCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { medicationFormSchema, type MedicationFormInput, type Medication } from "@shared/schema";
import { z } from "zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_ADMIN: Record<string, { label: string; color: string; bg: string }> = {
  given:   { label: "Administrado", color: "#22C55E", bg: "#DCFCE7" },
  skipped: { label: "Omitido",      color: "#F59E0B", bg: "#FEF3C7" },
  refused: { label: "Recusado",     color: "#EF4444", bg: "#FEE2E2" },
  late:    { label: "Atrasado",     color: "#8B5CF6", bg: "#EDE9FE" },
};

const adminSchema = z.object({
  medicationId: z.coerce.number().min(1, "Medicamento obrigatório"),
  status: z.enum(["given", "skipped", "refused", "late"]).default("given"),
  notes: z.string().optional(),
});

type MedicationWithResident = Medication & { residentName?: string };

export default function Medications() {
  const { data: medications, isLoading } = useMedications();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAdminDialogOpen, setIsAdminDialogOpen] = useState(false);
  const [editingMedication, setEditingMedication] = useState<MedicationWithResident | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: administrations = [], isLoading: adminsLoading } = useQuery<any[]>({
    queryKey: ["/api/medication-administrations"],
    queryFn: async () => {
      const res = await fetch("/api/medication-administrations", { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao carregar administrações");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/medications/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir medicamento");
    },
    onSuccess: () => {
      toast({ title: "Medicamento excluído" });
      queryClient.invalidateQueries({ queryKey: ["/api/medications"] });
    },
    onError: () => {
      toast({ title: "Erro ao excluir", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground">Medicações</h1>
          <p className="text-muted-foreground mt-1">Controle de prescrições e administrações.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsAdminDialogOpen(true)} className="gap-2" data-testid="button-new-administration">
            <ClipboardCheck className="h-4 w-4" />Registrar Administração
          </Button>
          <Button onClick={() => { setEditingMedication(null); setIsDialogOpen(true); }} className="shadow-lg shadow-primary/20" data-testid="button-new-medication">
            <Plus className="mr-2 h-4 w-4" /> Nova Prescrição
          </Button>
        </div>
      </div>

      <Tabs defaultValue="prescriptions">
        <TabsList>
          <TabsTrigger value="prescriptions" data-testid="tab-prescriptions">
            <Pill className="h-3.5 w-3.5 mr-1.5" />Prescrições
          </TabsTrigger>
          <TabsTrigger value="administrations" data-testid="tab-administrations">
            <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />Administrações
          </TabsTrigger>
        </TabsList>

        {/* PRESCRIPTIONS TAB */}
        <TabsContent value="prescriptions" className="mt-4">
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Residente</TableHead>
                  <TableHead>Medicamento</TableHead>
                  <TableHead>Dose</TableHead>
                  <TableHead>Frequência</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : medications?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Nenhuma medicação cadastrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  medications?.map((med) => (
                    <TableRow key={med.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium">{med.residentName || "N/A"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary">
                            <Pill className="h-4 w-4" />
                          </div>
                          {med.name}
                        </div>
                      </TableCell>
                      <TableCell>{med.dosage}</TableCell>
                      <TableCell>{med.frequency}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border
                          ${med.status === 'active'
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-neutral-100 text-neutral-600 border-neutral-200'
                          }`}>
                          {med.status === 'active' ? 'Ativo' : 'Suspenso'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => { setEditingMedication(med); setIsDialogOpen(true); }}
                            data-testid={`button-edit-medication-${med.id}`}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (confirm(`Excluir "${med.name}" de ${med.residentName || "residente"}? Esta ação não pode ser desfeita.`)) {
                                deleteMutation.mutate(med.id);
                              }
                            }}
                            data-testid={`button-delete-medication-${med.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ADMINISTRATIONS TAB */}
        <TabsContent value="administrations" className="mt-4">
          {adminsLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>
          ) : administrations.length === 0 ? (
            <div className="text-center py-16 border border-dashed rounded-xl border-muted-foreground/30">
              <ClipboardCheck className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">Nenhuma administração registrada</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Clique em "Registrar Administração" para iniciar o controle</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Residente</TableHead>
                    <TableHead>Medicamento</TableHead>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Observações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {administrations.map((adm: any) => {
                    const s = STATUS_ADMIN[adm.status] ?? { label: adm.status, color: "#888", bg: "#F3F4F6" };
                    const med = medications?.find(m => m.id === adm.medicationId);
                    return (
                      <TableRow key={adm.id} data-testid={`admin-${adm.id}`}>
                        <TableCell className="font-medium">{adm.residentName || med?.residentName || "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Pill className="h-4 w-4 text-primary" />
                            {med?.name ?? `Medicamento #${adm.medicationId}`}
                            {med && <span className="text-xs text-muted-foreground">{med.dosage}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {adm.administeredAt
                            ? format(new Date(adm.administeredAt), "dd/MM/yyyy HH:mm", { locale: ptBR })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className="text-xs" style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}30` }}>
                            {s.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {adm.notes || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <MedicationDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        medication={editingMedication}
      />

      <AdminDialog
        open={isAdminDialogOpen}
        onOpenChange={setIsAdminDialogOpen}
        medications={medications ?? []}
      />
    </div>
  );
}

function MedicationDialog({
  open,
  onOpenChange,
  medication,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medication: MedicationWithResident | null;
}) {
  const createMutation = useCreateMedication();
  const updateMutation = useUpdateMedication();
  const { data: residents } = useResidents({ status: 'active' });

  const formSchema = medicationFormSchema.extend({
    residentId: z.coerce.number()
  });
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      residentId: 0,
      name: "",
      dosage: "",
      frequency: "",
      status: "active"
    },
  });

  useEffect(() => {
    if (!open) return;

    if (medication) {
      form.reset(medication);
      return;
    }

    form.reset({
      residentId: 0,
      name: "",
      dosage: "",
      frequency: "",
      status: "active",
    });
  }, [open, medication, form]);

  function onSubmit(data: z.infer<typeof formSchema>) {
    if (medication) {
      updateMutation.mutate({ id: medication.id, ...data }, {
        onSuccess: () => onOpenChange(false)
      });
    } else {
      createMutation.mutate(data, {
        onSuccess: () => onOpenChange(false)
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{medication ? "Editar Prescrição" : "Nova Prescrição"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="residentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Residente</FormLabel>
                  <Select 
                    onValueChange={(val) => field.onChange(Number(val))} 
                    value={field.value ? String(field.value) : undefined}
                    disabled={!!medication}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o residente" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {residents?.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Medicamento</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Losartana" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="dosage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dosagem</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 50mg" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequência</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 8/8h" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="suspended">Suspenso</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {medication ? "Salvar" : "Adicionar"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function AdminDialog({ open, onOpenChange, medications }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medications: MedicationWithResident[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof adminSchema>>({
    resolver: zodResolver(adminSchema),
    defaultValues: { status: "given", notes: "" },
  });

  const createAdmin = useMutation({
    mutationFn: async (data: z.infer<typeof adminSchema>) => {
      const med = medications.find(m => m.id === data.medicationId);
      const body = {
        ...data,
        residentId: med?.residentId ?? 0,
        administeredAt: new Date().toISOString(),
      };
      const res = await fetch("/api/medication-administrations", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Erro ao registrar administração");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medication-administrations"] });
      toast({ title: "Administração registrada com sucesso" });
      form.reset({ status: "given", notes: "" });
      onOpenChange(false);
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao registrar administração" }),
  });

  const watchedMedId = form.watch("medicationId");
  const selectedMed = medications.find(m => m.id === Number(watchedMedId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Administração</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => createAdmin.mutate(d))} className="space-y-4">
            <FormField
              control={form.control}
              name="medicationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Medicamento *</FormLabel>
                  <Select
                    onValueChange={(v) => {
                      field.onChange(Number(v));
                    }}
                    value={field.value ? String(field.value) : undefined}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-admin-medication">
                        <SelectValue placeholder="Selecionar medicamento ativo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {medications.filter(m => m.status === "active").map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.residentName} — {m.name} {m.dosage}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                  {selectedMed && (
                    <p className="text-xs text-muted-foreground">
                      Frequência: {selectedMed.frequency}
                    </p>
                  )}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status da Administração *</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {(["given", "skipped", "refused", "late"] as const).map((s) => {
                      const info = STATUS_ADMIN[s];
                      return (
                        <button
                          key={s}
                          type="button"
                          className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${
                            field.value === s
                              ? "border-2 text-foreground"
                              : "border-border hover:border-border/80 text-muted-foreground"
                          }`}
                          style={field.value === s ? { borderColor: info.color, background: info.bg } : {}}
                          onClick={() => field.onChange(s)}
                          data-testid={`admin-status-${s}`}
                        >
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: info.color }} />
                          {info.label}
                        </button>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Ex: Paciente relatou náusea..." {...field} data-testid="textarea-admin-notes" />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={createAdmin.isPending}>
                {createAdmin.isPending ? "Salvando..." : "Registrar"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
