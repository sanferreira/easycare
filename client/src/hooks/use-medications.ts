import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateMedicationRequest, type UpdateMedicationRequest } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useMedications(residentId?: number) {
  const path = residentId 
    ? `${api.medications.list.path}?residentId=${residentId}` 
    : api.medications.list.path;

  return useQuery({
    queryKey: [api.medications.list.path, residentId],
    queryFn: async () => {
      const res = await fetch(path, { credentials: "include" });
      if (!res.ok) throw new Error("Falha ao carregar medicações");
      return api.medications.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateMedication() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateMedicationRequest) => {
      const validated = api.medications.create.input.parse(data);
      const res = await fetch(api.medications.create.path, {
        method: api.medications.create.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error('Falha ao adicionar medicação');
      return api.medications.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.medications.list.path] });
      toast({ title: "Sucesso", description: "Medicação adicionada" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    }
  });
}

export function useUpdateMedication() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateMedicationRequest) => {
      const validated = api.medications.update.input.parse(updates);
      const url = buildUrl(api.medications.update.path, { id });
      const res = await fetch(url, {
        method: api.medications.update.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error('Falha ao atualizar medicação');
      return api.medications.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.medications.list.path] });
      toast({ title: "Sucesso", description: "Medicação atualizada" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    }
  });
}
