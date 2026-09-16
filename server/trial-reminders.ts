import { storage } from "./storage";
import { resolveAppPublicUrl } from "./app-url";
import { sendTrialEndingCommercialEmail, sendTrialEndingEmail } from "./email";

let started = false;
let timer: NodeJS.Timeout | null = null;
let running = false;

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

function daysUntil(date: Date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function trialKey(date: Date) {
  return date.toISOString();
}

async function processTrialReminders() {
  if (running) return;
  running = true;
  try {
    const lookAheadDays = parseInteger(process.env.TRIAL_REMINDER_DAYS_BEFORE, 3, 1, 14);
    const now = new Date();
    const horizon = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
    const organizations = await storage.getOrganizations(true);
    const appBaseUrl = resolveAppPublicUrl();
    const supportWhatsappDisplay = process.env.VITE_SUPPORT_WHATSAPP_DISPLAY?.trim() || null;

    for (const organization of organizations) {
      if (!organization.manualAccessUntil) continue;
      if (organization.stripeSubscriptionStatus === "active" || organization.stripeSubscriptionStatus === "trialing") {
        continue;
      }

      const accessUntil = new Date(organization.manualAccessUntil);
      if (Number.isNaN(accessUntil.getTime())) continue;
      if (accessUntil.getTime() < now.getTime() || accessUntil.getTime() > horizon.getTime()) continue;

      const reminderKey = trialKey(accessUntil);
      if (organization.trialReminderSentFor === reminderKey) continue;

      const users = await storage.getUsersByOrganization(organization.id);
      const admin = users.find((user) => user.role === "admin" && user.active !== false && user.email)
        || users.find((user) => user.active !== false && user.email);
      if (!admin?.email) continue;

      const daysLeft = Math.max(1, daysUntil(accessUntil, now));
      await sendTrialEndingEmail({
        to: admin.email,
        adminName: admin.name,
        organizationName: organization.name,
        paymentMethod: organization.billingMethod,
        trialEndsAt: accessUntil,
        daysLeft,
        billingUrl: `${appBaseUrl}/billing`,
        supportWhatsappDisplay,
      });
      await sendTrialEndingCommercialEmail({
        organizationName: organization.name,
        cnpj: organization.cnpj,
        email: organization.email || admin.email,
        phone: organization.phone || admin.phone,
        paymentMethod: organization.billingMethod,
        trialEndsAt: accessUntil,
        daysLeft,
        adminUrl: `${appBaseUrl}/admin`,
      });

      await storage.updateOrganization(organization.id, {
        trialReminderSentFor: reminderKey,
      });
    }
  } catch (error) {
    console.error("[trial-reminders] falha ao processar lembretes", error);
  } finally {
    running = false;
  }
}

export function startTrialReminderWorker() {
  if (started) return;
  started = true;

  if (!parseBoolean(process.env.TRIAL_REMINDER_ENABLED, true)) {
    console.log("[trial-reminders] worker desabilitado");
    return;
  }

  const intervalMinutes = parseInteger(process.env.TRIAL_REMINDER_INTERVAL_MINUTES, 180, 15, 24 * 60);
  const intervalMs = intervalMinutes * 60 * 1000;

  void processTrialReminders();
  timer = setInterval(() => {
    void processTrialReminders();
  }, intervalMs);

  console.log(`[trial-reminders] worker iniciado (intervalo ${intervalMinutes} min)`);
}

export function stopTrialReminderWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
