import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateResidentRequest, type UpdateResidentRequest } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useResidents(filters?: { search?: string; status?: 'active' | 'inactive' | 'deceased' }) {
  // Construct query string manually since we don't have a sophisticated query builder yet
  const queryParams = new URLSearchParams();
  if (filters?.search) queryParams.append("search", filters.search);
  if (filters?.status) queryParams.append("status", filters.status);
  
  const queryString = queryParams.toString();
  const path = `${api.residents.list.path}${queryString ? `?${queryString}` : ''}`;

  return useQuery({
    queryKey: [api.residents.list.path, filters],
    queryFn: async () => {
      const res = await fetch(path, { credentials: "include" });
      if (!res.ok) throw new Error("Falha ao carregar pacientes");
      return api.residents.list.responses[200].parse(await res.json());
    },
  });
}

export function useResident(id: number) {
  return useQuery({
    queryKey: [api.residents.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.residents.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Falha ao carregar paciente");
      return api.residents.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateResident() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateResidentRequest) => {
      const validated = api.residents.create.input.parse(data);
      const res = await fetch(api.residents.create.path, {
        method: api.residents.create.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error('Falha ao criar paciente');
      return api.residents.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.residents.list.path] });
      toast({ title: "Sucesso", description: "Paciente cadastrado com sucesso" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    }
  });
}

export function useUpdateResident() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateResidentRequest) => {
      const validated = api.residents.update.input.parse(updates);
      const url = buildUrl(api.residents.update.path, { id });
      const res = await fetch(url, {
        method: api.residents.update.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error('Falha ao atualizar paciente');
      return api.residents.update.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.residents.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.residents.get.path, variables.id] });
      toast({ title: "Sucesso", description: "Dados atualizados" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    }
  });
}
