import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { z } from "zod";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

type LoginInput = z.infer<typeof api.auth.login.input>;

export function useAuth() {
  const queryClient = useQueryClient();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const userQuery = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => {
      const res = await fetch(api.auth.me.path, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginInput) => {
      const res = await fetch(api.auth.login.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.message || "Credenciais inválidas");
      }
      return res.json();
    },
    onSuccess: (data) => {
      // Clear all cached data from any previous session before loading new tenant data
      queryClient.clear();
      queryClient.setQueryData(["auth-user"], data.user);
      // Super admin goes to admin page, regular users go to dashboard
      setLocation(data.user.isSuperAdmin ? "/admin" : "/");
      toast({
        title: "Bem-vindo!",
        description: data.user.organizationName
          ? `${data.user.organizationName}`
          : "Super Administrador",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erro ao entrar",
        description: error.message,
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch(api.auth.logout.path, { 
        method: "POST", 
        credentials: "include" 
      });
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
    },
  });

  return {
    user: userQuery.data,
    isLoading: userQuery.isLoading,
    login: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutate,
  };
}
