import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CreateOccurrenceRequest } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useOccurrences(residentId?: number) {
  const path = residentId 
    ? `${api.occurrences.list.path}?residentId=${residentId}` 
    : api.occurrences.list.path;

  return useQuery({
    queryKey: [api.occurrences.list.path, residentId],
    queryFn: async () => {
      const res = await fetch(path, { credentials: "include" });
      if (!res.ok) throw new Error("Falha ao carregar ocorrências");
      return api.occurrences.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateOccurrence() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateOccurrenceRequest) => {
      const validated = api.occurrences.create.input.parse(data);
      const res = await fetch(api.occurrences.create.path, {
        method: api.occurrences.create.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error('Falha ao registrar ocorrência');
      return api.occurrences.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.occurrences.list.path] });
      toast({ title: "Sucesso", description: "Ocorrência registrada" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    }
  });
}
