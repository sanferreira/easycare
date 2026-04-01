import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOccurrences, useCreateOccurrence, useDeleteOccurrence } from "@/hooks/use-occurrences";
import { useResidents } from "@/hooks/use-residents";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card";
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
import { Plus, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { occurrenceFormSchema, type OccurrenceFormInput } from "@shared/schema";
import { z } from "zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Occurrences() {
  const { data: occurrences, isLoading } = useOccurrences();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteOccurrence();

  const resolveMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: number; newStatus: string }) => {
      const body: Record<string, unknown> = { status: newStatus };
      if (newStatus === "resolved") body.resolvedAt = new Date().toISOString();
      const res = await fetch(`/api/occurrences/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Erro ao atualizar ocorrência");
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: vars.newStatus === "resolved" ? "Ocorrência resolvida" : "Ocorrência reaberta" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao atualizar ocorrência" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground">Ocorrências</h1>
          <p className="text-muted-foreground mt-1">Registro de eventos e intercorrências.</p>
        </div>
        <Button onClick={() => setIsDialogOpen(true)} variant="destructive" className="shadow-lg shadow-destructive/20">
          <AlertTriangle className="mr-2 h-4 w-4" /> Nova Ocorrência
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
           [1, 2, 3].map((i) => <div key={i} className="h-40 bg-muted/50 rounded-xl animate-pulse"></div>)
        ) : occurrences?.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-muted-foreground/30">
            Nenhuma ocorrência registrada.
          </div>
        ) : (
          occurrences?.map((occ: any) => (
            <Card key={occ.id} className={`border-border shadow-sm hover:shadow-md transition-shadow ${occ.status === 'resolved' ? 'opacity-70' : ''}`} data-testid={`occurrence-${occ.id}`}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      {occ.type}
                      {occ.status === 'resolved' && (
                        <span className="text-xs font-normal text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />Resolvida
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription>{occ.residentName}</CardDescription>
                  </div>
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold shrink-0
                    ${occ.severity === 'high' 
                      ? 'bg-red-100 text-red-700' 
                      : occ.severity === 'medium'
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-blue-100 text-blue-700'
                    }`}>
                    {occ.severity === 'high' ? 'Grave' : occ.severity === 'medium' ? 'Moderada' : 'Leve'}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground mb-4 line-clamp-3">{occ.description}</p>
                <div className="text-xs text-muted-foreground flex justify-between items-center border-t border-border pt-3">
                  <span>{occ.createdAt && format(new Date(occ.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm" variant="ghost"
                      className={`h-7 text-xs gap-1 ${occ.status === 'resolved' ? 'text-muted-foreground hover:text-foreground' : 'text-green-700 hover:bg-green-50 hover:text-green-800'}`}
                      disabled={resolveMutation.isPending || deleteMutation.isPending}
                      onClick={() => resolveMutation.mutate({ id: occ.id, newStatus: occ.status === 'resolved' ? 'open' : 'resolved' })}
                      data-testid={`button-resolve-${occ.id}`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {occ.status === 'resolved' ? "Reabrir" : "Resolver"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={deleteMutation.isPending || resolveMutation.isPending}
                      onClick={() => {
                        if (window.confirm("Tem certeza que deseja excluir esta ocorrência?")) {
                          deleteMutation.mutate(Number(occ.id));
                        }
                      }}
                      data-testid={`button-delete-occurrence-${occ.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <OccurrenceDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
      />
    </div>
  );
}

function OccurrenceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createMutation = useCreateOccurrence();
  const { data: residents } = useResidents({ status: 'active' });

  const formSchema = occurrenceFormSchema.extend({
    residentId: z.coerce.number()
  });
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      residentId: 0,
      type: "Saúde",
      description: "",
      severity: "low"
    },
  });

  function onSubmit(data: z.infer<typeof formSchema>) {
    createMutation.mutate(data, {
      onSuccess: () => {
        form.reset();
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova Ocorrência</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="residentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Residente Envolvido</FormLabel>
                  <Select 
                    onValueChange={(val) => field.onChange(Number(val))} 
                    value={field.value ? String(field.value) : undefined}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione..." />
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Saúde">Saúde</SelectItem>
                        <SelectItem value="Queda">Queda</SelectItem>
                        <SelectItem value="Comportamento">Comportamento</SelectItem>
                        <SelectItem value="Social">Social</SelectItem>
                        <SelectItem value="Outro">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gravidade</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Gravidade" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Leve</SelectItem>
                        <SelectItem value="medium">Moderada</SelectItem>
                        <SelectItem value="high">Grave</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição Detalhada</FormLabel>
                  <FormControl>
                    <Textarea placeholder="O que aconteceu?" className="resize-none" rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={createMutation.isPending}>
                Registrar Ocorrência
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
