import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Package, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useResidents } from "@/hooks/use-residents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchJsonOrThrow } from "@/lib/fetch-json";
import {
  formatPharmacyFormLabel,
  formatPharmacyItemLabel,
  formatPharmacyStrength,
  formatStockUnitLabel,
  PHARMACY_FORM_LABELS,
  PHARMACY_FORM_VALUES,
  STOCK_UNIT_LABELS,
  STOCK_UNIT_VALUES,
  STRENGTH_UNIT_LABELS,
  STRENGTH_UNIT_VALUES,
  type PharmacyForm,
  type StockUnit,
  type StrengthUnit,
  isPharmacyForm,
  isStockUnit,
  isStrengthUnit,
  parseStrengthText,
} from "@shared/pharmacy";

type PharmacyItemRow = {
  id: number;
  name: string;
  activeIngredient: string | null;
  form: string | null;
  strength: string | null;
  strengthValue: number | null;
  strengthUnit: string | null;
  unit: string;
  minStock: number;
  controlled: boolean;
  active: boolean;
  quantityOnHand: number;
};

type PharmacyLotRow = {
  id: number;
  itemId: number;
  itemName?: string;
  scope: string;
  residentId: number | null;
  residentName?: string;
  lotCode: string | null;
  expiryDate: string | null;
  quantityOnHand: number;
  source: string;
  notes: string | null;
  receivedAt: string | null;
};

type PharmacyMovementRow = {
  id: number;
  type: string;
  itemName?: string;
  lotCode?: string | null;
  quantity: number;
  scope: string;
  residentName?: string;
  reason: string | null;
  stockShortage: boolean;
  occurredAt: string | null;
};

type PharmacyAlerts = {
  belowMinimum: Array<{ itemId: number; name: string; minStock: number; quantityOnHand: number; unit: string }>;
  expiringSoon: Array<{
    lotId: number;
    itemName: string;
    lotCode: string | null;
    expiryDate: string;
    quantityOnHand: number;
    scope: string;
    residentName?: string;
  }>;
  expired: Array<{
    lotId: number;
    itemName: string;
    lotCode: string | null;
    expiryDate: string;
    quantityOnHand: number;
    scope: string;
    residentName?: string;
  }>;
};

const SOURCE_LABELS: Record<string, string> = {
  purchase: "Compra",
  family: "Família",
  donation: "Doação",
  other: "Outro",
};

const MOVE_LABELS: Record<string, string> = {
  in: "Entrada",
  out: "Saída",
  adjust: "Ajuste",
  waste: "Descarte",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  try {
    return format(new Date(value), "dd/MM/yyyy");
  } catch {
    return value;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return format(new Date(value), "dd/MM/yyyy HH:mm");
  } catch {
    return value;
  }
}

export default function Farmacia() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: residents = [] } = useResidents();

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PharmacyItemRow | null>(null);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [selectedLot, setSelectedLot] = useState<PharmacyLotRow | null>(null);
  const [residentFilter, setResidentFilter] = useState<string>("all");

  const [itemForm, setItemForm] = useState({
    name: "",
    activeIngredient: "",
    form: "" as "" | PharmacyForm,
    strengthValue: "",
    strengthUnit: "" as "" | StrengthUnit,
    unit: "cp" as StockUnit,
    minStock: "0",
    controlled: false,
    active: true,
  });

  const [entryForm, setEntryForm] = useState({
    itemId: "",
    scope: "org",
    residentId: "",
    quantity: "",
    lotCode: "",
    expiryDate: "",
    source: "purchase",
    notes: "",
  });

  const [adjustForm, setAdjustForm] = useState({
    quantityDelta: "",
    type: "adjust",
    reason: "",
  });

  const itemsQuery = useQuery<PharmacyItemRow[]>({
    queryKey: ["/api/pharmacy/items"],
    queryFn: () => fetchJsonOrThrow("/api/pharmacy/items", "Erro ao carregar catálogo."),
  });

  const orgLotsQuery = useQuery<PharmacyLotRow[]>({
    queryKey: ["/api/pharmacy/lots", "org"],
    queryFn: () => fetchJsonOrThrow("/api/pharmacy/lots?scope=org", "Erro ao carregar estoque da casa."),
  });

  const residentLotsQuery = useQuery<PharmacyLotRow[]>({
    queryKey: ["/api/pharmacy/lots", "resident", residentFilter],
    queryFn: () => {
      const qs =
        residentFilter === "all"
          ? "/api/pharmacy/lots?scope=resident"
          : `/api/pharmacy/lots?scope=resident&residentId=${residentFilter}`;
      return fetchJsonOrThrow(qs, "Erro ao carregar caixas dos residentes.");
    },
  });

  const movementsQuery = useQuery<PharmacyMovementRow[]>({
    queryKey: ["/api/pharmacy/movements"],
    queryFn: () => fetchJsonOrThrow("/api/pharmacy/movements", "Erro ao carregar movimentos."),
  });

  const alertsQuery = useQuery<PharmacyAlerts>({
    queryKey: ["/api/pharmacy/alerts"],
    queryFn: () => fetchJsonOrThrow("/api/pharmacy/alerts", "Erro ao carregar alertas."),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/lots"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/movements"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/alerts"] });
  };

  const saveItem = useMutation({
    mutationFn: async () => {
      if (!itemForm.unit) throw new Error("Unidade de estoque obrigatória.");
      const strengthValueRaw = itemForm.strengthValue.trim();
      const strengthValue = strengthValueRaw ? Number(strengthValueRaw.replace(",", ".")) : null;
      if (strengthValueRaw && (!Number.isFinite(strengthValue) || (strengthValue ?? 0) <= 0)) {
        throw new Error("Concentração inválida.");
      }
      if (strengthValue != null && !itemForm.strengthUnit) {
        throw new Error("Informe a unidade da concentração.");
      }
      if (itemForm.strengthUnit && strengthValue == null) {
        throw new Error("Informe o valor da concentração.");
      }
      const payload = {
        name: itemForm.name.trim(),
        activeIngredient: itemForm.activeIngredient.trim() || null,
        form: itemForm.form || null,
        strengthValue,
        strengthUnit: itemForm.strengthUnit || null,
        unit: itemForm.unit,
        minStock: Number(itemForm.minStock) || 0,
        controlled: itemForm.controlled,
        active: itemForm.active,
      };
      if (editingItem) {
        return fetchJsonOrThrow(`/api/pharmacy/items/${editingItem.id}`, "Erro ao atualizar item.", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      return fetchJsonOrThrow("/api/pharmacy/items", "Erro ao criar item.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      invalidateAll();
      setItemDialogOpen(false);
      setEditingItem(null);
      toast({ title: editingItem ? "Item atualizado" : "Item cadastrado" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const createEntry = useMutation({
    mutationFn: async () => {
      const quantity = Number(entryForm.quantity);
      if (!entryForm.itemId) throw new Error("Selecione o item.");
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantidade inválida.");
      if (entryForm.scope === "resident" && !entryForm.residentId) {
        throw new Error("Selecione o paciente.");
      }
      return fetchJsonOrThrow("/api/pharmacy/entries", "Erro na entrada.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: Number(entryForm.itemId),
          scope: entryForm.scope,
          residentId: entryForm.scope === "resident" ? Number(entryForm.residentId) : null,
          quantity,
          lotCode: entryForm.lotCode.trim() || null,
          expiryDate: entryForm.expiryDate || null,
          source: entryForm.source,
          notes: entryForm.notes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      invalidateAll();
      setEntryDialogOpen(false);
      toast({ title: "Entrada registrada" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const adjustLot = useMutation({
    mutationFn: async () => {
      if (!selectedLot) throw new Error("Lote não selecionado.");
      let quantityDelta = Number(adjustForm.quantityDelta);
      if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
        throw new Error("Informe a quantidade.");
      }
      if (adjustForm.type === "waste" && quantityDelta > 0) {
        quantityDelta = -Math.abs(quantityDelta);
      }
      return fetchJsonOrThrow("/api/pharmacy/adjustments", "Erro no ajuste.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lotId: selectedLot.id,
          quantityDelta,
          type: adjustForm.type,
          reason: adjustForm.reason.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      invalidateAll();
      setAdjustDialogOpen(false);
      setSelectedLot(null);
      toast({ title: "Ajuste registrado" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const openNewItem = () => {
    setEditingItem(null);
    setItemForm({
      name: "",
      activeIngredient: "",
      form: "",
      strengthValue: "",
      strengthUnit: "",
      unit: "cp",
      minStock: "0",
      controlled: false,
      active: true,
    });
    setItemDialogOpen(true);
  };

  const openEditItem = (item: PharmacyItemRow) => {
    setEditingItem(item);
    const parsed =
      item.strengthValue != null && item.strengthUnit
        ? { strengthValue: item.strengthValue, strengthUnit: item.strengthUnit }
        : parseStrengthText(item.strength);
    setItemForm({
      name: item.name,
      activeIngredient: item.activeIngredient || "",
      form: isPharmacyForm(item.form) ? item.form : item.form ? "outro" : "",
      strengthValue: parsed.strengthValue != null ? String(parsed.strengthValue) : "",
      strengthUnit: isStrengthUnit(parsed.strengthUnit) ? parsed.strengthUnit : "",
      unit: isStockUnit(item.unit) ? item.unit : "un",
      minStock: String(item.minStock ?? 0),
      controlled: !!item.controlled,
      active: item.active !== false,
    });
    setItemDialogOpen(true);
  };

  const openEntry = (defaults?: { scope?: string; residentId?: number; itemId?: number }) => {
    setEntryForm({
      itemId: defaults?.itemId ? String(defaults.itemId) : "",
      scope: defaults?.scope === "resident" ? "resident" : "org",
      residentId: defaults?.residentId ? String(defaults.residentId) : "",
      quantity: "",
      lotCode: "",
      expiryDate: "",
      source: defaults?.scope === "resident" ? "family" : "purchase",
      notes: "",
    });
    setEntryDialogOpen(true);
  };

  const openAdjust = (lot: PharmacyLotRow, type: "adjust" | "waste" = "adjust") => {
    setSelectedLot(lot);
    setAdjustForm({ quantityDelta: type === "waste" ? "" : "", type, reason: "" });
    setAdjustDialogOpen(true);
  };

  const alertCount = useMemo(() => {
    const a = alertsQuery.data;
    if (!a) return 0;
    return a.belowMinimum.length + a.expiringSoon.length + a.expired.length;
  }, [alertsQuery.data]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Farmácia e estoque</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo, estoque da casa, caixas dos residentes e baixa automática nas doses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openEntry()}>
            <Plus className="mr-2 h-4 w-4" />
            Nova entrada
          </Button>
          <Button onClick={openNewItem}>
            <Package className="mr-2 h-4 w-4" />
            Novo item
          </Button>
        </div>
      </div>

      <Tabs defaultValue="catalogo" className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="catalogo">Catálogo</TabsTrigger>
          <TabsTrigger value="casa">Estoque casa</TabsTrigger>
          <TabsTrigger value="caixas">Caixas residentes</TabsTrigger>
          <TabsTrigger value="movimentos">Movimentos</TabsTrigger>
          <TabsTrigger value="alertas" className="gap-1">
            Alertas
            {alertCount > 0 ? (
              <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                {alertCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalogo" className="space-y-3">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {itemsQuery.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Carregando catálogo...</p>
            ) : (itemsQuery.data?.length ?? 0) === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Nenhum item cadastrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Estoque (baixa)</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Mínimo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(itemsQuery.data ?? []).map((item) => {
                    const below = item.minStock > 0 && item.quantityOnHand < item.minStock;
                    const strengthText = formatPharmacyStrength(
                      item.strengthValue,
                      item.strengthUnit,
                      item.strength,
                    );
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {[
                              item.activeIngredient,
                              formatPharmacyFormLabel(item.form) || null,
                              strengthText,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </div>
                        </TableCell>
                        <TableCell>{formatStockUnitLabel(item.unit)}</TableCell>
                        <TableCell>
                          <span className={below ? "text-amber-700 font-medium" : ""}>
                            {item.quantityOnHand}
                          </span>
                        </TableCell>
                        <TableCell>{item.minStock}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.active ? (
                              <Badge variant="outline">Ativo</Badge>
                            ) : (
                              <Badge variant="secondary">Inativo</Badge>
                            )}
                            {item.controlled ? <Badge variant="destructive">Controlado</Badge> : null}
                            {below ? <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Abaixo do mínimo</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button size="sm" variant="outline" onClick={() => openEditItem(item)}>
                            Editar
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => openEntry({ itemId: item.id })}>
                            Entrada
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="casa" className="space-y-3">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {orgLotsQuery.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Carregando lotes...</p>
            ) : (orgLotsQuery.data?.length ?? 0) === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Nenhum lote no estoque da casa.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(orgLotsQuery.data ?? []).map((lot) => (
                    <TableRow key={lot.id}>
                      <TableCell className="font-medium">{lot.itemName}</TableCell>
                      <TableCell>{lot.lotCode || "—"}</TableCell>
                      <TableCell>{formatDate(lot.expiryDate)}</TableCell>
                      <TableCell>{lot.quantityOnHand}</TableCell>
                      <TableCell>{SOURCE_LABELS[lot.source] || lot.source}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => openAdjust(lot, "adjust")}>
                          Ajuste
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openAdjust(lot, "waste")}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="caixas" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Paciente</Label>
              <Select value={residentFilter} onValueChange={setResidentFilter}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {residents.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                openEntry({
                  scope: "resident",
                  residentId: residentFilter !== "all" ? Number(residentFilter) : undefined,
                })
              }
            >
              Entrada na caixa
            </Button>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {residentLotsQuery.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Carregando caixas...</p>
            ) : (residentLotsQuery.data?.length ?? 0) === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Nenhum lote nas caixas dos residentes.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(residentLotsQuery.data ?? []).map((lot) => (
                    <TableRow key={lot.id}>
                      <TableCell>{lot.residentName || "—"}</TableCell>
                      <TableCell className="font-medium">{lot.itemName}</TableCell>
                      <TableCell>{lot.lotCode || "—"}</TableCell>
                      <TableCell>{formatDate(lot.expiryDate)}</TableCell>
                      <TableCell>{lot.quantityOnHand}</TableCell>
                      <TableCell>{SOURCE_LABELS[lot.source] || lot.source}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => openAdjust(lot, "adjust")}>
                          Ajuste
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openAdjust(lot, "waste")}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="movimentos">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {movementsQuery.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Carregando movimentos...</p>
            ) : (movementsQuery.data?.length ?? 0) === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Nenhum movimento registrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Qtd</TableHead>
                    <TableHead>Escopo</TableHead>
                    <TableHead>Obs.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(movementsQuery.data ?? []).map((move) => (
                    <TableRow key={move.id}>
                      <TableCell>{formatDateTime(move.occurredAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {MOVE_LABELS[move.type] || move.type}
                          {move.stockShortage ? (
                            <Badge variant="destructive" className="text-[10px]">
                              Falta
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{move.itemName}</div>
                        <div className="text-xs text-muted-foreground">{move.lotCode || ""}</div>
                      </TableCell>
                      <TableCell>{move.quantity}</TableCell>
                      <TableCell>
                        {move.scope === "resident" ? move.residentName || "Residente" : "Casa"}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground">
                        {move.reason || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="alertas" className="space-y-4">
          {alertsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando alertas...</p>
          ) : alertCount === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              Nenhum alerta no momento.
            </div>
          ) : (
            <>
              {(alertsQuery.data?.belowMinimum.length ?? 0) > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <AlertTriangle className="h-4 w-4" /> Abaixo do mínimo
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {alertsQuery.data!.belowMinimum.map((row) => (
                      <li key={row.itemId}>
                        {row.name}: {row.quantityOnHand} {formatStockUnitLabel(row.unit)} (mín. {row.minStock})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(alertsQuery.data?.expiringSoon.length ?? 0) > 0 ? (
                <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 space-y-2">
                  <h3 className="text-sm font-semibold text-orange-900">A vencer (≤ 30 dias)</h3>
                  <ul className="space-y-1 text-sm">
                    {alertsQuery.data!.expiringSoon.map((row) => (
                      <li key={row.lotId}>
                        {row.itemName} · lote {row.lotCode || "—"} · {formatDate(row.expiryDate)} ·{" "}
                        {row.quantityOnHand} un.{" "}
                        {row.scope === "resident" ? `(${row.residentName || "residente"})` : "(casa)"}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(alertsQuery.data?.expired.length ?? 0) > 0 ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-2">
                  <h3 className="text-sm font-semibold text-rose-900">Vencidos</h3>
                  <ul className="space-y-1 text-sm">
                    {alertsQuery.data!.expired.map((row) => (
                      <li key={row.lotId}>
                        {row.itemName} · lote {row.lotCode || "—"} · {formatDate(row.expiryDate)} ·{" "}
                        {row.quantityOnHand} un.
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Editar item" : "Novo item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={itemForm.name} onChange={(e) => setItemForm((s) => ({ ...s, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Princípio ativo</Label>
                <Input
                  value={itemForm.activeIngredient}
                  onChange={(e) => setItemForm((s) => ({ ...s, activeIngredient: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Forma farmacêutica</Label>
                <Select
                  value={itemForm.form || "__none__"}
                  onValueChange={(v) =>
                    setItemForm((s) => ({ ...s, form: v === "__none__" ? "" : (v as PharmacyForm) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {PHARMACY_FORM_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PHARMACY_FORM_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Concentração (identidade clínica)</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  min={0.001}
                  step="any"
                  placeholder="Ex.: 500"
                  value={itemForm.strengthValue}
                  onChange={(e) => setItemForm((s) => ({ ...s, strengthValue: e.target.value }))}
                />
                <Select
                  value={itemForm.strengthUnit || "__none__"}
                  onValueChange={(v) =>
                    setItemForm((s) => ({
                      ...s,
                      strengthUnit: v === "__none__" ? "" : (v as StrengthUnit),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {STRENGTH_UNIT_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {STRENGTH_UNIT_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Opcional. Não entra no cálculo de estoque.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Unidade do estoque (baixa) *</Label>
                <Select
                  value={itemForm.unit}
                  onValueChange={(v) => setItemForm((s) => ({ ...s, unit: v as StockUnit }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STOCK_UNIT_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {STOCK_UNIT_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Estoque e doses baixam nesta unidade. Ex.: xarope → ml; comprimido → cp.
                </p>
              </div>
              <div className="space-y-1">
                <Label>Estoque mínimo</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={itemForm.minStock}
                  onChange={(e) => setItemForm((s) => ({ ...s, minStock: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={itemForm.controlled}
                  onCheckedChange={(checked) => setItemForm((s) => ({ ...s, controlled: checked }))}
                />
                Controlado
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={itemForm.active}
                  onCheckedChange={(checked) => setItemForm((s) => ({ ...s, active: checked }))}
                />
                Ativo
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => saveItem.mutate()} disabled={saveItem.isPending}>
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova entrada</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Item *</Label>
              <Select value={entryForm.itemId} onValueChange={(v) => setEntryForm((s) => ({ ...s, itemId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  {(itemsQuery.data ?? [])
                    .filter((i) => i.active)
                    .map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {formatPharmacyItemLabel(item)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Escopo</Label>
                <Select
                  value={entryForm.scope}
                  onValueChange={(v) =>
                    setEntryForm((s) => ({
                      ...s,
                      scope: v,
                      source: v === "resident" ? "family" : "purchase",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="org">Estoque da casa</SelectItem>
                    <SelectItem value="resident">Caixa do residente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Origem</Label>
                <Select value={entryForm.source} onValueChange={(v) => setEntryForm((s) => ({ ...s, source: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchase">Compra</SelectItem>
                    <SelectItem value="family">Família</SelectItem>
                    <SelectItem value="donation">Doação</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {entryForm.scope === "resident" ? (
              <div className="space-y-1">
                <Label>Paciente *</Label>
                <Select
                  value={entryForm.residentId}
                  onValueChange={(v) => setEntryForm((s) => ({ ...s, residentId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar paciente" />
                  </SelectTrigger>
                  <SelectContent>
                    {residents.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Quantidade *</Label>
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={entryForm.quantity}
                  onChange={(e) => setEntryForm((s) => ({ ...s, quantity: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Lote</Label>
                <Input
                  value={entryForm.lotCode}
                  onChange={(e) => setEntryForm((s) => ({ ...s, lotCode: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Validade</Label>
                <Input
                  type="date"
                  value={entryForm.expiryDate}
                  onChange={(e) => setEntryForm((s) => ({ ...s, expiryDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea
                rows={2}
                value={entryForm.notes}
                onChange={(e) => setEntryForm((s) => ({ ...s, notes: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEntryDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => createEntry.mutate()} disabled={createEntry.isPending}>
                Registrar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{adjustForm.type === "waste" ? "Descarte" : "Ajuste de lote"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {selectedLot?.itemName} · lote {selectedLot?.lotCode || "—"} · saldo {selectedLot?.quantityOnHand}
            </p>
            <div className="space-y-1">
              <Label>
                {adjustForm.type === "waste"
                  ? "Quantidade a descartar *"
                  : "Delta (positivo adiciona, negativo remove) *"}
              </Label>
              <Input
                type="number"
                step="0.01"
                value={adjustForm.quantityDelta}
                onChange={(e) => setAdjustForm((s) => ({ ...s, quantityDelta: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Motivo</Label>
              <Textarea
                rows={2}
                value={adjustForm.reason}
                onChange={(e) => setAdjustForm((s) => ({ ...s, reason: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdjustDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => adjustLot.mutate()} disabled={adjustLot.isPending}>
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
