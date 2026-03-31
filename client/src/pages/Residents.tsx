import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useResidents, useCreateResident, useUpdateResident } from "@/hooks/use-residents";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AdmissaoWizard from "@/components/AdmissaoWizard";
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
  DialogTrigger,
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
import { Plus, Search, Trash2, Phone, Bed } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { residentFormSchema, type ResidentFormInput, type Resident } from "@shared/schema";
import { format } from "date-fns";

export default function Residents() {
  const [search, setSearch] = useState("");
  const { data: residents, isLoading } = useResidents({ search });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const filteredResidents = residents?.filter(r => 
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/residents/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir residente");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Residente excluído" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir residente" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground">Residentes</h1>
          <p className="text-muted-foreground mt-1">Gerencie os idosos acolhidos na instituição.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setEditingResident(null); setIsDialogOpen(true); }} data-testid="button-new-resident">
            <Plus className="mr-2 h-4 w-4" /> Cadastro Rápido
          </Button>
          <Button onClick={() => setIsWizardOpen(true)} className="shadow-lg shadow-primary/20 gap-2" data-testid="button-nova-admissao">
            <Plus className="h-4 w-4" /> Nova Admissão
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-card p-4 rounded-xl border border-border shadow-sm">
        <Search className="h-5 w-5 text-muted-foreground" />
        <Input 
          placeholder="Buscar por nome..." 
          value={search} 
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 focus-visible:ring-0 bg-transparent px-0 text-base"
        />
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[300px]">Nome</TableHead>
              <TableHead>Quarto</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : filteredResidents?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Nenhum residente encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filteredResidents?.map((resident) => (
                <TableRow key={resident.id} className="hover:bg-muted/50 transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-secondary text-primary flex items-center justify-center font-bold">
                        {resident.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium">{resident.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(resident.birthDate), "dd/MM/yyyy")}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <Bed className="h-4 w-4 text-muted-foreground" />
                      {resident.roomNumber}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <p className="font-medium">{resident.contactName}</p>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {resident.contactPhone}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border
                      ${resident.status === 'active' 
                        ? 'bg-green-50 text-green-700 border-green-200' 
                        : resident.status === 'deceased'
                        ? 'bg-neutral-100 text-neutral-600 border-neutral-200'
                        : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                      }`}>
                      {resident.status === 'active' ? 'Ativo' : resident.status === 'deceased' ? 'Falecido' : 'Inativo'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setEditingResident(resident); setIsDialogOpen(true); }} data-testid={`button-edit-resident-${resident.id}`}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (confirm(`Excluir "${resident.name}"? Esta ação não pode ser desfeita.`))
                            deleteMutation.mutate(resident.id);
                        }}
                        data-testid={`button-delete-resident-${resident.id}`}
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

      <ResidentDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        resident={editingResident}
      />
      <AdmissaoWizard open={isWizardOpen} onOpenChange={setIsWizardOpen} />
    </div>
  );
}

function ResidentDialog({ open, onOpenChange, resident }: { open: boolean; onOpenChange: (open: boolean) => void; resident: Resident | null }) {
  const createMutation = useCreateResident();
  const updateMutation = useUpdateResident();

  const defaultValues: ResidentFormInput = {
    name: "",
    birthDate: "",
    contactName: "",
    contactPhone: "",
    admissionDate: new Date().toISOString().split('T')[0],
    roomNumber: "",
    healthNotes: "",
    allergies: "",
    status: "active"
  };
  
  const form = useForm<ResidentFormInput>({
    resolver: zodResolver(residentFormSchema),
    defaultValues,
  });

  useEffect(() => {
    if (!open) return;

    if (resident) {
      form.reset({
        ...resident,
        birthDate: resident.birthDate ? new Date(resident.birthDate).toISOString().split('T')[0] : "",
        admissionDate: resident.admissionDate ? new Date(resident.admissionDate).toISOString().split('T')[0] : "",
      });
      return;
    }

    form.reset(defaultValues);
  }, [open, resident, form]);

  function onSubmit(data: ResidentFormInput) {
    if (resident) {
      updateMutation.mutate({ id: resident.id, ...data }, {
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{resident ? "Editar Residente" : "Novo Residente"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome Completo</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Nascimento</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="roomNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quarto/Leito</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="admissionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Admissão</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsável</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone Responsável</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="healthNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações de Saúde</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="allergies"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Alergias</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                      <SelectItem value="inactive">Inativo</SelectItem>
                      <SelectItem value="deceased">Falecido</SelectItem>
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
                {resident ? "Salvar Alterações" : "Cadastrar"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
