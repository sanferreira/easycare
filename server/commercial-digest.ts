import { storage } from "./storage";
import { resolveAppPublicUrl } from "./app-url";
import { sendCommercialDigestEmail } from "./email";
import {
  isTrialEndingSoon,
  isBillingRisk,
  isWithoutPlan,
  isChurning,
  estimateMrrCents,
  formatCentsBRL,
} from "@shared/commercial";

let started = false;
let timer: NodeJS.Timeout | null = null;
let running = false;
let lastDigestDay: string | null = null;

function parseBoolean(value: string | undefined, fallback = true) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "sim"].includes(normalized)) return true;
  if (["0", "false", "no", "nao", "não"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value && value.trim() ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function processCommercialDigest() {
  if (running) return;
  running = true;
  try {
    const hour = parseInteger(process.env.COMMERCIAL_DIGEST_HOUR, 9, 0, 23);
    const now = new Date();
    if (now.getHours() < hour) return;
    const key = todayKey(now);
    if (lastDigestDay === key) return;

    const orgs = await storage.getOrganizations(true);
    let trialEnding = 0;
    let billingRisk = 0;
    let withoutPlan = 0;
    let churning = 0;
    let mrr = 0;

    for (const org of orgs) {
      if (isTrialEndingSoon(org)) trialEnding += 1;
      if (isBillingRisk(org)) billingRisk += 1;
      if (isWithoutPlan(org)) withoutPlan += 1;
      if (isChurning(org)) churning += 1;
      const est = estimateMrrCents(org);
      if (est) mrr += est;
    }

    const needsAction = trialEnding + billingRisk + withoutPlan;
    if (needsAction === 0 && churning === 0) {
      lastDigestDay = key;
      return;
    }

    await sendCommercialDigestEmail({
      needsAction,
      trialEnding,
      billingRisk,
      withoutPlan,
      churning,
      estimatedMrrFormatted: formatCentsBRL(mrr),
      adminUrl: `${resolveAppPublicUrl()}/admin?queue=needs_action`,
    });

    lastDigestDay = key;
  } catch (error) {
    console.error("[commercial-digest] falha", error);
  } finally {
    running = false;
  }
}

export function startCommercialDigestWorker() {
  if (started) return;
  started = true;
  if (!parseBoolean(process.env.COMMERCIAL_DIGEST_ENABLED, true)) {
    console.log("[commercial-digest] worker desabilitado");
    return;
  }
  const intervalMinutes = parseInteger(process.env.COMMERCIAL_DIGEST_INTERVAL_MINUTES, 60, 15, 24 * 60);
  void processCommercialDigest();
  timer = setInterval(() => {
    void processCommercialDigest();
  }, intervalMinutes * 60 * 1000);
  console.log(`[commercial-digest] worker iniciado (intervalo ${intervalMinutes} min)`);
}

export function stopCommercialDigestWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
