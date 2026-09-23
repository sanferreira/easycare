/** Shared helpers for EasyCare SaaS commercial hub (/admin Contas). */

export const LIFECYCLE_STAGES = [
  "trial",
  "onboarding",
  "active",
  "at_risk",
  "churning",
  "churned",
  "special",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const COMMERCIAL_QUEUES = [
  "trial_ending",
  "billing_risk",
  "manual_boleto",
  "onboarding_low",
  "churning",
  "without_plan",
  "needs_action",
] as const;

export type CommercialQueue = (typeof COMMERCIAL_QUEUES)[number];

export const DEFAULT_PAYMENT_GRACE_DAYS = 10;

export function paymentGraceDays(value?: number | null) {
  return Number.isInteger(value) && (value as number) >= 0
    ? Math.min(value as number, 60)
    : DEFAULT_PAYMENT_GRACE_DAYS;
}

export function isWithinGracePeriod(value?: string | Date | null, graceDays = DEFAULT_PAYMENT_GRACE_DAYS) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() <= date.getTime() + graceDays * 24 * 60 * 60 * 1000;
}

export function stripeStatusAllowsAccess(org: {
  stripeSubscriptionStatus?: string | null;
  subscriptionUpdatedAt?: string | Date | null;
  paymentGraceDays?: number | null;
}) {
  if (org.stripeSubscriptionStatus === "active" || org.stripeSubscriptionStatus === "trialing") return true;
  if (
    org.stripeSubscriptionStatus === "past_due"
    || org.stripeSubscriptionStatus === "unpaid"
    || org.stripeSubscriptionStatus === "incomplete"
  ) {
    return isWithinGracePeriod(org.subscriptionUpdatedAt, paymentGraceDays(org.paymentGraceDays));
  }
  return false;
}

export function manualAccessExpired(value?: string | Date | null) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

export function manualAccessIsCurrent(value?: string | Date | null) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now();
}

export type OrgStatus = "active" | "inactive" | "restricted";

export function resolveOrgStatus(org: {
  status?: string | null;
  active?: boolean | null;
  stripeSubscriptionStatus?: string | null;
  subscriptionUpdatedAt?: string | Date | null;
  paymentGraceDays?: number | null;
  manualAccessUntil?: string | Date | null;
}): OrgStatus {
  const normalized =
    org.status === "active" || org.status === "inactive" || org.status === "restricted"
      ? org.status
      : org.active
        ? "active"
        : "inactive";
  if (normalized === "restricted" && (stripeStatusAllowsAccess(org) || manualAccessIsCurrent(org.manualAccessUntil))) {
    return "active";
  }
  const hasStripeStatus =
    typeof org.stripeSubscriptionStatus === "string" && org.stripeSubscriptionStatus.trim().length > 0;
  if (
    normalized === "active"
    && !stripeStatusAllowsAccess(org)
    && (manualAccessExpired(org.manualAccessUntil) || hasStripeStatus)
  ) {
    return "restricted";
  }
  return normalized as OrgStatus;
}

export function daysUntilDate(value?: string | Date | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/** Manual trial ending within N days (not superseded by active Stripe). */
export function isManualTrialEndingSoon(
  org: {
    manualAccessUntil?: string | Date | null;
    stripeSubscriptionStatus?: string | null;
  },
  withinDays = 7,
) {
  if (!org.manualAccessUntil) return false;
  if (org.stripeSubscriptionStatus === "active" || org.stripeSubscriptionStatus === "trialing") return false;
  const days = daysUntilDate(org.manualAccessUntil);
  return days !== null && days >= 0 && days <= withinDays;
}

export function isStripeTrialEndingSoon(
  org: {
    stripeSubscriptionStatus?: string | null;
    subscriptionCurrentPeriodEnd?: string | Date | null;
  },
  withinDays = 7,
) {
  if (org.stripeSubscriptionStatus !== "trialing") return false;
  const days = daysUntilDate(org.subscriptionCurrentPeriodEnd);
  return days !== null && days >= 0 && days <= withinDays;
}

export function isTrialEndingSoon(
  org: {
    manualAccessUntil?: string | Date | null;
    stripeSubscriptionStatus?: string | null;
    subscriptionCurrentPeriodEnd?: string | Date | null;
  },
  withinDays = 7,
) {
  return isManualTrialEndingSoon(org, withinDays) || isStripeTrialEndingSoon(org, withinDays);
}

export function isBillingRisk(org: {
  status?: string | null;
  active?: boolean | null;
  stripeSubscriptionStatus?: string | null;
  subscriptionUpdatedAt?: string | Date | null;
  paymentGraceDays?: number | null;
  manualAccessUntil?: string | Date | null;
}) {
  const orgStatus = resolveOrgStatus(org);
  const stripe = org.stripeSubscriptionStatus;
  return (
    orgStatus === "restricted"
    || stripe === "past_due"
    || stripe === "unpaid"
    || stripe === "incomplete"
  );
}

export function isWithoutPlan(org: {
  stripeSubscriptionStatus?: string | null;
  billingMethod?: string | null;
  manualAccessUntil?: string | Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}) {
  return (
    !org.stripeSubscriptionStatus
    && org.billingMethod !== "manual_boleto"
    && !org.manualAccessUntil
    && !org.stripeCustomerId
    && !org.stripeSubscriptionId
  );
}

export function isChurning(org: {
  stripeCancelAtPeriodEnd?: boolean | null;
  stripeSubscriptionStatus?: string | null;
  lifecycleStage?: string | null;
}) {
  return (
    Boolean(org.stripeCancelAtPeriodEnd)
    || org.stripeSubscriptionStatus === "canceled"
    || org.lifecycleStage === "churning"
    || org.lifecycleStage === "churned"
  );
}

export function parseTags(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    }
  } catch {
    /* ignore */
  }
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function serializeTags(tags: string[]): string {
  return JSON.stringify(tags.map((t) => t.trim()).filter(Boolean));
}

export function formatCentsBRL(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return null;
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function estimateMrrCents(org: {
  customPlanEnabled?: boolean | null;
  customPlanAmountCents?: number | null;
  customPlanInterval?: string | null;
  customPlanIntervalCount?: number | null;
  stripeSubscriptionStatus?: string | null;
  billingMethod?: string | null;
}): number | null {
  if (org.customPlanEnabled && org.customPlanAmountCents && org.customPlanAmountCents > 0) {
    const interval = org.customPlanInterval === "year" ? "year" : "month";
    const count = Math.max(1, org.customPlanIntervalCount ?? 1);
    if (interval === "year") return Math.round(org.customPlanAmountCents / (12 * count));
    return Math.round(org.customPlanAmountCents / count);
  }
  if (org.stripeSubscriptionStatus === "active" || org.stripeSubscriptionStatus === "trialing") {
    return null; // filled by caller with known env price amounts when available
  }
  return null;
}

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  trial: "Trial",
  onboarding: "Implantação",
  active: "Ativa",
  at_risk: "Em risco",
  churning: "Cancelando",
  churned: "Churn",
  special: "Acordo especial",
};
