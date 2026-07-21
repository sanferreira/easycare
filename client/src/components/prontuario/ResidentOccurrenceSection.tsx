import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchJsonOrThrow } from "@/lib/fetch-json";
import type { Occurrence } from "@shared/schema";

type OccurrenceWithResident = Occurrence & { residentName?: string };

const occurrenceSchema = z.object({
  type: z.string().min(2, "Tipo obrigatorio"),
  description: z.string().min(5, "Descricao obrigatoria"),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
  status: z.enum(["open", "in_progress", "resolved"]).default("open"),
  resolution: z.string().optional(),
});

const severityLabel: Record<string, string> = {
  low: "Leve",
  medium: "Moderada",
  high: "Grave",
  critical: "Critica",
};

const statusLabel: Record<string, string> = {
  open: "Aberta",
  in_progress: "Em andamento",
  resolved: "Resolvida",
};

type Props = { residentId: number; canEdit: boolean };

export function ResidentOccurrenceSection({ residentId, canEdit }: Props) {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOccurrence, setEditingOccurrence] = useState<OccurrenceWithResident | null>(null);

  const occurrenceForm = useForm<z.infer<typeof occurrenceSchema>>({
    resolver: zodResolver(occurrenceSchema),
    defaultValues: {
      type: "Saude",
      description: "",
      severity: "low",
      status: "open",
      resolution: "",
    },
  });

  const occurrencesQuery = useQuery<OccurrenceWithResident[]>({
    queryKey: ["/api/occurrences", "prontuario", residentId],
    enabled: residentId > 0,
    queryFn: () =>
      fetchJsonOrThrow(`/api/occurrences?residentId=${residentId}`, "Erro ao carregar ocorrências."),
  });

  const invalidateOccurrenceQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/occurrences"] });
    queryClient.invalidateQueries({ queryKey: ["/api/occurrences", "prontuario", residentId] });
    queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
  };

  const createOccurrence = useMutation({
    mutationFn: (data: z.infer<typeof occurrenceSchema>) =>
      fetchJsonOrThrow("/api/occurrences", "Erro ao registrar ocorrência.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId,
          type: data.type.trim(),
          description: data.description.trim(),
          severity: data.severity,
          status: data.status,
          resolution: data.resolution?.trim() || null,
        }),
      }),
    onSuccess: () => {
      invalidateOccurrenceQueries();
      setIsDialogOpen(false);
      setEditingOccurrence(null);
      occurrenceForm.reset();
      toast({ title: "Ocorrência registrada com sucesso" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const updateOccurrence = useMutation({
    mutationFn: ({ id, data }: { id: number; data: z.infer<typeof occurrenceSchema> }) =>
      fetchJsonOrThrow(`/api/occurrences/${id}`, "Erro ao atualizar ocorrência.", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId,
          type: data.type.trim(),
          description: data.description.trim(),
          severity: data.severity,
          status: data.status,
          resolution: data.resolution?.trim() || null,
          resolvedAt: data.status === "resolved" ? new Date().toISOString() : undefined,
        }),
      }),
    onSuccess: () => {
      invalidateOccurrenceQueries();
      setIsDialogOpen(false);
      setEditingOccurrence(null);
      toast({ title: "Ocorrência atualizada com sucesso" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const deleteOccurrence = useMutation({
    mutationFn: (id: number) =>
      fetchJsonOrThrow(`/api/occurrences/${id}`, "Erro ao excluir ocorrência.", { method: "DELETE" }),
    onSuccess: () => {
      invalidateOccurrenceQueries();
      toast({ title: "Ocorrência removida" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const openCreateDialog = () => {
    setEditingOccurrence(null);
    occurrenceForm.reset({
      type: "Saude",
      description: "",
      severity: "low",
      status: "open",
      resolution: "",
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (occurrence: OccurrenceWithResident) => {
    setEditingOccurrence(occurrence);
    occurrenceForm.reset({
      type: occurrence.type || "",
      description: occurrence.description || "",
      severity: (occurrence.severity as "low" | "medium" | "high" | "critical") || "low",
      status: (occurrence.status as "open" | "in_progress" | "resolved") || "open",
      resolution: occurrence.resolution || "",
    });
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {!canEdit ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/40 px-4 py-3 text-xs text-muted-foreground">
          Modo somente leitura para este perfil.
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" variant="destructive" onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-1" />
            Nova Ocorrência
          </Button>
        </div>
      ) : null}

      {occurrencesQuery.isLoading ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
          Carregando ocorrências...
        </div>
      ) : occurrencesQuery.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          {occurrencesQuery.error instanceof Error
            ? occurrencesQuery.error.message
            : "Erro ao carregar ocorrências."}
        </div>
      ) : (occurrencesQuery.data?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
          Nenhuma ocorrência registrada para este paciente.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Gravidade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Descricao</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {occurrencesQuery.data?.map((occurrence) => (
                <TableRow key={occurrence.id}>
                  <TableCell className="font-medium">{occurrence.type}</TableCell>
                  <TableCell>{severityLabel[occurrence.severity] ?? occurrence.severity}</TableCell>
                  <TableCell>{statusLabel[occurrence.status] ?? occurrence.status}</TableCell>
                  <TableCell>
                    {occurrence.createdAt ? format(new Date(occurrence.createdAt), "dd/MM/yyyy HH:mm") : "-"}
                  </TableCell>
                  <TableCell className="max-w-[320px] truncate">{occurrence.description}</TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => openEditDialog(occurrence)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            confirm({
                              title: "Excluir ocorrência",
                              description: "Excluir esta ocorrência?",
                              confirmText: "Excluir",
                              pendingText: "Excluindo...",
                              variant: "destructive",
                              onConfirm: () => deleteOccurrence.mutateAsync(occurrence.id),
                            });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Somente leitura</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingOccurrence ? "Editar Ocorrência" : "Nova Ocorrência"}</DialogTitle>
          </DialogHeader>
          <Form {...occurrenceForm}>
            <form
              onSubmit={occurrenceForm.handleSubmit((data) => {
                if (editingOccurrence) updateOccurrence.mutate({ id: editingOccurrence.id, data });
                else createOccurrence.mutate(data);
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={occurrenceForm.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={occurrenceForm.control} name="severity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gravidade</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="low">Leve</SelectItem>
                        <SelectItem value="medium">Moderada</SelectItem>
                        <SelectItem value="high">Grave</SelectItem>
                        <SelectItem value="critical">Critica</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={occurrenceForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="open">Aberta</SelectItem>
                        <SelectItem value="in_progress">Em andamento</SelectItem>
                        <SelectItem value="resolved">Resolvida</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={occurrenceForm.control} name="resolution" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Resolucao</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                  </FormItem>
                )} />
              </div>

              <FormField control={occurrenceForm.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Descricao *</FormLabel>
                  <FormControl><Textarea {...field} rows={4} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={createOccurrence.isPending || updateOccurrence.isPending}>
                  {editingOccurrence ? "Salvar" : "Registrar"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
