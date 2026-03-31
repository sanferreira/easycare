import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useResidents } from "@/hooks/use-residents";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus, FileText, Stethoscope, Heart, Users2,
  Activity, Thermometer, Wind, Smile, Lock, Eye, EyeOff, Globe, Trash2, Pencil
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { MedicalRecord, Comorbidity, FamilyMember } from "@shared/schema";
import { maskCpf, maskPhoneBR } from "@/lib/masks";

const evolutionSchema = z.object({
  date: z.string().min(1, "Data obrigatória"),
  type: z.enum(["evolution", "note", "anamnese", "prescription"]),
  title: z.string().optional(),
  content: z.string().min(1, "Conteúdo obrigatório"),
  visibility: z.enum(["internal", "shared"]),
  bloodPressure: z.string().optional(),
  heartRate: z.coerce.number().optional().nullable(),
  temperature: z.coerce.number().optional().nullable(),
  oxygenSat: z.coerce.number().optional().nullable(),
  weight: z.coerce.number().optional().nullable(),
  mood: z.string().optional(),
});

const comorbiditySchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  icd10: z.string().optional(),
  severity: z.enum(["mild", "moderate", "severe"]),
  notes: z.string().optional(),
  diagnosedAt: z.string().optional(),
});

const familySchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  relationship: z.string().min(1, "Parentesco obrigatório"),
  phone: z.string().min(1, "Telefone obrigatório"),
  phone2: z.string().optional(),
  email: z.string().optional(),
  cpf: z.string().optional(),
  address: z.string().optional(),
  isPrimary: z.boolean().default(false),
  portalAccess: z.boolean().default(false),
  portalUsername: z.string().optional(),
  portalPassword: z.string().optional(),
}).refine((d) => {
  if (d.portalAccess) {
    if (!d.portalUsername || d.portalUsername.trim().length < 3) return false;
  }
  return true;
}, { message: "Usuário de acesso (mín. 3 caracteres) é obrigatório para acesso ao portal", path: ["portalUsername"] });

const SEVERITY_MAP = {
  mild: { label: "Leve", color: "#22C55E" },
  moderate: { label: "Moderada", color: "#F59E0B" },
  severe: { label: "Grave", color: "#EF4444" },
};

const TYPE_MAP = {
  evolution: { label: "Evolução Diária", color: "#1F6FEB" },
  note: { label: "Anotação", color: "#8B5CF6" },
  anamnese: { label: "Anamnese", color: "#22D3EE" },
  prescription: { label: "Prescrição", color: "#22C55E" },
};

const MOOD_MAP: Record<string, string> = {
  bom: "😊 Bom",
  regular: "😐 Regular",
  agitado: "😤 Agitado",
  sonolento: "😴 Sonolento",
  ansioso: "😟 Ansioso",
  triste: "😢 Triste",
};

export default function Prontuario() {
  const [selectedResident, setSelectedResident] = useState<number | null>(null);
  const [evolutionOpen, setEvolutionOpen] = useState(false);
  const [comorbidityOpen, setComorbidityOpen] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [editingFamily, setEditingFamily] = useState<FamilyMember | null>(null);
  const [showPortalPassword, setShowPortalPassword] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: residents = [], isLoading: residentsLoading } = useResidents({ status: "active" });

  const resident = residents.find((r: any) => r.id === selectedResident);

  const { data: records = [] } = useQuery<MedicalRecord[]>({
    queryKey: ["/api/residents", selectedResident, "medical-records"],
    queryFn: async () => {
      const res = await fetch(`/api/residents/${selectedResident}/medical-records`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedResident,
  });

  const { data: comorbidities = [] } = useQuery<Comorbidity[]>({
    queryKey: ["/api/residents", selectedResident, "comorbidities"],
    queryFn: async () => {
      const res = await fetch(`/api/residents/${selectedResident}/comorbidities`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedResident,
  });

  const { data: family = [] } = useQuery<FamilyMember[]>({
    queryKey: ["/api/residents", selectedResident, "family"],
    queryFn: async () => {
      const res = await fetch(`/api/residents/${selectedResident}/family`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedResident,
  });

  // Evolution form
  const evolutionForm = useForm<z.infer<typeof evolutionSchema>>({
    resolver: zodResolver(evolutionSchema),
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
      type: "evolution",
      visibility: "internal",
      content: "",
    },
  });

  const createRecord = useMutation({
    mutationFn: async (data: z.infer<typeof evolutionSchema>) => {
      const res = await fetch(`/api/residents/${selectedResident}/medical-records`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "medical-records"] });
      setEvolutionOpen(false);
      evolutionForm.reset();
      toast({ title: "Registro salvo com sucesso" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao salvar registro" }),
  });

  // Comorbidity form
  const comorbidityForm = useForm<z.infer<typeof comorbiditySchema>>({
    resolver: zodResolver(comorbiditySchema),
    defaultValues: { severity: "moderate", name: "" },
  });

  const createComorbidity = useMutation({
    mutationFn: async (data: z.infer<typeof comorbiditySchema>) => {
      const res = await fetch(`/api/residents/${selectedResident}/comorbidities`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "comorbidities"] });
      setComorbidityOpen(false);
      comorbidityForm.reset();
      toast({ title: "Diagnóstico adicionado" });
    },
  });

  // Family form
  const familyForm = useForm<z.infer<typeof familySchema>>({
    resolver: zodResolver(familySchema),
    defaultValues: { isPrimary: false, name: "", relationship: "", phone: "", portalAccess: false, portalUsername: "", portalPassword: "" },
  });
  const portalAccessValue = familyForm.watch("portalAccess");

  const createFamily = useMutation({
    mutationFn: async (data: z.infer<typeof familySchema>) => {
      if (data.portalAccess && (!data.portalPassword || data.portalPassword.length < 4)) {
        throw new Error("Senha obrigatória para acesso ao portal (mín. 4 caracteres)");
      }
      const res = await fetch(`/api/residents/${selectedResident}/family`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erro ao cadastrar familiar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "family"] });
      setFamilyOpen(false);
      setShowPortalPassword(false);
      familyForm.reset();
      toast({ title: "Familiar cadastrado", description: "Acesso ao portal configurado com sucesso." });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: err.message }),
  });

  const updateFamily = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof familySchema> }) => {
      const payload: Record<string, unknown> = { ...data };
      if (!payload.portalPassword) delete payload.portalPassword;
      const res = await fetch(`/api/family/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Erro ao atualizar familiar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "family"] });
      setFamilyOpen(false);
      setEditingFamily(null);
      setShowPortalPassword(false);
      familyForm.reset();
      toast({ title: "Familiar atualizado com sucesso" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: err.message }),
  });

  const deleteRecord = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/medical-records/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir registro");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "medical-records"] });
      toast({ title: "Registro excluído" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir registro" }),
  });

  const deleteComorbidity = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/comorbidities/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir diagnóstico");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "comorbidities"] });
      toast({ title: "Diagnóstico excluído" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao excluir diagnóstico" }),
  });

  const deleteFamily = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/family/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erro ao excluir familiar");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/residents", selectedResident, "family"] });
      toast({ title: "Familiar removido" });
    },
    onError: () => toast({ variant: "destructive", title: "Erro ao remover familiar" }),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
          Prontuário
        </h1>
        <p className="text-muted-foreground mt-1">Histórico médico, evolução diária e informações clínicas dos residentes</p>
      </div>

      {/* Resident selector */}
      <Card className="shadow-sm">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-2 items-center">
            <p className="text-sm font-medium text-muted-foreground mr-2">Residente:</p>
            {residentsLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
            {residents.map((r: any) => (
              <button
                key={r.id}
                data-testid={`resident-selector-${r.id}`}
                onClick={() => setSelectedResident(r.id)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                  selectedResident === r.id
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {!selectedResident ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FileText className="h-14 w-14 text-muted-foreground/30 mb-4" />
          <p className="text-xl font-semibold text-muted-foreground">Selecione um residente</p>
          <p className="text-sm text-muted-foreground/60 mt-1">para visualizar o prontuário</p>
        </div>
      ) : (
        <>
          {/* Resident info bar */}
          {resident && (
            <div className="flex flex-wrap items-center gap-4 p-4 rounded-2xl border border-border bg-card shadow-sm">
              <div className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0"
                style={{ background: "linear-gradient(135deg, #1F6FEB, #22D3EE)" }}>
                {resident.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-foreground text-lg">{resident.name}</p>
                <div className="flex flex-wrap gap-3 mt-0.5">
                  {resident.birthDate && (
                    <span className="text-xs text-muted-foreground">
                      {new Date().getFullYear() - new Date(resident.birthDate + "T00:00:00").getFullYear()} anos
                    </span>
                  )}
                  {resident.roomNumber && <span className="text-xs text-muted-foreground">Quarto {resident.roomNumber}</span>}
                  {resident.bloodType && <Badge variant="outline" className="text-xs">{resident.bloodType}</Badge>}
                  {resident.mobilityStatus && <Badge variant="secondary" className="text-xs capitalize">{resident.mobilityStatus}</Badge>}
                  {resident.cognitiveStatus && <Badge variant="secondary" className="text-xs capitalize">{resident.cognitiveStatus}</Badge>}
                </div>
              </div>
              {resident.allergies && resident.allergies !== "Nenhuma" && resident.allergies !== "Nenhuma conhecida" && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                  ⚠️ Alergia: {resident.allergies}
                </div>
              )}
            </div>
          )}

          <Tabs defaultValue="evolution">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <TabsList className="h-10">
                <TabsTrigger value="evolution" data-testid="tab-evolution">
                  <Activity className="h-3.5 w-3.5 mr-1.5" />Evolução
                </TabsTrigger>
                <TabsTrigger value="diagnoses" data-testid="tab-diagnoses">
                  <Stethoscope className="h-3.5 w-3.5 mr-1.5" />Diagnósticos
                </TabsTrigger>
                <TabsTrigger value="family" data-testid="tab-family">
                  <Users2 className="h-3.5 w-3.5 mr-1.5" />Familiares
                </TabsTrigger>
              </TabsList>

              <div className="flex gap-2">
                {/* Nueva evolución */}
                <Dialog open={evolutionOpen} onOpenChange={setEvolutionOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-2 btn-glow" data-testid="button-add-evolution">
                      <Plus className="h-4 w-4" />Nova Evolução
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Registrar Evolução / Anotação</DialogTitle>
                    </DialogHeader>
                    <Form {...evolutionForm}>
                      <form onSubmit={evolutionForm.handleSubmit((d) => createRecord.mutate(d))} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={evolutionForm.control} name="date" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Data</FormLabel>
                              <FormControl><Input type="date" {...field} data-testid="input-record-date" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={evolutionForm.control} name="type" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Tipo</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger data-testid="select-record-type"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                  <SelectItem value="evolution">Evolução Diária</SelectItem>
                                  <SelectItem value="note">Anotação</SelectItem>
                                  <SelectItem value="anamnese">Anamnese</SelectItem>
                                  <SelectItem value="prescription">Prescrição</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>

                        <FormField control={evolutionForm.control} name="title" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Título (opcional)</FormLabel>
                            <FormControl><Input placeholder="Ex: Evolução matinal" {...field} /></FormControl>
                          </FormItem>
                        )} />

                        <FormField control={evolutionForm.control} name="content" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Conteúdo *</FormLabel>
                            <FormControl><Textarea rows={5} placeholder="Descreva o estado do paciente, procedimentos realizados, observações..." {...field} data-testid="textarea-record-content" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        {/* Vitals section */}
                        <div className="border border-border rounded-xl p-4 space-y-3">
                          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Heart className="h-4 w-4 text-primary" />Sinais Vitais (opcional)
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <FormField control={evolutionForm.control} name="bloodPressure" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Pressão Arterial</FormLabel>
                                <FormControl><Input placeholder="120/80" {...field} data-testid="input-blood-pressure" /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="heartRate" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">FC (bpm)</FormLabel>
                                <FormControl><Input type="number" placeholder="72" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="temperature" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Temperatura (°C)</FormLabel>
                                <FormControl><Input type="number" step="0.1" placeholder="36.5" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="oxygenSat" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">SpO2 (%)</FormLabel>
                                <FormControl><Input type="number" placeholder="97" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="weight" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Peso (kg)</FormLabel>
                                <FormControl><Input type="number" step="0.1" placeholder="65.0" {...field} value={field.value ?? ""} /></FormControl>
                              </FormItem>
                            )} />
                            <FormField control={evolutionForm.control} name="mood" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Humor</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    {Object.entries(MOOD_MAP).map(([val, label]) => (
                                      <SelectItem key={val} value={val}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )} />
                          </div>
                        </div>

                        <FormField control={evolutionForm.control} name="visibility" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Visibilidade</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger data-testid="select-visibility"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="internal">🔒 Interno (apenas equipe)</SelectItem>
                                <SelectItem value="shared">👁 Compartilhar com familiar</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />

                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => setEvolutionOpen(false)}>Cancelar</Button>
                          <Button type="submit" disabled={createRecord.isPending}>
                            {createRecord.isPending ? "Salvando..." : "Salvar Registro"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* EVOLUTION TAB */}
            <TabsContent value="evolution" className="space-y-3 mt-4">
              {records.length === 0 ? (
                <div className="text-center py-16">
                  <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">Nenhum registro no prontuário.</p>
                  <p className="text-sm text-muted-foreground/60">Clique em "Nova Evolução" para adicionar.</p>
                </div>
              ) : (
                records.map((record: any) => {
                  const typeInfo = TYPE_MAP[record.type as keyof typeof TYPE_MAP] ?? { label: record.type, color: "#888" };
                  return (
                    <div key={record.id} className="bg-card rounded-2xl border border-border/60 shadow-sm p-5" data-testid={`record-${record.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                            style={{ background: `${typeInfo.color}18` }}>
                            <Activity className="h-4 w-4" style={{ color: typeInfo.color }} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge className="text-xs" style={{ background: `${typeInfo.color}20`, color: typeInfo.color, border: `1px solid ${typeInfo.color}30` }}>
                                {typeInfo.label}
                              </Badge>
                              {record.visibility === "shared"
                                ? <span className="text-xs text-green-600 flex items-center gap-1"><Eye className="h-3 w-3" />Compartilhado</span>
                                : <span className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />Interno</span>
                              }
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(record.date + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR })}
                              {record.title && ` · ${record.title}`}
                            </p>
                          </div>
                        </div>

                        {/* Vitals badge row */}
                        {(record.bloodPressure || record.heartRate || record.temperature || record.oxygenSat) && (
                          <div className="flex flex-wrap gap-2">
                            {record.bloodPressure && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100">
                                <Heart className="h-3 w-3" />{record.bloodPressure}
                              </span>
                            )}
                            {record.heartRate && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-pink-50 text-pink-700 border border-pink-100">
                                {record.heartRate} bpm
                              </span>
                            )}
                            {record.temperature && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-100">
                                <Thermometer className="h-3 w-3" />{record.temperature}°C
                              </span>
                            )}
                            {record.oxygenSat && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
                                <Wind className="h-3 w-3" />{record.oxygenSat}%
                              </span>
                            )}
                            {record.mood && (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-100">
                                <Smile className="h-3 w-3" />{MOOD_MAP[record.mood] ?? record.mood}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap flex-1">{record.content}</p>
                        <button
                          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          disabled={deleteRecord.isPending}
                          onClick={() => {
                            if (confirm("Excluir este registro do prontuário? Esta ação não pode ser desfeita."))
                              deleteRecord.mutate(record.id);
                          }}
                          data-testid={`button-delete-record-${record.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </TabsContent>

            {/* DIAGNOSES TAB */}
            <TabsContent value="diagnoses" className="mt-4">
              <div className="flex justify-end mb-4">
                <Dialog open={comorbidityOpen} onOpenChange={setComorbidityOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-2" data-testid="button-add-comorbidity">
                      <Plus className="h-4 w-4" />Adicionar Diagnóstico
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Novo Diagnóstico / Comorbidade</DialogTitle>
                    </DialogHeader>
                    <Form {...comorbidityForm}>
                      <form onSubmit={comorbidityForm.handleSubmit((d) => createComorbidity.mutate(d))} className="space-y-4">
                        <FormField control={comorbidityForm.control} name="name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nome do Diagnóstico *</FormLabel>
                            <FormControl><Input placeholder="Ex: Hipertensão Arterial Sistêmica" {...field} data-testid="input-comorbidity-name" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={comorbidityForm.control} name="icd10" render={({ field }) => (
                            <FormItem>
                              <FormLabel>CID-10</FormLabel>
                              <FormControl><Input placeholder="Ex: I10" {...field} /></FormControl>
                            </FormItem>
                          )} />
                          <FormField control={comorbidityForm.control} name="severity" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Gravidade</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                  <SelectItem value="mild">Leve</SelectItem>
                                  <SelectItem value="moderate">Moderada</SelectItem>
                                  <SelectItem value="severe">Grave</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )} />
                        </div>
                        <FormField control={comorbidityForm.control} name="diagnosedAt" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Data do Diagnóstico</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={comorbidityForm.control} name="notes" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Observações</FormLabel>
                            <FormControl><Textarea rows={2} {...field} /></FormControl>
                          </FormItem>
                        )} />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => setComorbidityOpen(false)}>Cancelar</Button>
                          <Button type="submit" disabled={createComorbidity.isPending}>Salvar</Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {comorbidities.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">Nenhum diagnóstico registrado.</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {comorbidities.map((c: any) => {
                    const sev = SEVERITY_MAP[c.severity as keyof typeof SEVERITY_MAP] ?? { label: c.severity, color: "#888" };
                    return (
                      <div key={c.id} className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm" data-testid={`comorbidity-${c.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-foreground text-sm">{c.name}</p>
                            {c.icd10 && <p className="text-xs text-muted-foreground mt-0.5">CID-10: {c.icd10}</p>}
                            {c.diagnosedAt && <p className="text-xs text-muted-foreground">Diagnóstico: {format(new Date(c.diagnosedAt + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR })}</p>}
                            {c.notes && <p className="text-xs text-muted-foreground mt-1">{c.notes}</p>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge className="text-xs" style={{ background: `${sev.color}18`, color: sev.color, border: `1px solid ${sev.color}30` }}>
                              {sev.label}
                            </Badge>
                            <button
                              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              disabled={deleteComorbidity.isPending}
                              onClick={() => {
                                if (confirm(`Excluir diagnóstico "${c.name}"?`))
                                  deleteComorbidity.mutate(c.id);
                              }}
                              data-testid={`button-delete-comorbidity-${c.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* FAMILY TAB */}
            <TabsContent value="family" className="mt-4">
              <div className="flex justify-end mb-4">
                <Dialog open={familyOpen} onOpenChange={(open) => {
                  setFamilyOpen(open);
                  if (!open) { setEditingFamily(null); setShowPortalPassword(false); familyForm.reset({ isPrimary: false, name: "", relationship: "", phone: "", portalAccess: false, portalUsername: "", portalPassword: "" }); }
                }}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-2" data-testid="button-add-family">
                      <Plus className="h-4 w-4" />Adicionar Familiar
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>{editingFamily ? "Editar Familiar / Responsável" : "Cadastrar Familiar / Responsável"}</DialogTitle>
                    </DialogHeader>
                    <Form {...familyForm}>
                      <form onSubmit={familyForm.handleSubmit((d) => {
                        if (editingFamily) updateFamily.mutate({ id: editingFamily.id, data: d });
                        else createFamily.mutate(d);
                      })} className="space-y-4">
                        <FormField control={familyForm.control} name="name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nome Completo *</FormLabel>
                            <FormControl><Input placeholder="Nome do familiar" {...field} data-testid="input-family-name" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={familyForm.control} name="relationship" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Parentesco *</FormLabel>
                              <FormControl><Input placeholder="Ex: Filho, Filha, Cônjuge" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={familyForm.control} name="phone" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Telefone *</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="(11) 9xxxx-xxxx"
                                  maxLength={15}
                                  {...field}
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(maskPhoneBR(e.target.value))}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={familyForm.control} name="phone2" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Telefone 2</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Alternativo"
                                  maxLength={15}
                                  {...field}
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(maskPhoneBR(e.target.value))}
                                />
                              </FormControl>
                            </FormItem>
                          )} />
                          <FormField control={familyForm.control} name="email" render={({ field }) => (
                            <FormItem>
                              <FormLabel>E-mail</FormLabel>
                              <FormControl><Input type="email" {...field} /></FormControl>
                            </FormItem>
                          )} />
                        </div>
                        <FormField control={familyForm.control} name="cpf" render={({ field }) => (
                          <FormItem>
                            <FormLabel>CPF</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="000.000.000-00"
                                maxLength={14}
                                {...field}
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(maskCpf(e.target.value))}
                              />
                            </FormControl>
                          </FormItem>
                        )} />
                        <FormField control={familyForm.control} name="address" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Endereço</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                          </FormItem>
                        )} />

                        {/* Portal access section */}
                        <div className="border border-border/60 rounded-xl p-4 space-y-3" style={{ background: "rgba(34,211,238,0.04)" }}>
                          <FormField control={familyForm.control} name="portalAccess" render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Globe className="h-4 w-4" style={{ color: "#22D3EE" }} />
                                  <FormLabel className="text-sm font-semibold cursor-pointer" style={{ color: "#22D3EE" }}>
                                    Acesso ao Portal da Família
                                  </FormLabel>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={field.value}
                                  onClick={() => field.onChange(!field.value)}
                                  className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
                                  style={{ background: field.value ? "#22D3EE" : "#e2e8f0" }}
                                  data-testid="toggle-portal-access"
                                >
                                  <span
                                    className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg transition-transform"
                                    style={{ transform: field.value ? "translateX(20px)" : "translateX(0)" }}
                                  />
                                </button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Ao ativar, o familiar poderá acessar o portal em <strong>/portal</strong> para acompanhar o residente.
                              </p>
                            </FormItem>
                          )} />

                          {portalAccessValue && (
                            <div className="grid grid-cols-2 gap-3 pt-1">
                              <FormField control={familyForm.control} name="portalUsername" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Usuário de acesso *</FormLabel>
                                  <FormControl>
                                    <Input placeholder="ex: joao.silva" {...field} data-testid="input-portal-username" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                              <FormField control={familyForm.control} name="portalPassword" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Senha {editingFamily ? "" : "*"}</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        type={showPortalPassword ? "text" : "password"}
                                        placeholder={editingFamily ? "••••  (deixe em branco para manter)" : "mín. 4 caracteres"}
                                        {...field}
                                        data-testid="input-portal-password"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setShowPortalPassword(!showPortalPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                      >
                                        {showPortalPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                      </button>
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => { setFamilyOpen(false); setEditingFamily(null); }}>Cancelar</Button>
                          <Button type="submit" disabled={createFamily.isPending || updateFamily.isPending}>
                            {editingFamily ? "Salvar alterações" : "Cadastrar"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {family.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">Nenhum familiar cadastrado.</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {family.map((f: any) => (
                    <div key={f.id} className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm" data-testid={`family-${f.id}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                          style={{ background: f.isPrimary ? "linear-gradient(135deg, #1F6FEB, #22D3EE)" : "#94A3B8" }}>
                          {f.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground text-sm truncate">{f.name}</p>
                            {f.isPrimary && <Badge className="text-xs" variant="default">Principal</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{f.relationship}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            onClick={() => {
                              setEditingFamily(f);
                              familyForm.reset({
                                name: f.name,
                                relationship: f.relationship,
                                phone: maskPhoneBR(f.phone),
                                phone2: f.phone2 ? maskPhoneBR(f.phone2) : "",
                                email: f.email ?? "",
                                cpf: f.cpf ? maskCpf(f.cpf) : "",
                                address: f.address ?? "",
                                isPrimary: f.isPrimary ?? false,
                                portalAccess: f.portalAccess ?? false,
                                portalUsername: f.portalUsername ?? "",
                                portalPassword: "",
                              });
                              setFamilyOpen(true);
                            }}
                            data-testid={`button-edit-family-${f.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            disabled={deleteFamily.isPending}
                            onClick={() => {
                              if (confirm(`Remover "${f.name}" dos familiares? ${f.portalAccess ? "O acesso ao portal desta pessoa também será removido." : ""}`))
                                deleteFamily.mutate(f.id);
                            }}
                            data-testid={`button-delete-family-${f.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        <p>📞 {maskPhoneBR(f.phone)}</p>
                        {f.phone2 && <p>📞 {maskPhoneBR(f.phone2)}</p>}
                        {f.email && <p>✉️ {f.email}</p>}
                      </div>
                      {f.portalAccess && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg w-fit"
                          style={{ background: "rgba(34,211,238,0.1)", color: "#22D3EE" }}>
                          <Globe className="h-3 w-3" />
                          Portal ativo · @{f.portalUsername}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
