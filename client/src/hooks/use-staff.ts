import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateStaffRequest, type UpdateStaffRequest } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useStaff() {
  return useQuery({
    queryKey: [api.staff.list.path],
    queryFn: async () => {
      const res = await fetch(api.staff.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Falha ao carregar equipe");
      return api.staff.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateStaffRequest) => {
      const validated = api.staff.create.input.parse(data);
      const res = await fetch(api.staff.create.path, {
        method: api.staff.create.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error('Falha ao adicionar membro');
      return api.staff.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.staff.list.path] });
      toast({ title: "Sucesso", description: "Membro adicionado" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    }
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateStaffRequest) => {
      const validated = api.staff.update.input.parse(updates);
      const url = buildUrl(api.staff.update.path, { id });
      const res = await fetch(url, {
        method: api.staff.update.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error('Falha ao atualizar membro');
      return api.staff.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.staff.list.path] });
      toast({ title: "Sucesso", description: "Membro atualizado" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    }
  });
}
