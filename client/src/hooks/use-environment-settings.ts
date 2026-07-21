import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type UpdateEnvironmentSettingsRequest } from "@shared/routes";
import { normalizeEnvironmentSettings } from "@shared/environment";
import { useToast } from "@/hooks/use-toast";

const ENVIRONMENT_SETTINGS_QUERY_KEY = [api.environmentSettings.get.path];

export function useEnvironmentSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ENVIRONMENT_SETTINGS_QUERY_KEY,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const res = await fetch(api.environmentSettings.get.path, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Falha ao carregar configurações do ambiente");
      return normalizeEnvironmentSettings(await res.json());
    },
  });
}

export function useUpdateEnvironmentSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: UpdateEnvironmentSettingsRequest) => {
      const normalizedPayload = normalizeEnvironmentSettings(payload);
      const res = await fetch(api.environmentSettings.update.path, {
        method: api.environmentSettings.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedPayload),
        credentials: "include",
      });
      if (!res.ok) {
        const fallbackMessage = "Falha ao salvar configurações do ambiente";
        let message = fallbackMessage;
        try {
          const data = await res.json();
          if (typeof data?.message === "string" && data.message.trim()) {
            message = data.message;
          }
        } catch {}
        throw new Error(message);
      }
      return normalizeEnvironmentSettings(await res.json());
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(ENVIRONMENT_SETTINGS_QUERY_KEY, settings);
      toast({ title: "Configuracoes salvas" });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    },
  });
}
