import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS } from "@/lib/permissions";
import { DEFAULT_ENVIRONMENT_SETTINGS, normalizeEnvironmentSettings } from "@shared/environment";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Building2, Plus, Trash2, Users, ChevronDown, ChevronRight, UserPlus, Eye, EyeOff, Pencil,
} from "lucide-react";
import { digitsOnly, maskCep, maskCnpj, maskPhoneBR } from "@/lib/masks";

type OrgStatus = "active" | "inactive" | "restricted";

interface Organization {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  cnpj: string;
  capacity?: number;
  status?: OrgStatus;
  environmentSettings?: string | null;
  active: boolean;
  createdAt: string;
}
interface OrgUser {
  id: number;
  name: string;
  username: string;
  role: string;
}

type ViaCepPayload = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

function extractCepFromAddress(address?: string): string {
  if (!address) return "";
  const match = address.match(/\b\d{5}-?\d{3}\b/);
  return match ? maskCep(match[0]) : "";
}

function removeCepPrefixFromAddress(address?: string): string {
  if (!address) return "";
  return address.replace(/^CEP\s*\d{5}-?\d{3}\s*-?\s*/i, "").trim();
}

function composeAddress(cep: string, address: string): string {
  const normalizedCep = maskCep(cep);
  const cleanAddress = removeCepPrefixFromAddress(address);
  if (!normalizedCep) return cleanAddress;
  if (!cleanAddress) return `CEP ${normalizedCep}`;
  return `CEP ${normalizedCep} - ${cleanAddress}`;
}

function isValidCnpj(value: string): boolean {
  return digitsOnly(value).length === 14;
}

function resolveOrgStatus(org: Pick<Organization, "status" | "active">): OrgStatus {
  if (org.status === "active" || org.status === "inactive" || org.status === "restricted") {
    return org.status;
  }
  return org.active ? "active" : "inactive";
}

function getOrgStatusBadge(status: OrgStatus) {
  if (status === "active") {
    return { label: "Ativa", className: "bg-green-100 text-green-700 border border-green-200" };
  }
  if (status === "restricted") {
    return { label: "Restrita", className: "bg-orange-100 text-orange-700 border border-orange-200" };
  }
  return { label: "Inativa", className: "bg-neutral-100 text-neutral-600 border border-neutral-200" };
}

function parseOrgEnvironmentSettings(raw?: string | null) {
  if (!raw || typeof raw !== "string") return DEFAULT_ENVIRONMENT_SETTINGS;
  try {
    return normalizeEnvironmentSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_ENVIRONMENT_SETTINGS;
  }
}

function toRoleLabel(value: string): string {
  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function getRoleOptionsForOrganization(org: Organization) {
  const settings = parseOrgEnvironmentSettings(org.environmentSettings);
  const staffLabelMap = new Map(
    settings.availableStaffRoles.map((option) => [option.value, option.label] as const),
  );
  const roles = Object.keys(settings.roleRoutes).sort((left, right) => left.localeCompare(right));
  return roles.map((role) => ({
    value: role,
    label: ROLE_LABELS[role] ?? staffLabelMap.get(role) ?? toRoleLabel(role),
  }));
}

async function fetchAddressByCep(cep: string): Promise<{ cep: string; address: string }> {
  const normalizedCep = digitsOnly(cep);
  if (normalizedCep.length !== 8) {
    throw new Error("Informe um CEP válido com 8 dígitos.");
  }

  const response = await fetch(`https://viacep.com.br/ws/${normalizedCep}/json/`);
  if (!response.ok) throw new Error("Não foi possível consultar o ViaCEP.");

  const data: ViaCepPayload = await response.json();
  if (data.erro) throw new Error("CEP não encontrado.");

  const cityAndUf = [data.localidade, data.uf].filter(Boolean).join("/");
  const addressParts = [data.logradouro, data.bairro, cityAndUf].filter(Boolean);

  return {
    cep: maskCep(data.cep || normalizedCep),
    address: addressParts.join(" - "),
  };
}

function OrgCard({ org }: { org: Organization }) {
  const [expanded, setExpanded] = useState(false);
  const orgStatus = resolveOrgStatus(org);
  const orgBadge = getOrgStatusBadge(orgStatus);
  const { data: latestOrg } = useQuery<Organization>({
    queryKey: [`/api/organizations/${org.id}`],
    enabled: expanded,
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}`);
      if (!res.ok) throw new Error("Erro ao carregar organização");
      return res.json();
    },
  });
  const roleSource = latestOrg ?? org;
  const roleOptions = useMemo(() => getRoleOptionsForOrganization(roleSource), [roleSource.environmentSettings]);
  const defaultRole = useMemo(() => {
    const staffFallback = roleOptions.find((option) => option.value === "staff");
    return staffFallback?.value ?? roleOptions[0]?.value ?? "staff";
  }, [roleOptions]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [showEditOrg, setShowEditOrg] = useState(false);
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);
  const [userForm, setUserForm] = useState({ name: "", username: "", password: "", role: defaultRole });
  const [editForm, setEditForm] = useState({ name: "", username: "", password: "", role: defaultRole });
  const [editOrgForm, setEditOrgForm] = useState({
    name: org.name,
    address: removeCepPrefixFromAddress(org.address),
    cep: extractCepFromAddress(org.address),
    phone: maskPhoneBR(org.phone ?? ""),
    cnpj: maskCnpj(org.cnpj ?? ""),
    capacity: String(org.capacity ?? 50),
    status: orgStatus as OrgStatus,
  });
  const [isLookingUpEditCep, setIsLookingUpEditCep] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const hasValidEditCnpj = isValidCnpj(editOrgForm.cnpj);
  const resolveRoleSelectOptions = (currentRole: string) => {
    if (!currentRole || roleOptions.some((option) => option.value === currentRole)) {
      return roleOptions;
    }
    return [
      ...roleOptions,
      {
        value: currentRole,
        label: ROLE_LABELS[currentRole] ?? toRoleLabel(currentRole),
      },
    ];
  };
  const addUserRoleOptions = useMemo(
    () => resolveRoleSelectOptions(userForm.role),
    [roleOptions, userForm.role],
  );
  const editUserRoleOptions = useMemo(
    () => resolveRoleSelectOptions(editForm.role),
    [roleOptions, editForm.role],
  );
  const roleLabelMap = useMemo(
    () => new Map(roleOptions.map((option) => [option.value, option.label] as const)),
    [roleOptions],
  );

  useEffect(() => {
    setUserForm((current) => (
      roleOptions.some((option) => option.value === current.role)
        ? current
        : { ...current, role: defaultRole }
    ));
    setEditForm((current) => (
      roleOptions.some((option) => option.value === current.role)
        ? current
        : { ...current, role: defaultRole }
    ));
  }, [defaultRole, roleOptions]);

  const { data: orgUsers = [], refetch: refetchUsers } = useQuery<OrgUser[]>({
    queryKey: [`/api/organizations/${org.id}/users`],
    enabled: expanded,
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}/users`);
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/organizations/${org.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Organização removida" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async () => {
      const composedAddress = composeAddress(editOrgForm.cep, editOrgForm.address);
      const res = await fetch(`/api/organizations/${org.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editOrgForm.name.trim(),
          address: composedAddress,
          phone: editOrgForm.phone.trim(),
          cnpj: editOrgForm.cnpj.trim(),
          capacity: Number(editOrgForm.capacity) || 50,
          status: editOrgForm.status,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Erro ao atualizar");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Organização atualizada!" });
      setShowEditOrg(false);
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/organizations/${org.id}`] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const addUserMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${org.id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Usuário criado com sucesso!" });
      setShowAddUser(false);
      setUserForm({ name: "", username: "", password: "", role: defaultRole });
      refetchUsers();
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const editUserMutation = useMutation({
    mutationFn: async () => {
      if (!editingUser) return;
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Usuário atualizado com sucesso!" });
      setShowEditUser(false);
      setEditingUser(null);
      refetchUsers();
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      await fetch(`/api/users/${userId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Usuário removido" });
      refetchUsers();
    },
  });

  function openEditUser(u: OrgUser) {
    setEditingUser(u);
    setEditForm({ name: u.name, username: u.username, password: "", role: u.role });
    setShowEditPassword(false);
    setShowEditUser(true);
  }

  async function handleLookupEditCep() {
    try {
      setIsLookingUpEditCep(true);
      const result = await fetchAddressByCep(editOrgForm.cep);
      setEditOrgForm((prev) => ({
        ...prev,
        cep: result.cep,
        address: result.address || prev.address,
      }));
      toast({ title: "Endereço preenchido pelo CEP" });
    } catch (err) {
      toast({
        title: "CEP inválido",
        description: err instanceof Error ? err.message : "Não foi possível buscar o CEP.",
        variant: "destructive",
      });
    } finally {
      setIsLookingUpEditCep(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{org.name}</h3>
                <Badge className={`text-xs ${orgBadge.className}`}>
                  {orgBadge.label}
                </Badge>
              </div>
              {org.address && <p className="text-xs text-muted-foreground mt-0.5">{org.address}</p>}
              {org.phone && <p className="text-xs text-muted-foreground">{maskPhoneBR(org.phone)}</p>}
              {org.cnpj && <p className="text-xs text-muted-foreground">CNPJ: {maskCnpj(org.cnpj)}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-medium text-foreground">{org.capacity ?? 50}</span> vagas disponíveis
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost" size="sm"
              onClick={() => setExpanded(!expanded)}
              data-testid={`button-expand-org-${org.id}`}
              className="gap-1 text-xs"
            >
              <Users className="h-3.5 w-3.5" />
              Usuários
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary"
              onClick={() => {
                setEditOrgForm({
                  name: org.name,
                  address: removeCepPrefixFromAddress(org.address),
                  cep: extractCepFromAddress(org.address),
                  phone: maskPhoneBR(org.phone ?? ""),
                  cnpj: maskCnpj(org.cnpj ?? ""),
                  capacity: String(org.capacity ?? 50),
                  status: resolveOrgStatus(org),
                });
                setShowEditOrg(true);
              }}
              data-testid={`button-edit-org-${org.id}`}
              title="Editar organização"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => {
                confirm({
                  title: "Remover organização",
                  description: `Remover "${org.name}"? Todos os dados serão perdidos.`,
                  confirmText: "Remover",
                  pendingText: "Removendo...",
                  variant: "destructive",
                  onConfirm: () => deleteOrgMutation.mutateAsync(),
                });
              }}
              data-testid={`button-delete-org-${org.id}`}
              title="Remover organização"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <Separator className="mb-3" />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Usuários</p>
              <Button variant="outline" size="sm" className="gap-1 text-xs h-7"
                onClick={() => {
                  setUserForm((current) => ({
                    ...current,
                    role: roleOptions.some((option) => option.value === current.role)
                      ? current.role
                      : defaultRole,
                  }));
                  setShowAddUser(true);
                }} data-testid={`button-add-user-${org.id}`}>
                <UserPlus className="h-3 w-3" />
                Novo usuário
              </Button>
            </div>

            {orgUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Nenhum usuário cadastrado</p>
            ) : (
              <div className="space-y-1">
                {orgUsers.map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 group"
                    data-testid={`user-row-${u.id}`}>
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">@{u.username} - {roleLabelMap.get(u.role) ?? ROLE_LABELS[u.role] ?? u.role}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={() => openEditUser(u)}
                        data-testid={`button-edit-user-${u.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteUserMutation.mutate(u.id)}
                        data-testid={`button-delete-user-${u.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add User Dialog */}
          <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Usuário — {org.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <div>
                  <Label className="text-sm font-medium">Nome completo</Label>
                  <Input className="mt-1.5" placeholder="Ex: João Silva"
                    value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                    data-testid="input-user-name" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Usuário</Label>
                  <Input className="mt-1.5" placeholder="Ex: joao.silva"
                    value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    data-testid="input-user-username" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Senha</Label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Senha de acesso"
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      data-testid="input-user-password"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Perfil</Label>
                  <Select value={userForm.role} onValueChange={(v) => setUserForm({ ...userForm, role: v })}>
                    <SelectTrigger className="mt-1.5" data-testid="select-user-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {addUserRoleOptions.map((option) => (
                        <SelectItem key={`add-user-role-${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Ao criar o acesso, o colaborador correspondente tambem sera vinculado na Equipe desta empresa.
                  </p>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setShowAddUser(false)}>Cancelar</Button>
                  <Button className="flex-1" disabled={addUserMutation.isPending}
                    onClick={() => addUserMutation.mutate()} data-testid="button-confirm-add-user">
                    {addUserMutation.isPending ? "Criando..." : "Criar Usuário"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Edit User Dialog */}
          <Dialog open={showEditUser} onOpenChange={(open) => { setShowEditUser(open); if (!open) setEditingUser(null); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Editar Usuário</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <div>
                  <Label className="text-sm font-medium">Nome completo</Label>
                  <Input className="mt-1.5" placeholder="Ex: João Silva"
                    value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    data-testid="input-edit-user-name" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Usuário (login)</Label>
                  <Input className="mt-1.5" placeholder="Ex: joao.silva"
                    value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                    data-testid="input-edit-user-username" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Perfil</Label>
                  <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                    <SelectTrigger className="mt-1.5" data-testid="select-edit-user-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editUserRoleOptions.map((option) => (
                        <SelectItem key={`edit-user-role-${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium">Nova senha <span className="text-muted-foreground font-normal">(deixe em branco para manter)</span></Label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showEditPassword ? "text" : "password"}
                      placeholder="Nova senha (opcional)"
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      data-testid="input-edit-user-password"
                    />
                    <button type="button" onClick={() => setShowEditPassword(!showEditPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setShowEditUser(false)}>Cancelar</Button>
                  <Button className="flex-1" disabled={editUserMutation.isPending}
                    onClick={() => editUserMutation.mutate()} data-testid="button-confirm-edit-user">
                    {editUserMutation.isPending ? "Salvando..." : "Salvar Alterações"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      )}

      {/* Edit Org Dialog */}
      <Dialog open={showEditOrg} onOpenChange={setShowEditOrg}>
        <DialogContent data-testid={`dialog-edit-org-${org.id}`}>
          <DialogHeader>
            <DialogTitle>Editar Organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div>
              <Label className="text-sm font-medium">Nome *</Label>
              <Input className="mt-1.5" placeholder="Ex: Lar das Flores"
                value={editOrgForm.name} onChange={(e) => setEditOrgForm({ ...editOrgForm, name: e.target.value })}
                data-testid="input-edit-org-name" />
            </div>
            <div>
              <Label className="text-sm font-medium">CEP</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  placeholder="00000-000"
                  maxLength={9}
                  value={editOrgForm.cep}
                  onChange={(e) => setEditOrgForm({ ...editOrgForm, cep: maskCep(e.target.value) })}
                  data-testid="input-edit-org-cep"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={handleLookupEditCep}
                  disabled={isLookingUpEditCep}
                  data-testid="button-edit-org-cep-lookup"
                >
                  {isLookingUpEditCep ? "Buscando..." : "Buscar CEP"}
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Endereço</Label>
              <Input className="mt-1.5" placeholder="Rua, número - Bairro - Cidade/UF"
                value={editOrgForm.address} onChange={(e) => setEditOrgForm({ ...editOrgForm, address: e.target.value })}
                data-testid="input-edit-org-address" />
            </div>
            <div>
              <Label className="text-sm font-medium">Telefone</Label>
              <Input className="mt-1.5" placeholder="(00) 00000-0000" maxLength={15}
                value={editOrgForm.phone} onChange={(e) => setEditOrgForm({ ...editOrgForm, phone: maskPhoneBR(e.target.value) })}
                data-testid="input-edit-org-phone" />
            </div>
            <div>
              <Label className="text-sm font-medium">CNPJ *</Label>
              <Input className="mt-1.5" placeholder="00.000.000/0000-00" maxLength={18}
                value={editOrgForm.cnpj} onChange={(e) => setEditOrgForm({ ...editOrgForm, cnpj: maskCnpj(e.target.value) })}
                data-testid="input-edit-org-cnpj" />
            </div>
            <div>
              <Label className="text-sm font-medium">Status</Label>
              <Select
                value={editOrgForm.status}
                onValueChange={(value: OrgStatus) => setEditOrgForm({ ...editOrgForm, status: value })}
              >
                <SelectTrigger className="mt-1.5" data-testid="select-edit-org-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativa</SelectItem>
                  <SelectItem value="inactive">Inativa</SelectItem>
                  <SelectItem value="restricted">Restrita</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Inativa/Restrita bloqueiam acesso dos usuários desta organização.
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Capacidade de Vagas</Label>
              <Input className="mt-1.5" type="number" min="1" placeholder="Ex: 30"
                value={editOrgForm.capacity} onChange={(e) => setEditOrgForm({ ...editOrgForm, capacity: e.target.value })}
                data-testid="input-edit-org-capacity" />
              <p className="text-xs text-muted-foreground mt-1">Número máximo de residentes que a unidade comporta</p>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowEditOrg(false)}>Cancelar</Button>
              <Button className="flex-1" disabled={updateOrgMutation.isPending || !editOrgForm.name.trim() || !hasValidEditCnpj}
                onClick={() => updateOrgMutation.mutate()} data-testid="button-confirm-edit-org">
                {updateOrgMutation.isPending ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </Card>
  );
}

export default function Admin() {
  const [showAddOrg, setShowAddOrg] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [orgForm, setOrgForm] = useState({
    name: "",
    cep: "",
    address: "",
    phone: "",
    cnpj: "",
    capacity: "50",
    status: "active" as OrgStatus,
  });
  const [isLookingUpOrgCep, setIsLookingUpOrgCep] = useState(false);
  const { toast } = useToast();
  const hasValidOrgCnpj = isValidCnpj(orgForm.cnpj);

  const { data: organizations = [], isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/organizations", { showInactive }],
    queryFn: async () => {
      const url = showInactive ? "/api/organizations?includeInactive=true" : "/api/organizations";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Erro ao carregar organizações");
      return res.json();
    },
  });

  const createOrgMutation = useMutation({
    mutationFn: async () => {
      const composedAddress = composeAddress(orgForm.cep, orgForm.address);
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: orgForm.name.trim(),
          address: composedAddress,
          phone: orgForm.phone.trim(),
          cnpj: orgForm.cnpj.trim(),
          capacity: Number(orgForm.capacity) || 50,
          status: orgForm.status,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Organização criada com sucesso!" });
      setShowAddOrg(false);
      setOrgForm({ name: "", cep: "", address: "", phone: "", cnpj: "", capacity: "50", status: "active" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  async function handleLookupOrgCep() {
    try {
      setIsLookingUpOrgCep(true);
      const result = await fetchAddressByCep(orgForm.cep);
      setOrgForm((prev) => ({
        ...prev,
        cep: result.cep,
        address: result.address || prev.address,
      }));
      toast({ title: "Endereço preenchido pelo CEP" });
    } catch (err) {
      toast({
        title: "CEP inválido",
        description: err instanceof Error ? err.message : "Não foi possível buscar o CEP.",
        variant: "destructive",
      });
    } finally {
      setIsLookingUpOrgCep(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground font-display">Organizações</h1>
            <Badge className="bg-amber-500 text-white text-xs">Super Admin</Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            Gerencie todas as casas de repouso cadastradas no sistema
          </p>
        </div>
        <Button onClick={() => setShowAddOrg(true)} className="gap-2 shrink-0" data-testid="button-add-org">
          <Plus className="h-4 w-4" />
          Nova Organização
        </Button>
      </div>

      <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Mostrar organizações inativas</p>
          <p className="text-xs text-muted-foreground">Por padrão, organizações inativas ficam ocultas da lista.</p>
        </div>
        <Switch
          checked={showInactive}
          onCheckedChange={setShowInactive}
          data-testid="toggle-show-inactive-orgs"
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : organizations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Building2 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">Nenhuma organização cadastrada</p>
            <Button variant="outline" onClick={() => setShowAddOrg(true)}>Criar primeira organização</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {organizations.map((org) => <OrgCard key={org.id} org={org} />)}
        </div>
      )}

      <Dialog open={showAddOrg} onOpenChange={setShowAddOrg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Casa de Repouso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div>
              <Label className="text-sm font-medium">Nome *</Label>
              <Input className="mt-1.5" placeholder="Ex: Lar das Flores"
                value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                data-testid="input-org-name" />
            </div>
            <div>
              <Label className="text-sm font-medium">CEP</Label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="00000-000"
                  maxLength={9}
                  value={orgForm.cep}
                  onChange={(e) => setOrgForm({ ...orgForm, cep: maskCep(e.target.value) })}
                  data-testid="input-org-cep"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full shrink-0 sm:w-auto"
                  onClick={handleLookupOrgCep}
                  disabled={isLookingUpOrgCep}
                  data-testid="button-org-cep-lookup"
                >
                  {isLookingUpOrgCep ? "Buscando..." : "Buscar CEP"}
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Endereço</Label>
              <Input className="mt-1.5" placeholder="Rua, número - Bairro - Cidade/UF"
                value={orgForm.address} onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                data-testid="input-org-address" />
            </div>
            <div>
              <Label className="text-sm font-medium">Telefone</Label>
              <Input className="mt-1.5" placeholder="(00) 00000-0000" maxLength={15}
                value={orgForm.phone} onChange={(e) => setOrgForm({ ...orgForm, phone: maskPhoneBR(e.target.value) })}
                data-testid="input-org-phone" />
            </div>
            <div>
              <Label className="text-sm font-medium">CNPJ *</Label>
              <Input className="mt-1.5" placeholder="00.000.000/0000-00" maxLength={18}
                value={orgForm.cnpj} onChange={(e) => setOrgForm({ ...orgForm, cnpj: maskCnpj(e.target.value) })}
                data-testid="input-org-cnpj" />
            </div>
            <div>
              <Label className="text-sm font-medium">Status</Label>
              <Select
                value={orgForm.status}
                onValueChange={(value: OrgStatus) => setOrgForm({ ...orgForm, status: value })}
              >
                <SelectTrigger className="mt-1.5" data-testid="select-org-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativa</SelectItem>
                  <SelectItem value="inactive">Inativa</SelectItem>
                  <SelectItem value="restricted">Restrita</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Capacidade de Vagas *</Label>
              <Input className="mt-1.5" type="number" min="1" placeholder="Ex: 30"
                value={orgForm.capacity} onChange={(e) => setOrgForm({ ...orgForm, capacity: e.target.value })}
                data-testid="input-org-capacity" />
              <p className="text-xs text-muted-foreground mt-1">Número máximo de residentes que a unidade comporta</p>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddOrg(false)}>Cancelar</Button>
              <Button className="flex-1" disabled={createOrgMutation.isPending || !orgForm.name.trim() || !hasValidOrgCnpj}
                onClick={() => createOrgMutation.mutate()} data-testid="button-confirm-add-org">
                {createOrgMutation.isPending ? "Criando..." : "Criar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}



