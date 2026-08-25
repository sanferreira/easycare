import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Heart, LogOut, Pill, AlertTriangle, FileText, User, BedDouble,
  Activity, Thermometer, Wind, Smile, Calendar, Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { digitsOnly, maskPhoneBR } from "@/lib/masks";

type FamilySession = {
  id: number;
  name: string;
  relationship: string;
  residentId: number;
  organizationId: number;
  organizationName?: string;
  organizationPhone?: string | null;
};
type Resident = { id: number; name: string; birthDate: string; roomNumber: string; admissionDate: string; healthNotes?: string; allergies?: string; dietaryRestrictions?: string; mobilityStatus?: string; cognitiveStatus?: string; status: string };
type MedicalRecord = { id: number; date: string; title: string; content: string; type: string; bloodPressure?: string; heartRate?: number; temperature?: number; oxygenSat: number; weight?: number; mood?: string };
type Medication = { id: number; name: string; dosage: string; frequency: string; route?: string; scheduleTime?: string; prescribedBy?: string };
type Occurrence = { id: number; type: string; description: string; severity: string; status: string; createdAt: string; resolution?: string };

const moodLabel: Record<string, string> = {
  bom: "Bom", regular: "Regular", agitado: "Agitado", sonolento: "Sonolento", ansioso: "Ansioso", triste: "Triste",
};
const moodColor: Record<string, string> = {
  bom: "text-green-500", regular: "text-yellow-500", agitado: "text-red-500",
  sonolento: "text-blue-400", ansioso: "text-orange-500", triste: "text-purple-400",
};
const severityLabel: Record<string, string> = { low: "Leve", medium: "Moderada", high: "Grave", critical: "Crítica" };
const severityColor: Record<string, string> = {
  low: "border-yellow-300/25 bg-yellow-300/10 text-yellow-100",
  medium: "border-orange-300/25 bg-orange-300/10 text-orange-100",
  high: "border-red-300/25 bg-red-300/10 text-red-100",
  critical: "border-red-200/35 bg-red-400/15 text-red-50",
};

const portalCardClass = "rounded-lg border border-white/10 bg-white/[0.06] text-white shadow-2xl backdrop-blur-xl";
const mutedTextClass = "text-white/50";

function ageFromDate(birthDate: string) {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
  return age;
}

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR");
}
function formatDateTime(d: string) {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function buildPhoneHref(phone?: string | null) {
  const digits = digitsOnly(phone ?? "");
  return digits ? `tel:${digits}` : "";
}

export default function FamilyPortalHome() {
  const [_, setLocation] = useLocation();
  const [timelineFilter, setTimelineFilter] = useState<"all" | "records" | "medications" | "occurrences">("all");
  const queryClient = useQueryClient();

  const { data: me, isLoading: loadingMe } = useQuery<FamilySession | null>({
    queryKey: ["family-portal-me"],
    queryFn: async () => {
      const res = await fetch("/api/family-portal/me", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  useEffect(() => {
    if (!loadingMe && !me) setLocation("/portal");
  }, [loadingMe, me, setLocation]);

  const { data: resident, isLoading: loadingResident } = useQuery<Resident>({
    queryKey: ["family-portal-resident"],
    queryFn: async () => {
      const res = await fetch("/api/family-portal/resident", { credentials: "include" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    enabled: !!me,
  });

  const { data: records = [] } = useQuery<MedicalRecord[]>({
    queryKey: ["family-portal-records"],
    queryFn: async () => {
      const res = await fetch("/api/family-portal/medical-records", { credentials: "include" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    enabled: !!me,
  });

  const { data: medications = [] } = useQuery<Medication[]>({
    queryKey: ["family-portal-medications"],
    queryFn: async () => {
      const res = await fetch("/api/family-portal/medications", { credentials: "include" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    enabled: !!me,
  });

  const { data: occurrences = [] } = useQuery<Occurrence[]>({
    queryKey: ["family-portal-occurrences"],
    queryFn: async () => {
      const res = await fetch("/api/family-portal/occurrences", { credentials: "include" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
    enabled: !!me,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/family-portal/logout", { method: "POST", credentials: "include" });
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/portal");
    },
  });

  if (loadingMe) {
    return (
      <div className="min-h-screen bg-[#07122E] text-white">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(34,211,238,1) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative z-10 flex min-h-screen items-center justify-center text-sm text-white/45">
          Carregando portal...
        </div>
      </div>
    );
  }

  if (!me) {
    return null;
  }

  const latestRecord = records[0];
  const openOccurrences = occurrences.filter(o => o.status !== "resolved");
  const statItems = [
    { label: "Evoluções", value: records.length, icon: FileText },
    { label: "Medicações", value: medications.length, icon: Pill },
    { label: "Ocorrências abertas", value: openOccurrences.length, icon: AlertTriangle },
  ];
  const timelineItems = useMemo(() => {
    const recordItems = records.map((record) => ({
      id: `record-${record.id}`,
      kind: "records" as const,
      title: record.title || "Evolução compartilhada",
      description: record.content,
      date: record.date,
      icon: FileText,
      tone: "text-cyan-200",
    }));
    const medicationItems = medications.map((medication) => ({
      id: `medication-${medication.id}`,
      kind: "medications" as const,
      title: medication.name,
      description: `${medication.dosage} · ${medication.frequency}${medication.scheduleTime ? ` · ${medication.scheduleTime}` : ""}`,
      date: "",
      icon: Pill,
      tone: "text-emerald-200",
    }));
    const occurrenceItems = occurrences.map((occurrence) => ({
      id: `occurrence-${occurrence.id}`,
      kind: "occurrences" as const,
      title: occurrence.type,
      description: occurrence.description,
      date: occurrence.createdAt,
      icon: AlertTriangle,
      tone: "text-orange-200",
    }));
    return [...recordItems, ...medicationItems, ...occurrenceItems]
      .filter((item) => timelineFilter === "all" || item.kind === timelineFilter)
      .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());
  }, [medications, occurrences, records, timelineFilter]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07122E] text-white">
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,1) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07122E]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/easycare-logo.png" alt="EasyCare" className="h-10 w-10 shrink-0 object-contain" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-bold leading-none font-display">
                  Easy<span className="text-cyan-300">Care</span>
                </p>
                <span className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] font-semibold uppercase text-cyan-200">
                  Portal Família
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-white/42">
                {me.organizationName || "Instituição"} · {me.name} · {me.relationship}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-white/50 hover:bg-white/10 hover:text-white"
            onClick={() => logoutMutation.mutate()}
            data-testid="button-portal-logout"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          {loadingResident ? (
            <div className={`${portalCardClass} h-56 animate-pulse`} />
          ) : resident && (
            <div className={`${portalCardClass} p-5 sm:p-6`}>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase text-cyan-200">Paciente acompanhado</p>
                  <h1 className="mt-2 truncate text-3xl font-bold leading-tight font-display sm:text-4xl">
                    {resident.name}
                  </h1>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/58">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5">
                      <BedDouble className="h-3.5 w-3.5 text-cyan-200" />
                      Quarto {resident.roomNumber}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5">
                      <Calendar className="h-3.5 w-3.5 text-cyan-200" />
                      {ageFromDate(resident.birthDate)} anos
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5">
                      <User className="h-3.5 w-3.5 text-cyan-200" />
                      Desde {formatDate(resident.admissionDate)}
                    </span>
                  </div>
                </div>
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10">
                  <span className="text-3xl font-bold text-cyan-200">{resident.name.charAt(0)}</span>
                </div>
              </div>

              {(resident.allergies || resident.dietaryRestrictions) && (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                {resident.allergies && resident.allergies !== "Nenhuma conhecida" && resident.allergies !== "Nenhuma" && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-red-300/20 bg-red-300/10 px-2.5 py-1.5 text-xs font-medium text-red-50">
                    <AlertTriangle className="h-3 w-3" />
                    Alergia: {resident.allergies}
                  </span>
                )}
                {resident.dietaryRestrictions && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-yellow-300/20 bg-yellow-300/10 px-2.5 py-1.5 text-xs font-medium text-yellow-50">
                    Dieta: {resident.dietaryRestrictions}
                  </span>
                )}
                </div>
              )}
            </div>
          )}

          <Card className={portalCardClass}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
                  <FileText className="h-4 w-4 text-cyan-200" />
                  Última evolução
                </CardTitle>
                {latestRecord && <span className="text-xs text-white/38">{formatDate(latestRecord.date)}</span>}
              </div>
            </CardHeader>
            <CardContent>
              {latestRecord ? (
                <div className="space-y-4">
                  {(latestRecord.bloodPressure || latestRecord.heartRate || latestRecord.temperature || latestRecord.oxygenSat) && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {latestRecord.bloodPressure && (
                        <div className="rounded-md border border-red-300/15 bg-red-300/10 p-3">
                          <Activity className="mb-2 h-4 w-4 text-red-100" />
                          <p className="text-sm font-bold text-white">{latestRecord.bloodPressure}</p>
                          <p className="mt-0.5 text-[11px] text-red-100/60">Pressão</p>
                        </div>
                      )}
                      {latestRecord.heartRate && (
                        <div className="rounded-md border border-pink-300/15 bg-pink-300/10 p-3">
                          <Heart className="mb-2 h-4 w-4 text-pink-100" />
                          <p className="text-sm font-bold text-white">{latestRecord.heartRate} bpm</p>
                          <p className="mt-0.5 text-[11px] text-pink-100/60">Frequência</p>
                        </div>
                      )}
                      {latestRecord.temperature && (
                        <div className="rounded-md border border-orange-300/15 bg-orange-300/10 p-3">
                          <Thermometer className="mb-2 h-4 w-4 text-orange-100" />
                          <p className="text-sm font-bold text-white">{latestRecord.temperature}°C</p>
                          <p className="mt-0.5 text-[11px] text-orange-100/60">Temperatura</p>
                        </div>
                      )}
                      {latestRecord.oxygenSat && (
                        <div className="rounded-md border border-blue-300/15 bg-blue-300/10 p-3">
                          <Wind className="mb-2 h-4 w-4 text-blue-100" />
                          <p className="text-sm font-bold text-white">{latestRecord.oxygenSat}%</p>
                          <p className="mt-0.5 text-[11px] text-blue-100/60">SpO2</p>
                        </div>
                      )}
                    </div>
                  )}

                  {latestRecord.mood && (
                    <div className="flex items-center gap-2 text-xs text-white/55">
                      <Smile className="h-4 w-4 text-white/35" />
                      Humor:
                      <span className={`font-semibold ${moodColor[latestRecord.mood] || "text-white"}`}>
                        {moodLabel[latestRecord.mood] || latestRecord.mood}
                      </span>
                    </div>
                  )}

                  <p className="text-sm leading-6 text-white/72">{latestRecord.content}</p>

                  {records.length > 1 && (
                    <div className="border-t border-white/10 pt-3">
                      <p className="mb-2 text-xs font-semibold uppercase text-white/35">Registros anteriores</p>
                      {records.slice(1, 4).map((r) => (
                        <div key={r.id} className="grid grid-cols-[72px_1fr] gap-3 border-t border-white/8 py-2 first:border-t-0">
                          <span className="text-xs text-white/35">{formatDate(r.date)}</span>
                          <p className="line-clamp-2 text-xs leading-5 text-white/55">{r.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <FileText className="mx-auto mb-3 h-8 w-8 text-white/18" />
                  <p className="text-sm text-white/42">Nenhuma evolução compartilhada ainda</p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {statItems.map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
              <Icon className="h-4 w-4 text-cyan-200" />
              <p className="mt-3 text-2xl font-bold text-white">{value}</p>
              <p className="mt-1 text-xs font-medium text-white/42">{label}</p>
            </div>
          ))}
        </section>

        <Card className={portalCardClass}>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
                <Activity className="h-4 w-4 text-cyan-200" />
                Linha do tempo
              </CardTitle>
              <div className="grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-white/[0.04] p-1 sm:flex">
                {[
                  ["all", "Tudo"],
                  ["records", "Evoluções"],
                  ["medications", "Medicações"],
                  ["occurrences", "Ocorrências"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTimelineFilter(value as typeof timelineFilter)}
                    className={`h-8 rounded-md px-2 text-xs font-semibold transition ${
                      timelineFilter === value
                        ? "bg-cyan-300 text-[#07122E]"
                        : "text-white/45 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {timelineItems.length === 0 ? (
              <div className="py-8 text-center">
                <Activity className="mx-auto mb-3 h-8 w-8 text-white/18" />
                <p className="text-sm text-white/42">Nenhuma informação compartilhada neste filtro</p>
              </div>
            ) : (
              <div className="space-y-1">
                {timelineItems.slice(0, 8).map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.id} className="grid gap-3 border-t border-white/10 py-3 first:border-t-0 sm:grid-cols-[96px_1fr]">
                      <span className="text-xs text-white/35">
                        {item.date ? formatDateTime(item.date) : "Ativo"}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-white">
                          <Icon className={`h-4 w-4 ${item.tone}`} />
                          {item.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/55">{item.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card className={portalCardClass}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
                <Pill className="h-4 w-4 text-cyan-200" />
                Medicações ativas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {medications.length > 0 ? (
                <div className="divide-y divide-white/10">
                  {medications.map((med) => (
                    <div key={med.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-cyan-300/15 bg-cyan-300/10">
                        <Pill className="h-4 w-4 text-cyan-200" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">
                          {med.name} <span className="font-normal text-white/45">{med.dosage}</span>
                        </p>
                        <p className="mt-1 text-xs leading-5 text-white/45">
                          {med.frequency}{med.scheduleTime ? ` · ${med.scheduleTime}` : ""}
                        </p>
                        {med.prescribedBy && <p className="mt-0.5 text-xs text-white/35">Dr(a). {med.prescribedBy}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`py-8 text-center text-sm ${mutedTextClass}`}>Nenhuma medicação ativa compartilhada</p>
              )}
            </CardContent>
          </Card>

          <Card className={portalCardClass}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
                <AlertTriangle className="h-4 w-4 text-orange-200" />
                Ocorrências relevantes
                {openOccurrences.length > 0 && (
                  <Badge className="border border-orange-300/20 bg-orange-300/10 px-1.5 py-0 text-[10px] text-orange-100">
                    {openOccurrences.length} abertas
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {occurrences.length > 0 ? (
                <div className="divide-y divide-white/10">
                  {occurrences.map((occ) => (
                    <div key={occ.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{occ.type}</p>
                        <div className="flex shrink-0 gap-1.5">
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${severityColor[occ.severity]}`}>
                            {severityLabel[occ.severity]}
                          </span>
                          {occ.status === "resolved" && (
                            <span className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-medium text-emerald-100">
                              Resolvido
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs leading-5 text-white/58">{occ.description}</p>
                      {occ.resolution && <p className="text-xs font-medium text-emerald-100">{occ.resolution}</p>}
                      <p className="text-[10px] text-white/32">{formatDateTime(occ.createdAt)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`py-8 text-center text-sm ${mutedTextClass}`}>Nenhuma ocorrência relevante compartilhada</p>
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="rounded-lg border border-white/10 bg-white/[0.04] text-white backdrop-blur">
          <CardContent className="py-4 text-center">
            <p className="text-xs leading-relaxed text-white/40">
              Este portal mostra informações compartilhadas pela equipe da ILPI.<br />
              Para dúvidas urgentes, entre em contato diretamente com a unidade.
              {me.organizationPhone && (
                <>
                  <br />
                  <span className="mt-2 flex items-center justify-center gap-1">
                    <Phone className="h-3 w-3" />
                    <a href={buildPhoneHref(me.organizationPhone)} className="font-semibold text-cyan-200 hover:underline">
                      {maskPhoneBR(me.organizationPhone)}
                    </a>
                  </span>
                </>
              )}
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}



