import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Heart, LogOut, Pill, AlertTriangle, FileText, User, BedDouble,
  Activity, Thermometer, Wind, Weight, Smile, ChevronRight, Calendar, Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type FamilySession = { id: number; name: string; relationship: string; residentId: number; organizationId: number };
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
  low: "bg-yellow-100 text-yellow-800", medium: "bg-orange-100 text-orange-800",
  high: "bg-red-100 text-red-800", critical: "bg-red-200 text-red-900",
};

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

export default function FamilyPortalHome() {
  const [_, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: me } = useQuery<FamilySession>({
    queryKey: ["family-portal-me"],
    queryFn: async () => {
      const res = await fetch("/api/family-portal/me", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

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

  if (!me) {
    setLocation("/portal");
    return null;
  }

  const latestRecord = records[0];
  const openOccurrences = occurrences.filter(o => o.status !== "resolved");

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #ECFEFF 0%, #F8FAFC 100%)" }}>
      {/* Header */}
      <header className="sticky top-0 z-10 border-b"
        style={{ background: "#0A0F2C", borderColor: "rgba(34,211,238,0.15)" }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="relative">
              <img src="/easycare-logo.png" alt="EasyCare" className="h-8 w-8 object-contain rounded-lg" />
              <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0A0F2C]" style={{ background: "#22D3EE" }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold" style={{ fontFamily: "var(--font-display)", color: "white" }}>
                Easy<span style={{ color: "#22D3EE" }}>Care</span>{" "}
                <span className="text-xs font-normal px-1.5 py-0.5 rounded-md ml-0.5"
                  style={{ background: "rgba(34,211,238,0.12)", color: "#22D3EE", fontSize: "10px" }}>
                  Portal Família
                </span>
              </p>
              <p className="text-[10px] leading-none mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{me.name} · {me.relationship}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-center gap-1.5 text-xs sm:w-auto"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onClick={() => logoutMutation.mutate()} data-testid="button-portal-logout">
            <LogOut className="h-3.5 w-3.5" />
            Sair
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Resident card */}
        {loadingResident ? (
          <div className="h-32 rounded-2xl animate-pulse" style={{ background: "rgba(34,211,238,0.08)" }} />
        ) : resident && (
          <div className="rounded-2xl p-5 shadow-lg border"
            style={{
              background: "linear-gradient(135deg, #0A0F2C 0%, #0e1a3a 100%)",
              borderColor: "rgba(34,211,238,0.3)",
              boxShadow: "0 4px 24px rgba(34,211,238,0.12)",
            }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#22D3EE" }}>Seu familiar</p>
                <h2 className="text-2xl font-bold text-white truncate" style={{ fontFamily: "var(--font-display)" }}>{resident.name}</h2>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="flex items-center gap-1 text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                    <BedDouble className="h-3.5 w-3.5" />
                    Quarto {resident.roomNumber}
                  </span>
                  <span className="flex items-center gap-1 text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                    <Calendar className="h-3.5 w-3.5" />
                    {ageFromDate(resident.birthDate)} anos
                  </span>
                  <span className="flex items-center gap-1 text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                    <User className="h-3.5 w-3.5" />
                    Internado desde {formatDate(resident.admissionDate)}
                  </span>
                </div>
              </div>
              <div className="h-14 w-14 rounded-full flex items-center justify-center shrink-0 border-2"
                style={{ background: "rgba(34,211,238,0.15)", borderColor: "rgba(34,211,238,0.4)" }}>
                <span className="text-2xl font-bold" style={{ color: "#22D3EE" }}>{resident.name.charAt(0)}</span>
              </div>
            </div>

            {(resident.allergies || resident.dietaryRestrictions) && (
              <div className="mt-3 pt-3 border-t flex flex-wrap gap-2" style={{ borderColor: "rgba(34,211,238,0.15)" }}>
                {resident.allergies && resident.allergies !== "Nenhuma conhecida" && resident.allergies !== "Nenhuma" && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-white border border-red-300/20">
                    <AlertTriangle className="h-3 w-3" />
                    Alergia: {resident.allergies}
                  </span>
                )}
                {resident.dietaryRestrictions && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-white border border-yellow-300/20">
                    Dieta: {resident.dietaryRestrictions}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Latest evolution */}
        {latestRecord && (
          <Card className="shadow-sm" style={{ borderColor: "rgba(34,211,238,0.2)" }}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <FileText className="h-4 w-4" style={{ color: "#22D3EE" }} />
                  Última Evolução
                </CardTitle>
                <span className="text-xs text-gray-400">{formatDate(latestRecord.date)}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Vitals */}
              {(latestRecord.bloodPressure || latestRecord.heartRate || latestRecord.temperature || latestRecord.oxygenSat) && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {latestRecord.bloodPressure && (
                    <div className="rounded-xl p-2.5 bg-red-50 border border-red-100 text-center">
                      <Activity className="h-3.5 w-3.5 text-red-400 mx-auto mb-1" />
                      <p className="text-xs font-bold text-red-700">{latestRecord.bloodPressure}</p>
                      <p className="text-[10px] text-red-400">Pressão</p>
                    </div>
                  )}
                  {latestRecord.heartRate && (
                    <div className="rounded-xl p-2.5 bg-pink-50 border border-pink-100 text-center">
                      <Heart className="h-3.5 w-3.5 text-pink-400 mx-auto mb-1" />
                      <p className="text-xs font-bold text-pink-700">{latestRecord.heartRate} bpm</p>
                      <p className="text-[10px] text-pink-400">Frequência</p>
                    </div>
                  )}
                  {latestRecord.temperature && (
                    <div className="rounded-xl p-2.5 bg-orange-50 border border-orange-100 text-center">
                      <Thermometer className="h-3.5 w-3.5 text-orange-400 mx-auto mb-1" />
                      <p className="text-xs font-bold text-orange-700">{latestRecord.temperature}°C</p>
                      <p className="text-[10px] text-orange-400">Temperatura</p>
                    </div>
                  )}
                  {latestRecord.oxygenSat && (
                    <div className="rounded-xl p-2.5 bg-blue-50 border border-blue-100 text-center">
                      <Wind className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
                      <p className="text-xs font-bold text-blue-700">{latestRecord.oxygenSat}%</p>
                      <p className="text-[10px] text-blue-400">SpO₂</p>
                    </div>
                  )}
                </div>
              )}

              {latestRecord.mood && (
                <div className="flex items-center gap-2">
                  <Smile className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-xs text-gray-500">Humor:</span>
                  <span className={`text-xs font-semibold ${moodColor[latestRecord.mood] || "text-gray-600"}`}>
                    {moodLabel[latestRecord.mood] || latestRecord.mood}
                  </span>
                </div>
              )}

              <p className="text-sm text-gray-700 leading-relaxed">{latestRecord.content}</p>

              {records.length > 1 && (
                <>
                  <Separator />
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Registros anteriores ({records.length - 1})</p>
                  {records.slice(1, 4).map((r) => (
                    <div key={r.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                      <span className="text-xs text-gray-400 shrink-0 mt-0.5">{formatDate(r.date)}</span>
                      <p className="text-xs text-gray-600 line-clamp-2">{r.content}</p>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {records.length === 0 && (
          <Card className="shadow-sm" style={{ borderColor: "rgba(34,211,238,0.15)" }}>
            <CardContent className="py-8 text-center">
              <FileText className="h-8 w-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Nenhuma evolução compartilhada ainda</p>
            </CardContent>
          </Card>
        )}

        {/* Medications */}
        {medications.length > 0 && (
          <Card className="shadow-sm" style={{ borderColor: "rgba(34,211,238,0.2)" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Pill className="h-4 w-4" style={{ color: "#22D3EE" }} />
                Medicações Ativas ({medications.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {medications.map((med) => (
                <div key={med.id} className="flex items-start gap-3 p-3 rounded-xl border"
                  style={{ background: "rgba(34,211,238,0.06)", borderColor: "rgba(34,211,238,0.2)" }}>
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "rgba(34,211,238,0.15)" }}>
                    <Pill className="h-4 w-4" style={{ color: "#22D3EE" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{med.name} <span className="font-normal text-gray-500">{med.dosage}</span></p>
                    <p className="text-xs text-gray-500 mt-0.5">{med.frequency}{med.scheduleTime ? ` · ${med.scheduleTime}` : ""}</p>
                    {med.prescribedBy && <p className="text-xs text-gray-400 mt-0.5">Dr(a). {med.prescribedBy}</p>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Occurrences */}
        {occurrences.length > 0 && (
          <Card className="shadow-sm border-orange-100">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Ocorrências Relevantes
                {openOccurrences.length > 0 && (
                  <Badge className="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0">{openOccurrences.length} abertas</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {occurrences.map((occ) => (
                <div key={occ.id} className="p-3 rounded-xl border border-gray-100 bg-white space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-800">{occ.type}</p>
                    <div className="flex gap-1.5 shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${severityColor[occ.severity]}`}>
                        {severityLabel[occ.severity]}
                      </span>
                      {occ.status === "resolved" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Resolvido</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-600">{occ.description}</p>
                  {occ.resolution && <p className="text-xs text-green-700 font-medium">✓ {occ.resolution}</p>}
                  <p className="text-[10px] text-gray-400">{formatDateTime(occ.createdAt)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Info section */}
        <Card className="shadow-sm border-gray-100">
          <CardContent className="py-4">
            <p className="text-xs text-gray-400 text-center leading-relaxed">
              Este portal mostra informações compartilhadas pela equipe da ILPI.<br />
              Para dúvidas urgentes, entre em contato diretamente com a unidade.
              <br />
              <span className="flex items-center justify-center gap-1 mt-2">
                <Phone className="h-3 w-3" />
                <a href="tel:" className="hover:underline" style={{ color: "#22D3EE" }}>Ligue para a ILPI</a>
              </span>
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}



