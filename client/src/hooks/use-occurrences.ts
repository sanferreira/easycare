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
      if (!res.ok) throw new Error("Falha ao carregar ocorrencias");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Falha ao registrar ocorrencia");
      return api.occurrences.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.occurrences.list.path] });
      toast({ title: "Sucesso", description: "Ocorrencia registrada" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    },
  });
}

export function useDeleteOccurrence() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const path = api.occurrences.delete.path.replace(":id", String(id));
      const res = await fetch(path, {
        method: api.occurrences.delete.method,
        credentials: "include",
      });
      if (!res.ok || res.status !== 204) {
        const raw = (await res.text().catch(() => "")).trim();

        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed?.message) {
              throw new Error(`${parsed.message} (HTTP ${res.status})`);
            }
          } catch {
            if (raw.startsWith("<!doctype") || raw.startsWith("<html")) {
              throw new Error(`Rota de exclusao nao ativa no backend (HTTP ${res.status}). Reinicie o servidor local.`);
            }
          }
        }

        const rawPreview = raw ? ` - ${raw.slice(0, 120)}` : "";
        throw new Error(`Falha ao excluir ocorrencia (HTTP ${res.status})${rawPreview}`);
      }
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueriesData(
        { queryKey: [api.occurrences.list.path] },
        (current: unknown) => {
          if (!Array.isArray(current)) return current;
          return current.filter((item: any) => item?.id !== deletedId);
        },
      );
      queryClient.invalidateQueries({ queryKey: [api.occurrences.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Sucesso", description: "Ocorrencia excluida" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    },
  });
}
