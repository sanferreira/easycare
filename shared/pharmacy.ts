/** Shared pharmacy catalog enums and display helpers (ILPI stock layer). */

export const PHARMACY_FORM_VALUES = [
  "comprimido",
  "capsula",
  "solucao_oral",
  "xarope",
  "gotas",
  "ampola",
  "injecao",
  "creme",
  "pomada",
  "adesivo",
  "inalacao",
  "supositorio",
  "outro",
] as const;

export type PharmacyForm = (typeof PHARMACY_FORM_VALUES)[number];

export const PHARMACY_FORM_LABELS: Record<PharmacyForm, string> = {
  comprimido: "Comprimido",
  capsula: "Cápsula",
  solucao_oral: "Solução oral",
  xarope: "Xarope",
  gotas: "Gotas",
  ampola: "Ampola",
  injecao: "Injeção",
  creme: "Creme",
  pomada: "Pomada",
  adesivo: "Adesivo",
  inalacao: "Inalação",
  supositorio: "Supositório",
  outro: "Outro",
};

export const STRENGTH_UNIT_VALUES = [
  "mg",
  "mcg",
  "g",
  "mg_por_ml",
  "mg_por_5ml",
  "percent",
  "UI",
  "mEq",
] as const;

export type StrengthUnit = (typeof STRENGTH_UNIT_VALUES)[number];

export const STRENGTH_UNIT_LABELS: Record<StrengthUnit, string> = {
  mg: "mg",
  mcg: "mcg",
  g: "g",
  mg_por_ml: "mg/ml",
  mg_por_5ml: "mg/5 ml",
  percent: "%",
  UI: "UI",
  mEq: "mEq",
};

export const STOCK_UNIT_VALUES = ["cp", "ml", "ampola", "gota", "aplicacao", "un"] as const;

export type StockUnit = (typeof STOCK_UNIT_VALUES)[number];

export const STOCK_UNIT_LABELS: Record<StockUnit, string> = {
  cp: "Comprimido (cp)",
  ml: "Mililitro (ml)",
  ampola: "Ampola",
  gota: "Gota",
  aplicacao: "Aplicação",
  un: "Unidade (un)",
};

const pharmacyFormSet = new Set<string>(PHARMACY_FORM_VALUES);
const strengthUnitSet = new Set<string>(STRENGTH_UNIT_VALUES);
const stockUnitSet = new Set<string>(STOCK_UNIT_VALUES);

export function isPharmacyForm(value: unknown): value is PharmacyForm {
  return typeof value === "string" && pharmacyFormSet.has(value);
}

export function isStrengthUnit(value: unknown): value is StrengthUnit {
  return typeof value === "string" && strengthUnitSet.has(value);
}

export function isStockUnit(value: unknown): value is StockUnit {
  return typeof value === "string" && stockUnitSet.has(value);
}

export function normalizePharmacyForm(value: unknown): PharmacyForm | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim().toLowerCase();
  if (isPharmacyForm(raw)) return raw;

  const aliases: Record<string, PharmacyForm> = {
    comprimidos: "comprimido",
    "comp.": "comprimido",
    comp: "comprimido",
    tablet: "comprimido",
    cápsula: "capsula",
    capsulas: "capsula",
    cápsulas: "capsula",
    "solução oral": "solucao_oral",
    "solucao oral": "solucao_oral",
    xaropes: "xarope",
    syrup: "xarope",
    ampolas: "ampola",
    injeção: "injecao",
    injecoes: "injecao",
    cremes: "creme",
    pomadas: "pomada",
    adesivos: "adesivo",
    inalações: "inalacao",
    inalacaoes: "inalacao",
    supositórios: "supositorio",
    supositorios: "supositorio",
  };
  return aliases[raw] ?? "outro";
}

export function normalizeStockUnit(value: unknown): StockUnit {
  if (value == null || value === "") return "un";
  const raw = String(value).trim().toLowerCase();
  if (isStockUnit(raw)) return raw;

  const aliases: Record<string, StockUnit> = {
    comprimido: "cp",
    comprimidos: "cp",
    "comp.": "cp",
    comp: "cp",
    tablet: "cp",
    mililitro: "ml",
    mililitros: "ml",
    "mL": "ml",
    ampolas: "ampola",
    gotas: "gota",
    aplicação: "aplicacao",
    aplicacoes: "aplicacao",
    unidade: "un",
    unidades: "un",
    und: "un",
    frasco: "un",
    caixa: "un",
  };
  return aliases[raw] ?? "un";
}

export function normalizeStrengthUnit(value: unknown): StrengthUnit | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  if (isStrengthUnit(raw)) return raw;

  const aliases: Record<string, StrengthUnit> = {
    miligramas: "mg",
    miligrama: "mg",
    microgramas: "mcg",
    micrograma: "mcg",
    µg: "mcg",
    ug: "mcg",
    gramas: "g",
    grama: "g",
    "mg/ml": "mg_por_ml",
    "mg / ml": "mg_por_ml",
    "mg/5ml": "mg_por_5ml",
    "mg/5 ml": "mg_por_5ml",
    "mg / 5 ml": "mg_por_5ml",
    "%": "percent",
    percentual: "percent",
    ui: "UI",
    meq: "mEq",
  };
  return aliases[raw] ?? null;
}

/** Parse free-text strength like "500 mg" or "100mg/5ml" into structured parts. */
export function parseStrengthText(raw?: string | null): {
  strengthValue: number | null;
  strengthUnit: StrengthUnit | null;
} {
  if (!raw?.trim()) return { strengthValue: null, strengthUnit: null };
  const text = raw.trim().toLowerCase().replace(",", ".");
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
  if (!match) return { strengthValue: null, strengthUnit: null };
  const strengthValue = Number(match[1]);
  const strengthUnit = normalizeStrengthUnit(match[2]);
  if (!Number.isFinite(strengthValue) || strengthValue <= 0) {
    return { strengthValue: null, strengthUnit: null };
  }
  return { strengthValue, strengthUnit };
}

export function formatPharmacyStrength(
  strengthValue?: number | null,
  strengthUnit?: string | null,
  fallbackText?: string | null,
): string | null {
  if (
    strengthValue != null
    && Number.isFinite(strengthValue)
    && strengthValue > 0
    && isStrengthUnit(strengthUnit)
  ) {
    const label = STRENGTH_UNIT_LABELS[strengthUnit];
    const valueText = Number.isInteger(strengthValue)
      ? String(strengthValue)
      : String(strengthValue);
    return `${valueText} ${label}`;
  }
  const fallback = fallbackText?.trim();
  return fallback || null;
}

export function formatStockUnitLabel(unit?: string | null): string {
  if (isStockUnit(unit)) return STOCK_UNIT_LABELS[unit];
  return unit?.trim() || "un";
}

export function formatPharmacyFormLabel(form?: string | null): string {
  if (isPharmacyForm(form)) return PHARMACY_FORM_LABELS[form];
  return form?.trim() || "";
}

export function formatPharmacyItemLabel(item: {
  name: string;
  form?: string | null;
  strength?: string | null;
  strengthValue?: number | null;
  strengthUnit?: string | null;
  unit?: string | null;
}): string {
  const parts = [
    item.name.trim(),
    formatPharmacyFormLabel(item.form) || null,
    formatPharmacyStrength(item.strengthValue, item.strengthUnit, item.strength),
  ].filter(Boolean);
  const stock = formatStockUnitLabel(item.unit);
  return `${parts.join(" · ")} (${stock})`;
}
