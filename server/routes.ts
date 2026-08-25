import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { createHash, randomBytes } from "crypto";
import { storage } from "./storage";
import { z } from "zod";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import Stripe from "stripe";
import type { InsertNotification, Medication, SessionUser } from "@shared/schema";
import { verifyPassword } from "./security";
import { pool } from "./db";
import { getWebPushPublicKey, isWebPushConfigured, sendWebPushNotifications } from "./web-push";
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  getShiftProfileRule,
  normalizeShiftProfileKey,
  normalizeEnvironmentSettings,
  routeActionIsAllowed,
  type EnvironmentSettings,
  type ModulePermissionAction,
  type ModuleRoute,
  type ShiftAssignmentType,
  type TimeClockSettings,
} from "@shared/environment";
import { NOTIFICATION_TYPES } from "@shared/notifications";

const SessionStore = connectPgSimple(session);

type FamilyPortalSession = {
  id: number;
  name: string;
  relationship: string;
  residentId: number;
  organizationId: number;
  organizationName?: string;
  organizationPhone?: string | null;
};

declare module "express-session" {
  interface SessionData {
    user: SessionUser;
    familyMember: FamilyPortalSession;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set.");
  }

  const isProduction = process.env.NODE_ENV === "production";
  app.use(session({
    name: "easycare.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new SessionStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
    }),
    cookie: {
      maxAge: 86400000,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  }));

  const createLoginRateLimiter = () =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: { message: "Muitas tentativas de login. Tente novamente em alguns minutos." },
    });

  const authLoginRateLimiter = createLoginRateLimiter();
  const familyLoginRateLimiter = createLoginRateLimiter();
  const publicSignupRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Muitas tentativas de cadastro. Tente novamente em alguns minutos." },
  });

  const sanitizeUser = <T extends { password?: unknown }>(user: T) => {
    const { password: _password, ...safe } = user;
    return safe;
  };

  const sanitizeFamilyMember = <T extends { portalPassword?: unknown; portalInviteTokenHash?: unknown }>(member: T) => {
    const { portalPassword: _portalPassword, portalInviteTokenHash: _portalInviteTokenHash, ...safe } = member;
    return safe;
  };
  const normalizePortalUsername = (username: string) => username.trim().toLowerCase();

  const logAudit = async (
    req: Request,
    input: {
      action: string;
      entityType: string;
      entityId?: number | null;
      message: string;
      organizationId?: number | null;
      metadata?: Record<string, unknown>;
    },
  ) => {
    const sessionUser = req.session.user;
    const familySession = req.session.familyMember;
    await storage.createAuditLog({
      organizationId: input.organizationId ?? sessionUser?.organizationId ?? familySession?.organizationId ?? null,
      userId: sessionUser?.id ?? null,
      actorName: sessionUser?.name ?? sessionUser?.username ?? familySession?.name ?? null,
      actorRole: sessionUser?.role ?? (familySession ? "family" : null),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      message: input.message,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    } as any).catch((error) => {
      console.error("[audit] falha ao registrar evento", error);
    });
  };

  const regenerateSession = (req: Request) =>
    new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

  const assertPortalUsernameAvailable = async (
    orgId: number,
    username: unknown,
    currentMemberId?: number,
  ) => {
    if (typeof username !== "string") return;
    const normalized = normalizePortalUsername(username);
    if (!normalized) return;

    const existing = await storage.getFamilyMembersByPortalUsername(normalized);
    const conflict = existing.find(
      (member) => member.organizationId === orgId && member.id !== currentMemberId,
    );
    if (conflict) {
      throw new Error("Usuário do portal já está em uso. Escolha outro.");
    }
  };

  const ORG_STATUS_VALUES = ["active", "inactive", "restricted"] as const;
  type OrgStatus = typeof ORG_STATUS_VALUES[number];
  const DEFAULT_PAYMENT_GRACE_DAYS = 10;
  const STRIPE_ACCESS_STATUSES = new Set(["active", "trialing"]);
  const STRIPE_GRACE_STATUSES = new Set(["past_due", "unpaid", "incomplete"]);
  const getPaymentGraceDays = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_PAYMENT_GRACE_DAYS;
    return Math.min(parsed, 60);
  };
  const withinPaymentGracePeriod = (since: unknown, graceDays: number, now = new Date()) => {
    if (!since) return false;
    const date = since instanceof Date ? new Date(since) : new Date(String(since));
    if (Number.isNaN(date.getTime())) return false;
    return now.getTime() <= date.getTime() + graceDays * 24 * 60 * 60 * 1000;
  };
  const getPaymentGraceEndsAt = (since: unknown, graceDays: number) => {
    if (!since) return null;
    const date = since instanceof Date ? new Date(since) : new Date(String(since));
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getTime() + graceDays * 24 * 60 * 60 * 1000);
  };
  const daysUntilDate = (date: Date | null, now = new Date()) => {
    if (!date) return null;
    return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  };
  const stripeSubscriptionAllowsAccess = (org?: {
    stripeSubscriptionStatus?: string | null;
    subscriptionUpdatedAt?: unknown;
    paymentGraceDays?: unknown;
  } | string | null) => {
    const status = typeof org === "string" ? org : org?.stripeSubscriptionStatus;
    if (status && STRIPE_ACCESS_STATUSES.has(status)) return true;
    if (status && STRIPE_GRACE_STATUSES.has(status) && typeof org !== "string") {
      return withinPaymentGracePeriod(org?.subscriptionUpdatedAt, getPaymentGraceDays(org?.paymentGraceDays));
    }
    return false;
  };
  const parseManualAccessUntil = (value: unknown): Date | null => {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const manualAccessExpired = (value: unknown, now = new Date()) => {
    const accessUntil = parseManualAccessUntil(value);
    return Boolean(accessUntil && accessUntil.getTime() < now.getTime());
  };
  const manualAccessIsCurrent = (value: unknown, now = new Date()) => {
    const accessUntil = parseManualAccessUntil(value);
    return Boolean(accessUntil && accessUntil.getTime() >= now.getTime());
  };

  const normalizeOrgStatus = (org?: {
    status?: unknown;
    active?: unknown;
    stripeSubscriptionStatus?: string | null;
    subscriptionUpdatedAt?: unknown;
    paymentGraceDays?: unknown;
    manualAccessUntil?: unknown;
  }): OrgStatus => {
    const raw = typeof org?.status === "string" ? org.status.trim().toLowerCase() : "";
    const normalized = raw === "active" || raw === "inactive" || raw === "restricted"
      ? raw
      : org?.active === false ? "inactive" : "active";
    if (normalized === "restricted" && (stripeSubscriptionAllowsAccess(org) || manualAccessIsCurrent(org?.manualAccessUntil))) {
      return "active";
    }
    const hasStripeStatus = typeof org?.stripeSubscriptionStatus === "string" && org.stripeSubscriptionStatus.trim().length > 0;
    if (
      normalized === "active"
      && !stripeSubscriptionAllowsAccess(org)
      && (manualAccessExpired(org?.manualAccessUntil) || hasStripeStatus)
    ) {
      return "restricted";
    }
    return normalized;
  };
  const parseOrgStatusInput = (value: unknown): OrgStatus | null => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return ORG_STATUS_VALUES.includes(normalized as OrgStatus)
      ? normalized as OrgStatus
      : null;
  };
  const BILLING_API_PATH_PREFIX = "/api/billing";
  const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";
  const isBillingApiPath = (path: string) => path.startsWith(BILLING_API_PATH_PREFIX);
  const BILLING_PLAN_VALUES = ["monthly", "semiannual", "annual"] as const;
  type BillingPlan = typeof BILLING_PLAN_VALUES[number];
  const BILLING_PLAN_PATIENT_LIMITS: Record<BillingPlan, number> = {
    monthly: 30,
    semiannual: 40,
    annual: 60,
  };
  const parseBillingPlanInput = (value: unknown): BillingPlan =>
    typeof value === "string" && BILLING_PLAN_VALUES.includes(value as BillingPlan)
      ? value as BillingPlan
      : "monthly";
  const getBillingPlanLabel = (plan: BillingPlan) =>
    plan === "annual" ? "anual" : plan === "semiannual" ? "semestral" : "mensal";
  const getBillingPlanPatientLimit = (plan: BillingPlan) => BILLING_PLAN_PATIENT_LIMITS[plan];
  const getBillingPlanForStripePriceId = (priceId?: string | null): BillingPlan | null => {
    const normalized = priceId?.trim();
    if (!normalized) return null;

    const configuredPriceIds: Array<[BillingPlan, string]> = [
      ["monthly", process.env.STRIPE_MONTHLY_PRICE_ID?.trim() || process.env.STRIPE_PRICE_ID?.trim() || ""],
      ["semiannual", process.env.STRIPE_SEMIANNUAL_PRICE_ID?.trim() || ""],
      ["annual", process.env.STRIPE_ANNUAL_PRICE_ID?.trim() || ""],
    ];

    return configuredPriceIds.find(([, configuredPriceId]) => configuredPriceId === normalized)?.[0] ?? null;
  };
  let stripeClient: Stripe | null = null;
  const getStripeClient = () => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY não configurada.");
    }
    if (!stripeClient) {
      stripeClient = new Stripe(stripeSecretKey);
    }
    return stripeClient;
  };
  const getStripeMonthlyPriceId = () => {
    const priceId = process.env.STRIPE_MONTHLY_PRICE_ID?.trim() || process.env.STRIPE_PRICE_ID?.trim();
    if (!priceId) {
      throw new Error("STRIPE_PRICE_ID não configurado.");
    }
    return priceId;
  };
  const getStripeSemiannualPriceId = () => process.env.STRIPE_SEMIANNUAL_PRICE_ID?.trim() || "";
  const getStripeAnnualPriceId = () => process.env.STRIPE_ANNUAL_PRICE_ID?.trim() || "";
  const getStripePortalConfigurationIdFromEnv = () => process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || "";
  const getStripePriceIdForPlan = (plan: BillingPlan) => {
    if (plan === "annual") {
      const priceId = getStripeAnnualPriceId();
      if (!priceId) {
        throw new Error("STRIPE_ANNUAL_PRICE_ID não configurado.");
      }
      return priceId;
    }
    if (plan === "semiannual") {
      const priceId = getStripeSemiannualPriceId();
      if (!priceId) {
        throw new Error("STRIPE_SEMIANNUAL_PRICE_ID não configurado.");
      }
      return priceId;
    }
    return getStripeMonthlyPriceId();
  };
  const getConfiguredStripePlanPriceIds = () => {
    const priceIds = [
      getStripeMonthlyPriceId(),
      getStripeSemiannualPriceId(),
      getStripeAnnualPriceId(),
    ].filter((priceId): priceId is string => Boolean(priceId));
    return Array.from(new Set(priceIds));
  };
  const formatStripeAmount = (amount: number | null | undefined, currency: string | null | undefined) => {
    if (typeof amount !== "number" || !currency) return null;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };
  const buildBillingPlanOption = async (plan: BillingPlan) => {
    const stripe = getStripeClient();
    const fallbackName =
      plan === "annual" ? "Plano anual" : plan === "semiannual" ? "Plano semestral" : "Plano mensal";
    const fallbackInterval = plan === "annual" ? "year" : "month";
    const fallbackIntervalCount = plan === "semiannual" ? 6 : 1;
    const priceId =
      plan === "annual"
        ? getStripeAnnualPriceId()
        : plan === "semiannual"
          ? getStripeSemiannualPriceId()
          : getStripeMonthlyPriceId();
    if (!priceId) {
      return {
        id: plan,
        name: fallbackName,
        configured: false,
        patientLimit: getBillingPlanPatientLimit(plan),
        amount: null,
        currency: "brl",
        interval: fallbackInterval,
        intervalCount: fallbackIntervalCount,
        formattedAmount: null,
      };
    }

    const price = await stripe.prices.retrieve(priceId);
    const currency = price.currency || "brl";
    return {
      id: plan,
      name: price.nickname || fallbackName,
      configured: true,
      patientLimit: getBillingPlanPatientLimit(plan),
      amount: price.unit_amount ?? null,
      currency,
      interval: price.recurring?.interval ?? fallbackInterval,
      intervalCount: price.recurring?.interval_count ?? fallbackIntervalCount,
      formattedAmount: formatStripeAmount(price.unit_amount, currency),
    };
  };
  const getAppBaseUrl = (req: Request) => {
    const configuredUrl = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
    if (configuredUrl) return configuredUrl;
    return `${req.protocol}://${req.get("host")}`;
  };
  let stripePortalConfigurationId: string | null = null;
  const buildStripePortalFeatures = (
    productId: string,
    priceIds: string[],
  ): Stripe.BillingPortal.ConfigurationCreateParams.Features => ({
    customer_update: {
      enabled: true,
      allowed_updates: ["name", "email", "phone", "address", "tax_id"],
    },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      proration_behavior: "none",
      cancellation_reason: {
        enabled: true,
        options: ["too_expensive", "missing_features", "unused", "customer_service", "other"],
      },
    },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      products: [{
        product: productId,
        prices: priceIds,
      }],
      proration_behavior: "always_invoice",
      billing_cycle_anchor: "now",
      trial_update_behavior: "continue_trial",
      schedule_at_period_end: {
        conditions: [
          { type: "decreasing_item_amount" },
          { type: "shortening_interval" },
        ],
      },
    },
  });
  const getEasyCareStripePortalConfigurationId = async (req: Request) => {
    const configuredPortalId = getStripePortalConfigurationIdFromEnv();
    if (configuredPortalId) return configuredPortalId;
    if (stripePortalConfigurationId) return stripePortalConfigurationId;

    const stripe = getStripeClient();
    const priceIds = getConfiguredStripePlanPriceIds();
    const prices = await Promise.all(priceIds.map((priceId) => stripe.prices.retrieve(priceId)));
    const productIds = new Set(
      prices.map((price) => typeof price.product === "string" ? price.product : price.product.id),
    );
    if (productIds.size !== 1) {
      throw new Error("Os preços mensal, semestral e anual precisam estar no mesmo produto Stripe para permitir troca de plano.");
    }

    const productId = Array.from(productIds)[0];
    const configurationName = "EasyCare - Portal de assinaturas";
    const portalPayload: Stripe.BillingPortal.ConfigurationCreateParams = {
      name: configurationName,
      default_return_url: `${getAppBaseUrl(req)}/billing`,
      metadata: {
        easycare: "subscription_portal",
        policy: "upgrade_now_downgrade_period_end",
      },
      business_profile: {
        headline: "Gerencie sua assinatura EasyCare",
      },
      features: buildStripePortalFeatures(productId, priceIds),
    };

    const existingConfigurations = await stripe.billingPortal.configurations.list({
      active: true,
      limit: 100,
    });
    const existing = existingConfigurations.data.find((configuration) =>
      configuration.metadata?.easycare === "subscription_portal"
      || configuration.name === configurationName
    );

    if (existing) {
      const updated = await stripe.billingPortal.configurations.update(existing.id, portalPayload);
      stripePortalConfigurationId = updated.id;
      return updated.id;
    }

    const created = await stripe.billingPortal.configurations.create(portalPayload);
    stripePortalConfigurationId = created.id;
    return created.id;
  };
  const orgStatusForStripeSubscription = (status: string | null | undefined): OrgStatus =>
    status && (STRIPE_ACCESS_STATUSES.has(status) || STRIPE_GRACE_STATUSES.has(status))
      ? "active"
      : "restricted";
  const resolveBillingAccessState = (org: {
    status?: unknown;
    stripeSubscriptionStatus?: string | null;
    stripeCancelAtPeriodEnd?: boolean | null;
    manualAccessUntil?: unknown;
    billingMethod?: string | null;
  }, normalizedStatus: OrgStatus) => {
    if (normalizedStatus === "inactive") return "inactive";
    if (normalizedStatus === "restricted") return "restricted";
    if (org.stripeCancelAtPeriodEnd) return "cancel_scheduled";
    if (org.stripeSubscriptionStatus === "trialing") return "trialing";
    if (isStripePaymentIssueStatus(org.stripeSubscriptionStatus)) return "grace_period";
    if (!org.stripeSubscriptionStatus && org.manualAccessUntil) return org.billingMethod === "manual_boleto" ? "manual_boleto" : "manual_access";
    return "active";
  };
  const isStripePaymentIssueStatus = (status?: string | null) =>
    Boolean(status && STRIPE_GRACE_STATUSES.has(status));
  const getOrganizationOnboardingSummary = async (organizationId: number) => {
    const organization = await storage.getOrganization(organizationId);
    if (!organization) return null;

    const [staffMembers, residents, shifts, locations, contracts, medications] = await Promise.all([
      storage.getStaff(organizationId),
      storage.getResidents(organizationId, { search: "", status: "active" }),
      storage.getShiftAssignments(organizationId),
      storage.getTimeClockLocations(organizationId),
      storage.getContracts(organizationId),
      storage.getMedications(organizationId),
    ]);
    const familyGroups = await Promise.all(
      residents.map((resident) => storage.getFamilyMembers(organizationId, resident.id)),
    );
    const family = familyGroups.flat();
    const checks = {
      billing: normalizeOrgStatus(organization) === "active",
      staff: staffMembers.some((member) => member.active !== false),
      residents: residents.length > 0,
      shifts: shifts.length > 0,
      timeClock: locations.length > 0,
      clinical: medications.some((medication) => medication.status === "active"),
      finance: contracts.some((contract) => contract.status === "active"),
      familyPortal: family.some((member) => member.portalAccess || member.portalInvitedAt),
    };
    const total = Object.keys(checks).length;
    const completed = Object.values(checks).filter(Boolean).length;

    return {
      organizationId,
      completed,
      total,
      percent: Math.round((completed / total) * 100),
      checks,
    };
  };
  const getStripeCustomerId = (customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) => {
    if (typeof customer === "string") return customer;
    return customer?.id ?? null;
  };
  const getStripeSubscriptionPriceId = (subscription: Stripe.Subscription) =>
    subscription.items.data[0]?.price?.id ?? null;
  const stripeTimestampToDate = (timestamp?: number | null) =>
    typeof timestamp === "number" ? new Date(timestamp * 1000) : null;
  const getStripeSubscriptionPeriodEnd = (subscription: Stripe.Subscription) => {
    const rawSubscription = subscription as Stripe.Subscription & { current_period_end?: number | null };
    return stripeTimestampToDate(rawSubscription.current_period_end);
  };
  const getStripeSubscriptionCancelAt = (subscription: Stripe.Subscription) => {
    const rawSubscription = subscription as Stripe.Subscription & {
      cancel_at?: number | null;
      cancel_at_period_end?: boolean | null;
      current_period_end?: number | null;
    };
    const timestamp = rawSubscription.cancel_at ?? (rawSubscription.cancel_at_period_end ? rawSubscription.current_period_end : null);
    return typeof timestamp === "number" ? new Date(timestamp * 1000) : null;
  };
  const envIsConfigured = (key: string) => Boolean(process.env[key]?.trim());
  const checkoutConfigured = () => envIsConfigured("STRIPE_SECRET_KEY") && (envIsConfigured("STRIPE_MONTHLY_PRICE_ID") || envIsConfigured("STRIPE_PRICE_ID"));
  const portalConfigured = () => envIsConfigured("STRIPE_SECRET_KEY");
  const toBillingClientErrorMessage = (error: unknown, fallback: string) => {
    const raw = error instanceof Error ? error.message : "";
    const normalized = raw.toLowerCase();
    if (normalized.includes("stripe_secret_key") || normalized.includes("price_id") || normalized.includes("não configurad")) {
      return "O checkout ainda não está pronto para uso. Fale com o suporte EasyCare para concluir a ativação.";
    }
    if (normalized.includes("mesmo produto stripe")) {
      return "A troca de plano ainda precisa de um ajuste na Stripe. Fale com o suporte EasyCare para continuar.";
    }
    if (normalized.includes("não retornou")) {
      return "Não conseguimos abrir o checkout agora. Tente novamente em instantes ou fale com o suporte.";
    }
    if (normalized.includes("cliente stripe ainda não vinculado")) {
      return "A assinatura ainda não foi criada. Ative um plano antes de abrir o portal da Stripe.";
    }
    return raw || fallback;
  };
  const getStripeTrialDays = () => {
    const rawTrialDays = process.env.STRIPE_TRIAL_DAYS?.trim();
    const parsedTrialDays = rawTrialDays ? Number(rawTrialDays) : 7;
    if (!Number.isInteger(parsedTrialDays) || parsedTrialDays < 0) return 7;
    return Math.min(parsedTrialDays, 365);
  };
  const FAMILY_PORTAL_INVITE_DAYS = 14;
  const hashFamilyPortalInviteToken = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  const buildFamilyPortalInviteUrl = (req: Request, token: string) =>
    `${getAppBaseUrl(req)}/portal/convite/${token}`;
  const buildFamilyPortalSession = (
    member: { id: number; name: string; relationship: string; residentId: number; organizationId: number },
    organization: { name: string; phone?: string | null },
  ): FamilyPortalSession => ({
    id: member.id,
    name: member.name,
    relationship: member.relationship,
    residentId: member.residentId,
    organizationId: member.organizationId,
    organizationName: organization.name,
    organizationPhone: organization.phone ?? null,
  });
  const createCheckoutSessionForOrganization = async (
    req: Request,
    organization: {
      id: number;
      name: string;
      email?: string | null;
      stripeCustomerId?: string | null;
    },
    options?: { includeTrial?: boolean; embedded?: boolean; plan?: BillingPlan },
  ) => {
    const stripe = getStripeClient();
    const baseUrl = getAppBaseUrl(req);
    const plan = options?.plan ?? "monthly";
    const priceId = getStripePriceIdForPlan(plan);
    const patientLimit = getBillingPlanPatientLimit(plan);
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        organizationId: String(organization.id),
        billingPlan: plan,
        patientLimit: String(patientLimit),
      },
    };
    const trialDays = options?.includeTrial ? getStripeTrialDays() : 0;
    if (trialDays > 0) {
      subscriptionData.trial_period_days = trialDays;
    }

    const baseSessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer: organization.stripeCustomerId ?? undefined,
      customer_email: organization.stripeCustomerId ? undefined : organization.email ?? undefined,
      client_reference_id: String(organization.id),
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        organizationId: String(organization.id),
        billingPlan: plan,
        stripePriceId: priceId,
        patientLimit: String(patientLimit),
      },
      subscription_data: subscriptionData,
      allow_promotion_codes: process.env.STRIPE_ALLOW_PROMOTION_CODES === "true",
      locale: "pt-BR",
    };

    if (options?.embedded) {
      return await stripe.checkout.sessions.create({
        ...baseSessionParams,
        ui_mode: "embedded_page",
        return_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        redirect_on_completion: "if_required",
      });
    }

    return await stripe.checkout.sessions.create({
      ...baseSessionParams,
      success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing?checkout=cancelled`,
    });
  };
  const parseManualAccessUntilInput = (value: unknown): Date | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value !== "string" && !(value instanceof Date)) {
      throw new Error("Data de acesso manual inválida.");
    }

    const raw = value instanceof Date ? value.toISOString() : value.trim();
    const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = dateOnlyMatch
      ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]), 23, 59, 59, 999)
      : new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Data de acesso manual inválida.");
    }
    return parsed;
  };
  const BILLING_METHOD_VALUES = ["stripe", "manual_boleto"] as const;
  type BillingMethod = typeof BILLING_METHOD_VALUES[number];
  const parseBillingMethodInput = (value: unknown): BillingMethod | undefined => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return "stripe";
    if (typeof value !== "string") throw new Error("Forma de cobrança inválida.");
    const normalized = value.trim().toLowerCase();
    if (!BILLING_METHOD_VALUES.includes(normalized as BillingMethod)) {
      throw new Error("Forma de cobrança inválida.");
    }
    return normalized as BillingMethod;
  };
  const parseNullableBoundedInteger = (
    value: unknown,
    fieldLabel: string,
    min: number,
    max: number,
  ): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new Error(`${fieldLabel} deve ser um número entre ${min} e ${max}.`);
    }
    return parsed;
  };
  const ENV_SETTINGS_API_PATH = "/api/environment-settings";
  const API_MODULE_ROUTE_RULES: Array<{ pattern: RegExp; route: ModuleRoute }> = [
    { pattern: /^\/api\/environment-settings(?:\/|$)/, route: "/environment" },
    { pattern: /^\/api\/stats(?:\/|$)/, route: "/" },
    { pattern: /^\/api\/residents\/[^/]+\/family(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/documents(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/patient-documents(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/medical-records(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/comorbidities(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/medical-records(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/comorbidities(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/medication-dose-schedule(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/medication-dose-records(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/medication-administrations(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/medications(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/staff(?:\/|$)/, route: "/staff" },
    { pattern: /^\/api\/shift-assignments(?:\/|$)/, route: "/escalas" },
    { pattern: /^\/api\/time-clock(?:\/|$)/, route: "/ponto-eletronico" },
    { pattern: /^\/api\/contracts(?:\/|$)/, route: "/financeiro" },
    { pattern: /^\/api\/monthly-fees(?:\/|$)/, route: "/financeiro" },
    { pattern: /^\/api\/accounts-payable(?:\/|$)/, route: "/financeiro" },
    { pattern: /^\/api\/crm(?:\/|$)/, route: "/crm" },
    { pattern: /^\/api\/occurrences(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/family(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents(?:\/|$)/, route: "/residents" },
  ];
  const resolveModuleRouteFromApiPath = (path: string): ModuleRoute | null => {
    const match = API_MODULE_ROUTE_RULES.find((rule) => rule.pattern.test(path));
    return match?.route ?? null;
  };
  const resolveModulePermissionActionFromMethod = (method: string): ModulePermissionAction => {
    const normalizedMethod = method.trim().toUpperCase();
    if (normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS") {
      return "view";
    }
    return "edit";
  };
  const parseEnvironmentSettingsFromOrganization = (
    organization?: { environmentSettings?: unknown } | null,
  ): EnvironmentSettings => {
    if (!organization || typeof organization.environmentSettings !== "string") {
      return DEFAULT_ENVIRONMENT_SETTINGS;
    }
    const rawSettings = organization.environmentSettings.trim();
    if (!rawSettings) return DEFAULT_ENVIRONMENT_SETTINGS;
    try {
      return normalizeEnvironmentSettings(JSON.parse(rawSettings));
    } catch {
      return DEFAULT_ENVIRONMENT_SETTINGS;
    }
  };
  const getOrganizationEnvironmentSettings = async (orgId: number) => {
    const organization = await storage.getOrganization(orgId);
    if (!organization) return null;
    return {
      organization,
      settings: parseEnvironmentSettingsFromOrganization(organization),
    };
  };
  const getAllowedRolesForSettings = (settings: EnvironmentSettings): string[] =>
    Object.keys(settings.roleRoutes);
  const getDefaultRoleForSettings = (settings: EnvironmentSettings): string => {
    const allowedRoles = getAllowedRolesForSettings(settings);
    if (allowedRoles.includes("staff")) return "staff";
    return allowedRoles[0] ?? "staff";
  };
  const getDefaultStaffShiftForSettings = (settings: EnvironmentSettings): string => {
    const availableProfiles = settings.shiftProfiles.available;
    if (availableProfiles.includes("flexivel")) return "flexivel";
    if (availableProfiles.includes("comercial")) return "comercial";
    return availableProfiles[0] ?? "flexivel";
  };
  const normalizeStaffShiftProfile = (value: unknown): string => {
    if (typeof value !== "string") return "";
    return normalizeShiftProfileKey(value);
  };
  const normalizeStaffRoleValue = (value: unknown): string => {
    if (typeof value !== "string") return "";
    return value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  };
  const normalizeLinkableText = (value: unknown): string =>
    String(value ?? "")
      .trim()
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const assertShiftProfileAllowedForSettings = (
    settings: EnvironmentSettings,
    shiftProfile: string,
  ) => {
    if (!shiftProfile || !settings.shiftProfiles.available.includes(shiftProfile)) {
      throw new Error("Perfil de jornada inválido para esta organização.");
    }
  };
  const getBlockedOrganizationMessage = (status: OrgStatus): string =>
    status === "restricted"
      ? "Pagamento pendente. Acesse a cobrança para liberar o sistema."
      : "Organização inativa. Acesso bloqueado.";
  const destroySession = (req: Request) =>
    new Promise<void>((resolve) => {
      req.session.destroy(() => resolve());
    });

  const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: "Não autorizado" });
    if (user.isSuperAdmin || !user.organizationId) return next();

    try {
      const organization = await storage.getOrganization(user.organizationId);
      if (!organization) {
        await destroySession(req);
        res.clearCookie("easycare.sid");
        return res.status(403).json({ message: "Organização não encontrada. Acesso bloqueado." });
      }

      const organizationStatus = normalizeOrgStatus(organization);
      if (organizationStatus === "inactive") {
        await destroySession(req);
        res.clearCookie("easycare.sid");
        return res.status(403).json({ message: getBlockedOrganizationMessage(organizationStatus) });
      }

      const environmentSettings = parseEnvironmentSettingsFromOrganization(organization);
      res.locals.environmentSettings = environmentSettings;
      if (organizationStatus === "restricted") {
        req.session.user = {
          ...user,
          organizationName: organization.name,
          organizationStatus,
          stripeSubscriptionStatus: organization.stripeSubscriptionStatus ?? null,
        };

        if (isBillingApiPath(req.path)) return next();
        return res.status(402).json({ message: getBlockedOrganizationMessage(organizationStatus) });
      }

      req.session.user = {
        ...user,
        organizationName: organization.name,
        organizationStatus,
        stripeSubscriptionStatus: organization.stripeSubscriptionStatus ?? null,
      };
      const moduleRoute = resolveModuleRouteFromApiPath(req.path);
      const permissionAction = resolveModulePermissionActionFromMethod(req.method);
      const allowEnvironmentSettingsRead =
        req.path.startsWith(ENV_SETTINGS_API_PATH) && permissionAction === "view";
      if (
        !allowEnvironmentSettingsRead
        && moduleRoute
        && !routeActionIsAllowed(
          user.role,
          moduleRoute,
          permissionAction,
          environmentSettings.roleRoutes,
          environmentSettings.roleEditRoutes,
        )
      ) {
        const deniedMessage = permissionAction === "edit"
          ? "Acesso negado para edição neste modulo."
          : "Acesso negado para visualizacao neste modulo.";
        return res.status(403).json({ message: deniedMessage });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
  const requireSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.user?.isSuperAdmin) return res.status(403).json({ message: "Acesso restrito ao super-admin" });
    next();
  };

  // Middleware de controle de acesso por papel (RBAC)
  const requireRole = (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: "Não autorizado" });
    if (user.isSuperAdmin) return next(); // super-admin sempre passa

    const moduleRoute = resolveModuleRouteFromApiPath(req.path);
    const environmentSettings = res.locals.environmentSettings as EnvironmentSettings | undefined;
    const permissionAction = resolveModulePermissionActionFromMethod(req.method);
    if (moduleRoute && environmentSettings) {
      const allowedByModulePermission = routeActionIsAllowed(
        user.role,
        moduleRoute,
        permissionAction,
        environmentSettings.roleRoutes,
        environmentSettings.roleEditRoutes,
      );
      if (!allowedByModulePermission) {
        const actionLabel = permissionAction === "edit" ? "edição" : "visualizacao";
        return res.status(403).json({
          message: `Acesso negado. Papel '${user.role}' não tem permissão de ${actionLabel} para esta ação.`,
        });
      }
    }

    if (roles.includes(user.role)) return next();

    if (moduleRoute && environmentSettings) {
      return next();
    }

    const actionLabel = permissionAction === "edit" ? "edição" : "visualizacao";
    return res.status(403).json({ message: `Acesso negado. Papel '${user.role}' não tem permissão de ${actionLabel} para esta ação.` });
  };

  // Papéis com acesso clínico
  const CLINICAL_ROLES = ["admin", "enfermeiro", "medico", "tecnico_enfermagem", "fisioterapeuta", "nutricionista"];
  // Papéis com acesso financeiro
  const FINANCIAL_ROLES = ["admin", "recepcionista", "administrativo"];
  // Papéis com acesso ao módulo de equipe
  const STAFF_MGMT_ROLES = ["admin"];
  // Papéis com acesso a medicações
  const MEDICATION_ROLES = ["admin", "enfermeiro", "medico", "tecnico_enfermagem"];
  // Papéis com acesso ao CRM
  const CRM_ROLES = ["admin"];
  // Papéis com acesso ao ponto eletrônico
  const TIME_CLOCK_ROLES = [
    "admin",
    "enfermeiro",
    "medico",
    "tecnico_enfermagem",
    "cuidador",
    "fisioterapeuta",
    "nutricionista",
    "recepcionista",
    "administrativo",
    "staff",
  ];

  const getOrgId = (req: Request): number => {
    const orgId = req.session.user?.organizationId;
    if (!orgId) throw new Error("Organization não encontrada na sessão");
    return orgId;
  };

  const resolveOrgIdForCrm = async (
    req: Request,
    organizationIdCandidate?: unknown,
  ): Promise<number> => {
    const sessionUser = req.session.user;
    if (!sessionUser) throw new Error("Não autorizado.");

    if (!sessionUser.isSuperAdmin) {
      return getOrgId(req);
    }

    const parsedOrgId = Number(organizationIdCandidate);
    if (!Number.isInteger(parsedOrgId) || parsedOrgId <= 0) {
      const error = new Error("Superadmin deve informar organizationId válido.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }

    const organization = await storage.getOrganization(parsedOrgId);
    if (!organization) {
      const error = new Error("Organização não encontrada.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }
    return parsedOrgId;
  };

  const normalizeComparableText = (value: string | null | undefined) =>
    (value ?? "")
      .trim()
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const booleanQuerySchema = z.preprocess((value) => {
    if (value === undefined) return undefined;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return value;
  }, z.boolean().optional());
  const notificationQuerySchema = z.object({
    unreadOnly: booleanQuerySchema.default(false),
    limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  });
  const browserPushSubscriptionSchema = z.object({
    endpoint: z.string().trim().url().max(2048),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().trim().min(20).max(500),
      auth: z.string().trim().min(10).max(500),
    }),
  });
  const browserPushUnsubscribeSchema = z.object({
    endpoint: z.string().trim().url().max(2048),
  });
  type InternalNotificationPayload = {
    userId?: number | null;
    staffId?: number | null;
    type: string;
    severity?: string;
    sourceModule?: string;
    title: string;
    message: string;
    actionUrl?: string | null;
    entityType?: string | null;
    entityId?: number | null;
    dedupeKey?: string | null;
    metadata?: unknown;
    scheduledFor?: Date | null;
  };
  const buildInternalNotification = (
    orgId: number,
    payload: InternalNotificationPayload,
  ): InsertNotification => ({
    organizationId: orgId,
    userId: payload.userId ?? null,
    staffId: payload.staffId ?? null,
    type: payload.type,
    severity: payload.severity ?? "info",
    sourceModule: payload.sourceModule ?? "system",
    title: payload.title,
    message: payload.message,
    actionUrl: payload.actionUrl ?? null,
    entityType: payload.entityType ?? null,
    entityId: payload.entityId ?? null,
    dedupeKey: payload.dedupeKey ?? null,
    metadata: payload.metadata === undefined ? null : JSON.stringify(payload.metadata),
    scheduledFor: payload.scheduledFor ?? new Date(),
    deliveredAt: new Date(),
    readAt: null,
    cancelledAt: null,
  });
  const safeCreateInternalNotifications = async (
    orgId: number,
    payloads: InternalNotificationPayload[],
  ) => {
    const items = payloads
      .filter((payload) => Number.isInteger(payload.userId) && Number(payload.userId) > 0)
      .map((payload) => buildInternalNotification(orgId, payload));
    if (items.length === 0) return;
    try {
      const created = await storage.createNotifications(items);
      void sendWebPushNotifications(created).catch((error) => {
        console.error("[web-push] erro ao enviar notificações recem-criadas", error);
      });
    } catch (error) {
      console.error("[notifications] erro ao criar notificações internas", error);
    }
  };
  const ensureBillingStatusNotification = async (
    orgId: number,
    userId: number,
    organization: {
      id: number;
      status?: unknown;
      active?: unknown;
      stripeSubscriptionStatus?: string | null;
      stripeCancelAtPeriodEnd?: boolean | null;
      subscriptionUpdatedAt?: unknown;
      paymentGraceDays?: unknown;
      manualAccessUntil?: unknown;
      billingMethod?: string | null;
    },
  ) => {
    const normalizedStatus = normalizeOrgStatus(organization);
    const billingAccessState = resolveBillingAccessState(organization, normalizedStatus);
    const graceDays = getPaymentGraceDays(organization.paymentGraceDays);
    const graceEndsAt = isStripePaymentIssueStatus(organization.stripeSubscriptionStatus)
      ? getPaymentGraceEndsAt(organization.subscriptionUpdatedAt, graceDays)
      : null;
    const daysLeft = daysUntilDate(graceEndsAt);

    let payload: Omit<InternalNotificationPayload, "userId"> | null = null;
    if (billingAccessState === "restricted") {
      payload = {
        type: NOTIFICATION_TYPES.billingAccessRestricted,
        severity: "error",
        sourceModule: "billing",
        title: "Acesso restrito",
        message: "O acesso da organização está restrito por pagamento pendente. Regularize a assinatura para liberar os módulos.",
        actionUrl: "/billing",
        entityType: "organization",
        entityId: orgId,
        dedupeKey: `billing:restricted:${new Date().toISOString().slice(0, 10)}`,
      };
    } else if (billingAccessState === "grace_period") {
      const daysText = typeof daysLeft === "number" && daysLeft > 0
        ? `Faltam ${daysLeft} dia${daysLeft === 1 ? "" : "s"} para o bloqueio.`
        : "O prazo de regularização está no limite.";
      payload = {
        type: NOTIFICATION_TYPES.billingGracePeriod,
        severity: "warning",
        sourceModule: "billing",
        title: "Pagamento venceu",
        message: `${daysText} Atualize o pagamento para manter o acesso sem interrupção.`,
        actionUrl: "/billing",
        entityType: "organization",
        entityId: orgId,
        dedupeKey: `billing:grace:${daysLeft ?? "unknown"}`,
      };
    }

    if (!payload) return;
    await safeCreateInternalNotifications(orgId, [{ ...payload, userId }]);
  };
  const notifyUsers = async (
    orgId: number,
    userIds: Array<number | null | undefined>,
    payload: Omit<InternalNotificationPayload, "userId">,
  ) => {
    const uniqueUserIds = Array.from(new Set(
      userIds.filter((userId): userId is number => Number.isInteger(userId) && Number(userId) > 0),
    ));
    await safeCreateInternalNotifications(
      orgId,
      uniqueUserIds.map((userId) => ({ ...payload, userId })),
    );
  };
  const notifyOrganizationRoles = async (
    orgId: number,
    roles: string[],
    payload: Omit<InternalNotificationPayload, "userId">,
  ) => {
    const organizationUsers = await storage.getUsersByOrganization(orgId);
    const roleSet = new Set(roles);
    await notifyUsers(
      orgId,
      organizationUsers
        .filter((user) => user.active !== false && roleSet.has(user.role))
        .map((user) => user.id),
      payload,
    );
  };
  const resolveNotificationUserIdsForStaff = async (orgId: number, staffId: number) => {
    const staffMember = await storage.getStaffMember(orgId, staffId);
    if (!staffMember) return [];
    const organizationUsers = await storage.getUsersByOrganization(orgId);
    const normalizedStaffName = normalizeComparableText(staffMember.name);
    return Array.from(new Set(
      organizationUsers
        .filter((user) => user.active !== false)
        .filter((user) =>
          user.id === staffMember.portalUserId
          || normalizeComparableText(user.name) === normalizedStaffName,
        )
        .map((user) => user.id),
    ));
  };
  const notifyStaffUsers = async (
    orgId: number,
    staffId: number,
    payload: Omit<InternalNotificationPayload, "userId">,
  ) => {
    await notifyUsers(orgId, await resolveNotificationUserIdsForStaff(orgId, staffId), payload);
  };
  const formatAppNotificationDateTime = (date: Date) =>
    date.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const notifyMedicationRoles = async (
    orgId: number,
    payload: Omit<InternalNotificationPayload, "userId" | "sourceModule">,
  ) => {
    await notifyOrganizationRoles(orgId, MEDICATION_ROLES, {
      ...payload,
      sourceModule: "medications",
      actionUrl: payload.actionUrl ?? "/prontuario",
    });
  };
  const buildMedicationActionUrl = (input: {
    residentId?: number | null;
    medicationId?: number | null;
    scheduledFor?: Date | string | null;
    medicationTab?: "medicações" | "agenda" | "historico";
  }) => {
    const params = new URLSearchParams({ tab: "medications" });
    params.set("medicationTab", input.medicationTab ?? "agenda");
    if (input.residentId) params.set("residentId", String(input.residentId));
    if (input.medicationId) params.set("medicationId", String(input.medicationId));
    if (input.scheduledFor) {
      const scheduledFor = input.scheduledFor instanceof Date
        ? input.scheduledFor.toISOString()
        : input.scheduledFor;
      params.set("scheduledFor", scheduledFor);
    }
    return `/prontuario?${params.toString()}`;
  };

  const resolveLinkedStaffForSessionUser = async (
    orgId: number,
    user: SessionUser | undefined,
  ) => {
    if (!user) return null;
    if (user.id) {
      const staffMembers = await storage.getStaff(orgId);
      const linkedByPortalUserId = staffMembers.find((member) => member.portalUserId === user.id);
      if (linkedByPortalUserId) return linkedByPortalUserId;
    }

    const normalizedUserName = normalizeComparableText(user.name);
    if (!normalizedUserName) return null;

    const staffMembers = await storage.getStaff(orgId);
    const exactNameMatches = staffMembers.filter(
      (member) => normalizeComparableText(member.name) === normalizedUserName,
    );

    if (exactNameMatches.length === 1) return exactNameMatches[0];
    if (exactNameMatches.length > 1) {
      const normalizedUserRole = normalizeComparableText(user.role);
      const roleMatch = exactNameMatches.find(
        (member) => normalizeComparableText(member.role) === normalizedUserRole,
      );
      return roleMatch ?? exactNameMatches[0];
    }

    const looseMatch = staffMembers.find((member) => {
      const normalizedStaffName = normalizeComparableText(member.name);
      return (
        normalizedStaffName.includes(normalizedUserName)
        || normalizedUserName.includes(normalizedStaffName)
      );
    });

    return looseMatch ?? null;
  };

  const enforceCaregiverOwnStaffId = async (
    orgId: number,
    user: SessionUser | undefined,
    requestedStaffId?: number | null,
  ) => {
    if (!user || user.role !== "cuidador") {
      return requestedStaffId ?? null;
    }

    const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, user);
    if (!linkedStaff) {
      throw new Error("Seu usuário de cuidador não está vinculado a um colaborador da equipe.");
    }

    if (requestedStaffId && requestedStaffId !== linkedStaff.id) {
      throw new Error("Cuidador so pode selecionar a si mesmo.");
    }

    return linkedStaff.id;
  };

  const resolveOrganizationForStripeSubscription = async (subscription: Stripe.Subscription) => {
    const metadataOrgId = Number(subscription.metadata?.organizationId);
    if (Number.isInteger(metadataOrgId) && metadataOrgId > 0) {
      const organization = await storage.getOrganization(metadataOrgId);
      if (organization) return organization;
    }

    const bySubscription = await storage.getOrganizationByStripeSubscriptionId(subscription.id);
    if (bySubscription) return bySubscription;

    const customerId = getStripeCustomerId(subscription.customer);
    if (!customerId) return undefined;
    return await storage.getOrganizationByStripeCustomerId(customerId);
  };

  const syncStripeSubscriptionToOrganization = async (subscription: Stripe.Subscription) => {
    const organization = await resolveOrganizationForStripeSubscription(subscription);
    if (!organization) {
      console.warn(`[stripe] organização não encontrada para assinatura ${subscription.id}`);
      return;
    }

    const customerId = getStripeCustomerId(subscription.customer);
    const subscriptionStatus = subscription.status ?? "unknown";
    const stripePriceId = getStripeSubscriptionPriceId(subscription) ?? organization.stripePriceId ?? null;
    const billingPlan = getBillingPlanForStripePriceId(stripePriceId);
    const planPatientLimit = billingPlan ? getBillingPlanPatientLimit(billingPlan) : null;
    const subscriptionCancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
    const nextOrgStatus = orgStatusForStripeSubscription(subscriptionStatus);
    const previousStatusWasGrace = isStripePaymentIssueStatus(organization.stripeSubscriptionStatus);
    const nextStatusIsGrace = isStripePaymentIssueStatus(subscriptionStatus);
    const subscriptionUpdatedAt =
      nextStatusIsGrace && previousStatusWasGrace && organization.subscriptionUpdatedAt
        ? organization.subscriptionUpdatedAt
        : new Date();
    return await storage.updateOrganization(organization.id, {
      stripeCustomerId: customerId ?? organization.stripeCustomerId ?? null,
      stripeSubscriptionId: subscription.id,
      stripePriceId,
      stripeSubscriptionStatus: subscriptionStatus,
      stripeCancelAtPeriodEnd: subscriptionCancelAtPeriodEnd,
      stripeCancelAt: subscriptionCancelAtPeriodEnd ? getStripeSubscriptionCancelAt(subscription) : null,
      subscriptionCurrentPeriodEnd: getStripeSubscriptionPeriodEnd(subscription),
      subscriptionUpdatedAt,
      ...(planPatientLimit ? { capacity: planPatientLimit } : {}),
      status: nextOrgStatus,
      active: nextOrgStatus === "active",
    });
  };

  const resolveOrganizationForCheckoutSession = async (session: Stripe.Checkout.Session) => {
    const metadataOrgId = Number(session.metadata?.organizationId || session.client_reference_id);
    if (Number.isInteger(metadataOrgId) && metadataOrgId > 0) {
      const organization = await storage.getOrganization(metadataOrgId);
      if (organization) return organization;
    }

    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (subscriptionId) {
      const bySubscription = await storage.getOrganizationByStripeSubscriptionId(subscriptionId);
      if (bySubscription) return bySubscription;
    }

    const customerId = getStripeCustomerId(session.customer);
    if (!customerId) return undefined;
    return await storage.getOrganizationByStripeCustomerId(customerId);
  };

  const syncCheckoutSessionToOrganization = async (session: Stripe.Checkout.Session) => {
    const stripe = getStripeClient();
    const organization = await resolveOrganizationForCheckoutSession(session);
    if (!organization) {
      console.warn(`[stripe] organização não encontrada para checkout session ${session.id}`);
      return;
    }

    const customerId = getStripeCustomerId(session.customer);
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncStripeSubscriptionToOrganization(subscription);
      return;
    }

    await storage.updateOrganization(organization.id, {
      stripeCustomerId: customerId ?? organization.stripeCustomerId ?? null,
      stripeSubscriptionStatus: session.payment_status ?? "checkout_completed",
      subscriptionUpdatedAt: new Date(),
      status: session.payment_status === "paid" ? "active" : "restricted",
      active: session.payment_status === "paid",
    });
  };

  // ===== AUTH =====
  app.post("/api/auth/login", authLoginRateLimiter, async (req, res) => {
    const { username, password, organizationCnpj, organizationId } = req.body;
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ message: "Usuário e senha obrigatórios" });
    }

    const normalizedUsername = username.trim();
    const parsedOrganizationCnpj =
      typeof organizationCnpj === "string" ? organizationCnpj.trim() : "";
    const parsedOrganizationId =
      typeof organizationId === "number"
        ? organizationId
        : typeof organizationId === "string" && organizationId.trim()
          ? Number(organizationId)
          : NaN;

    let organization =
      parsedOrganizationCnpj
        ? await storage.getOrganizationByCnpj(parsedOrganizationCnpj)
        : undefined;

    if (!organization && Number.isInteger(parsedOrganizationId) && parsedOrganizationId > 0) {
      organization = await storage.getOrganization(parsedOrganizationId);
    }

    if (organization) {
      const organizationStatus = normalizeOrgStatus(organization);
      if (organizationStatus === "inactive") {
        return res.status(403).json({ message: getBlockedOrganizationMessage(organizationStatus) });
      }

      const user = await storage.getUserByUsernameAndOrganization(normalizedUsername, organization.id);
      if (!user) return res.status(401).json({ message: "Usuário ou senha incorretos" });
      if (user.active === false) {
        return res.status(403).json({ message: "Usuário inativo. Entre em contato com o administrador." });
      }

      const passwordCheck = verifyPassword(password, user.password);
      if (!passwordCheck.valid) return res.status(401).json({ message: "Usuário ou senha incorretos" });
      if (passwordCheck.needsRehash) {
        await storage.updateUser(user.id, { password });
      }

      await regenerateSession(req);
      req.session.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        organizationId: organization.id,
        organizationName: organization.name,
        organizationStatus,
        stripeSubscriptionStatus: organization.stripeSubscriptionStatus ?? null,
        isSuperAdmin: false,
      };
      await logAudit(req, {
        action: "login",
        entityType: "user",
        entityId: user.id,
        organizationId: organization.id,
        message: `${user.name} entrou no sistema.`,
      });
      return res.json({ success: true, user: req.session.user });
    }

    if (parsedOrganizationCnpj || (Number.isInteger(parsedOrganizationId) && parsedOrganizationId > 0)) {
      return res.status(401).json({ message: "Usuário ou senha incorretos" });
    }

    const superAdmin = await storage.getSuperAdminByUsername(normalizedUsername);
    if (!superAdmin) {
      return res.status(400).json({ message: "Informe o CNPJ da organização para entrar." });
    }

    const passwordCheck = verifyPassword(password, superAdmin.password);
    if (!passwordCheck.valid) return res.status(401).json({ message: "Usuário ou senha incorretos" });
    if (passwordCheck.needsRehash) {
      await storage.updateUser(superAdmin.id, { password });
    }

    await regenerateSession(req);
    req.session.user = {
      id: superAdmin.id,
      username: superAdmin.username,
      name: superAdmin.name,
      role: superAdmin.role,
      organizationId: undefined,
      organizationName: undefined,
      isSuperAdmin: true,
    };
    await logAudit(req, {
      action: "login",
      entityType: "superadmin",
      entityId: superAdmin.id,
      organizationId: null,
      message: `${superAdmin.name} entrou como superadmin.`,
    });
    res.json({ success: true, user: req.session.user });
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.session.user) {
      await logAudit(req, {
        action: "logout",
        entityType: req.session.user.isSuperAdmin ? "superadmin" : "user",
        entityId: req.session.user.id ?? null,
        message: `${req.session.user.name} saiu do sistema.`,
      });
    }
    req.session.destroy(() => {
      res.clearCookie("easycare.sid");
      res.json({ success: true });
    });
  });
  app.get("/api/auth/me", async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser) return res.json(null);
    if (sessionUser.isSuperAdmin || !sessionUser.organizationId) {
      return res.json(sessionUser);
    }

    const organization = await storage.getOrganization(sessionUser.organizationId);
    if (!organization) {
      await destroySession(req);
      res.clearCookie("easycare.sid");
      return res.json(null);
    }

    const organizationStatus = normalizeOrgStatus(organization);
    if (organizationStatus === "inactive") {
      await destroySession(req);
      res.clearCookie("easycare.sid");
      return res.json(null);
    }

    req.session.user = {
      ...sessionUser,
      organizationName: organization.name,
      organizationStatus,
      stripeSubscriptionStatus: organization.stripeSubscriptionStatus ?? null,
    };
    res.json(req.session.user);
  });

  app.get("/api/public/stripe-config", (_req, res) => {
    const publishableKey = process.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() || "";
    res.json({
      publishableKey,
      publishableKeyConfigured: Boolean(publishableKey),
    });
  });

  app.get("/api/audit-logs", requireAuth, async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser) return res.status(401).json({ message: "Não autorizado" });

    const requestedOrgId = Number(req.query.organizationId);
    const organizationId = sessionUser.isSuperAdmin
      ? Number.isInteger(requestedOrgId) && requestedOrgId > 0 ? requestedOrgId : undefined
      : sessionUser.organizationId;

    const action = typeof req.query.action === "string" && req.query.action.trim()
      ? req.query.action.trim()
      : undefined;
    const entityType = typeof req.query.entityType === "string" && req.query.entityType.trim()
      ? req.query.entityType.trim()
      : undefined;
    const limitValue = Number(req.query.limit);

    const logs = await storage.getAuditLogs({
      organizationId,
      action,
      entityType,
      limit: Number.isFinite(limitValue) ? limitValue : 100,
    });
    res.json(logs);
  });

  app.get("/api/admin/runtime-config", requireAuth, requireSuperAdmin, (_req, res) => {
    res.json({
      nodeEnv: process.env.NODE_ENV ?? null,
      cwd: process.cwd(),
      entrypoint: process.argv[1] ?? null,
      stripeSecretKey: envIsConfigured("STRIPE_SECRET_KEY"),
      stripePriceId: envIsConfigured("STRIPE_PRICE_ID"),
      stripeMonthlyPriceId: envIsConfigured("STRIPE_MONTHLY_PRICE_ID"),
      stripeSemiannualPriceId: envIsConfigured("STRIPE_SEMIANNUAL_PRICE_ID"),
      stripeAnnualPriceId: envIsConfigured("STRIPE_ANNUAL_PRICE_ID"),
      stripeWebhookSecret: envIsConfigured("STRIPE_WEBHOOK_SECRET"),
      viteStripePublishableKey: envIsConfigured("VITE_STRIPE_PUBLISHABLE_KEY"),
      checkoutConfigured: checkoutConfigured(),
      portalConfigured: portalConfigured(),
    });
  });

  // ===== BILLING / STRIPE =====
  app.get("/api/billing/plans", requireAuth, async (req, res) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.organizationId || sessionUser.isSuperAdmin) {
        return res.status(400).json({ message: "Planos disponíveis apenas para organizações." });
      }

      if (!process.env.STRIPE_SECRET_KEY || !(process.env.STRIPE_MONTHLY_PRICE_ID || process.env.STRIPE_PRICE_ID)) {
        return res.json({
          plans: [
            { id: "monthly", name: "Plano mensal", configured: false, patientLimit: getBillingPlanPatientLimit("monthly"), amount: null, currency: "brl", interval: "month", intervalCount: 1, formattedAmount: null },
            { id: "semiannual", name: "Plano semestral", configured: false, patientLimit: getBillingPlanPatientLimit("semiannual"), amount: null, currency: "brl", interval: "month", intervalCount: 6, formattedAmount: null },
            { id: "annual", name: "Plano anual", configured: false, patientLimit: getBillingPlanPatientLimit("annual"), amount: null, currency: "brl", interval: "year", intervalCount: 1, formattedAmount: null },
          ],
          savings: null,
          savingsByPlan: { semiannual: null, annual: null },
        });
      }

      const monthlyPlan = await buildBillingPlanOption("monthly");
      const semiannualPlan = getStripeSemiannualPriceId()
        ? await buildBillingPlanOption("semiannual")
        : {
          id: "semiannual" as BillingPlan,
          name: "Plano semestral",
          configured: false,
          patientLimit: getBillingPlanPatientLimit("semiannual"),
          amount: null,
          currency: monthlyPlan.currency ?? "brl",
          interval: "month",
          intervalCount: 6,
          formattedAmount: null,
        };
      const annualPlan = getStripeAnnualPriceId()
        ? await buildBillingPlanOption("annual")
        : {
          id: "annual" as BillingPlan,
          name: "Plano anual",
          configured: false,
          patientLimit: getBillingPlanPatientLimit("annual"),
          amount: null,
          currency: monthlyPlan.currency ?? "brl",
          interval: "year",
          intervalCount: 1,
          formattedAmount: null,
        };

      const buildPlanSavings = (
        plan: typeof monthlyPlan,
        periodCount: number,
      ) => {
        const comparisonTotal = typeof monthlyPlan.amount === "number" ? monthlyPlan.amount * periodCount : null;
        const planAmount = typeof plan.amount === "number" ? plan.amount : null;
        const savingsAmount =
          typeof comparisonTotal === "number" && typeof planAmount === "number"
            ? Math.max(0, comparisonTotal - planAmount)
            : null;
        const savingsPercent =
          typeof savingsAmount === "number" && comparisonTotal && comparisonTotal > 0
            ? Math.round((savingsAmount / comparisonTotal) * 100)
            : null;
        const monthlyEquivalent =
          typeof planAmount === "number" ? Math.round(planAmount / periodCount) : null;

        return typeof savingsAmount === "number"
          ? {
            amount: savingsAmount,
            percent: savingsPercent,
            formattedAmount: formatStripeAmount(savingsAmount, monthlyPlan.currency),
            monthlyEquivalent,
            formattedMonthlyEquivalent: formatStripeAmount(monthlyEquivalent, plan.currency),
            comparisonTotal,
            formattedComparisonTotal: formatStripeAmount(comparisonTotal, monthlyPlan.currency),
            periodCount,
          }
          : null;
      };
      const semiannualSavings = buildPlanSavings(semiannualPlan, 6);
      const annualSavings = buildPlanSavings(annualPlan, 12);

      res.json({
        plans: [monthlyPlan, semiannualPlan, annualPlan],
        savings: annualSavings
          ? {
            amount: annualSavings.amount,
            percent: annualSavings.percent,
            formattedAmount: annualSavings.formattedAmount,
            annualMonthlyEquivalent: annualSavings.monthlyEquivalent,
            formattedAnnualMonthlyEquivalent: annualSavings.formattedMonthlyEquivalent,
            monthlyYearTotal: annualSavings.comparisonTotal,
            formattedMonthlyYearTotal: annualSavings.formattedComparisonTotal,
          }
          : null,
        savingsByPlan: {
          semiannual: semiannualSavings,
          annual: annualSavings,
        },
      });
    } catch (error) {
      const message = toBillingClientErrorMessage(error, "Não conseguimos carregar os planos agora.");
      res.status(500).json({ message });
    }
  });

  app.get("/api/billing/subscription", requireAuth, async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser?.organizationId || sessionUser.isSuperAdmin) {
      return res.status(400).json({ message: "Cobrança disponível apenas para organizações." });
    }

    const organization = await storage.getOrganization(sessionUser.organizationId);
    if (!organization) {
      return res.status(404).json({ message: "Organização não encontrada." });
    }

    const currentBillingPlan = getBillingPlanForStripePriceId(organization.stripePriceId);
    const normalizedOrganizationStatus = normalizeOrgStatus(organization);
    const paymentGraceDays = getPaymentGraceDays(organization.paymentGraceDays);
    const paymentGraceEndsAt = isStripePaymentIssueStatus(organization.stripeSubscriptionStatus)
      ? getPaymentGraceEndsAt(organization.subscriptionUpdatedAt, paymentGraceDays)
      : null;

    res.json({
      organizationName: organization.name,
      organizationStatus: normalizedOrganizationStatus,
      stripeSubscriptionStatus: organization.stripeSubscriptionStatus ?? null,
      stripeCancelAtPeriodEnd: organization.stripeCancelAtPeriodEnd ?? false,
      stripeCancelAt: organization.stripeCancelAt ?? null,
      stripePriceId: organization.stripePriceId ?? null,
      billingPlan: currentBillingPlan,
      capacity: organization.capacity ?? null,
      planPatientLimit: currentBillingPlan ? getBillingPlanPatientLimit(currentBillingPlan) : null,
      subscriptionCurrentPeriodEnd: organization.subscriptionCurrentPeriodEnd ?? null,
      subscriptionUpdatedAt: organization.subscriptionUpdatedAt ?? null,
      manualAccessUntil: organization.manualAccessUntil ?? null,
      billingMethod: organization.billingMethod ?? "stripe",
      manualBillingDueDay: organization.manualBillingDueDay ?? null,
      paymentGraceDays,
      paymentGraceEndsAt,
      paymentGraceDaysLeft: daysUntilDate(paymentGraceEndsAt),
      billingAccessState: resolveBillingAccessState(organization, normalizedOrganizationStatus),
      hasStripeCustomer: Boolean(organization.stripeCustomerId),
      checkoutConfigured: checkoutConfigured(),
      portalConfigured: portalConfigured(),
    });
  });

  app.post("/api/billing/checkout-session", requireAuth, async (req, res) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.organizationId || sessionUser.isSuperAdmin) {
        return res.status(400).json({ message: "Cobrança disponível apenas para organizações." });
      }

      const organization = await storage.getOrganization(sessionUser.organizationId);
      if (!organization) {
        return res.status(404).json({ message: "Organização não encontrada." });
      }
      if (normalizeOrgStatus(organization) === "inactive") {
        return res.status(403).json({ message: getBlockedOrganizationMessage("inactive") });
      }
      if (stripeSubscriptionAllowsAccess(organization)) {
        return res.status(400).json({ message: "Assinatura já ativa. Use o portal da Stripe para gerenciar a cobrança." });
      }

      const plan = parseBillingPlanInput(req.body?.plan);
      const checkoutSession = await createCheckoutSessionForOrganization(req, organization, {
        includeTrial: !organization.stripeCustomerId && !organization.stripeSubscriptionId,
        plan,
      });
      await logAudit(req, {
        action: "billing.checkout_started",
        entityType: "organization",
        entityId: organization.id,
        organizationId: organization.id,
        message: `${sessionUser.name} iniciou checkout Stripe (${getBillingPlanLabel(plan)}).`,
      });

      if (!checkoutSession.url) {
        return res.status(500).json({ message: "Stripe não retornou URL de checkout." });
      }
      res.json({ url: checkoutSession.url });
    } catch (error) {
      const message = toBillingClientErrorMessage(error, "Não conseguimos iniciar o checkout agora.");
      res.status(500).json({ message });
    }
  });

  app.post("/api/billing/embedded-checkout-session", requireAuth, async (req, res) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.organizationId || sessionUser.isSuperAdmin) {
        return res.status(400).json({ message: "Cobrança disponível apenas para organizações." });
      }

      const organization = await storage.getOrganization(sessionUser.organizationId);
      if (!organization) {
        return res.status(404).json({ message: "Organização não encontrada." });
      }
      if (normalizeOrgStatus(organization) === "inactive") {
        return res.status(403).json({ message: getBlockedOrganizationMessage("inactive") });
      }
      if (stripeSubscriptionAllowsAccess(organization)) {
        return res.status(400).json({ message: "Assinatura já ativa. Use o portal da Stripe para gerenciar a cobrança." });
      }

      const plan = parseBillingPlanInput(req.body?.plan);
      const checkoutSession = await createCheckoutSessionForOrganization(req, organization, {
        includeTrial: !organization.stripeCustomerId && !organization.stripeSubscriptionId,
        embedded: true,
        plan,
      });
      await logAudit(req, {
        action: "billing.checkout_started",
        entityType: "organization",
        entityId: organization.id,
        organizationId: organization.id,
        message: `${sessionUser.name} iniciou checkout Stripe embutido (${getBillingPlanLabel(plan)}).`,
      });

      if (!checkoutSession.client_secret) {
        return res.status(500).json({ message: "Stripe não retornou client_secret para checkout embutido." });
      }
      res.json({ clientSecret: checkoutSession.client_secret });
    } catch (error) {
      const message = toBillingClientErrorMessage(error, "Não conseguimos preparar o checkout agora.");
      res.status(500).json({ message });
    }
  });

  app.post("/api/billing/portal-session", requireAuth, async (req, res) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.organizationId || sessionUser.isSuperAdmin) {
        return res.status(400).json({ message: "Cobrança disponível apenas para organizações." });
      }

      const organization = await storage.getOrganization(sessionUser.organizationId);
      if (!organization?.stripeCustomerId) {
        return res.status(400).json({ message: "Cliente Stripe ainda não vinculado a esta organização." });
      }

      const stripe = getStripeClient();
      const portalConfigurationId = await getEasyCareStripePortalConfigurationId(req);
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: organization.stripeCustomerId,
        configuration: portalConfigurationId,
        return_url: `${getAppBaseUrl(req)}/billing`,
      });
      await logAudit(req, {
        action: "billing.portal_opened",
        entityType: "organization",
        entityId: organization.id,
        organizationId: organization.id,
        message: `${sessionUser.name} abriu o portal da Stripe.`,
        metadata: { portalConfigurationId },
      });
      res.json({ url: portalSession.url });
    } catch (error) {
      const message = toBillingClientErrorMessage(error, "Não conseguimos abrir o portal da assinatura agora.");
      res.status(500).json({ message });
    }
  });

  app.post("/api/billing/cancel-subscription", requireAuth, async (req, res) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.organizationId || sessionUser.isSuperAdmin) {
        return res.status(400).json({ message: "Cobrança disponível apenas para organizações." });
      }

      const organization = await storage.getOrganization(sessionUser.organizationId);
      if (!organization) {
        return res.status(404).json({ message: "Organização não encontrada." });
      }
      if (!organization.stripeSubscriptionId) {
        return res.status(400).json({ message: "Esta organização ainda não possui assinatura Stripe para cancelar." });
      }

      const stripe = getStripeClient();
      const currentSubscription = await stripe.subscriptions.retrieve(organization.stripeSubscriptionId);
      if (currentSubscription.cancel_at_period_end) {
        const synced = await syncStripeSubscriptionToOrganization(currentSubscription);
        return res.json({
          status: currentSubscription.status,
          cancelAtPeriodEnd: true,
          cancelAt: getStripeSubscriptionCancelAt(currentSubscription),
          subscriptionCurrentPeriodEnd: getStripeSubscriptionPeriodEnd(currentSubscription),
          organizationStatus: synced ? normalizeOrgStatus(synced) : normalizeOrgStatus(organization),
        });
      }

      const cancellableStatuses = new Set(["trialing", "active", "past_due", "unpaid", "incomplete"]);
      if (!cancellableStatuses.has(currentSubscription.status)) {
        return res.status(400).json({
          message: `Esta assinatura não pode ser cancelada neste estado (${currentSubscription.status}).`,
        });
      }

      const updatedSubscription = await stripe.subscriptions.update(currentSubscription.id, {
        cancel_at_period_end: true,
      });
      const synced = await syncStripeSubscriptionToOrganization(updatedSubscription);

      await logAudit(req, {
        action: "billing.subscription_cancel_scheduled",
        entityType: "organization",
        entityId: organization.id,
        organizationId: organization.id,
        message: `${sessionUser.name} agendou o cancelamento da assinatura Stripe.`,
        metadata: {
          subscriptionId: updatedSubscription.id,
          status: updatedSubscription.status,
          cancelAt: getStripeSubscriptionCancelAt(updatedSubscription)?.toISOString() ?? null,
        },
      });

      res.json({
        status: updatedSubscription.status,
        cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
        cancelAt: getStripeSubscriptionCancelAt(updatedSubscription),
        subscriptionCurrentPeriodEnd: getStripeSubscriptionPeriodEnd(updatedSubscription),
        organizationStatus: synced ? normalizeOrgStatus(synced) : normalizeOrgStatus(organization),
      });
    } catch (error) {
      const message = toBillingClientErrorMessage(error, "Não conseguimos agendar o cancelamento agora.");
      res.status(500).json({ message });
    }
  });

  app.post(STRIPE_WEBHOOK_PATH, async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({ message: "STRIPE_WEBHOOK_SECRET não configurado." });
    }

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      return res.status(400).json({ message: "Assinatura Stripe ausente." });
    }

    let event: Stripe.Event;
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      event = getStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook inválido.";
      return res.status(400).json({ message });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await syncCheckoutSessionToOrganization(event.data.object as Stripe.Checkout.Session);
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await syncStripeSubscriptionToOrganization(event.data.object as Stripe.Subscription);
          break;
        case "invoice.payment_succeeded":
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice & {
            subscription?: string | Stripe.Subscription | null;
          };
          const subscriptionId = typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;
          if (subscriptionId) {
            const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
            await syncStripeSubscriptionToOrganization(subscription);
          }
          break;
        }
        default:
          break;
      }

      res.json({ received: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao processar webhook Stripe.";
      console.error("[stripe] erro ao processar webhook", error);
      res.status(500).json({ message });
    }
  });

  // ===== NOTIFICATIONS =====
  app.get("/api/notifications", requireAuth, async (req, res, next) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.id || sessionUser.isSuperAdmin || !sessionUser.organizationId) {
        return res.json({ notifications: [], unreadCount: 0 });
      }
      const input = notificationQuerySchema.parse(req.query);
      const organization = await storage.getOrganization(sessionUser.organizationId);
      if (organization) {
        await ensureBillingStatusNotification(sessionUser.organizationId, sessionUser.id, organization);
      }
      const [items, unreadCount] = await Promise.all([
        storage.getNotifications(sessionUser.organizationId, sessionUser.id, {
          unreadOnly: input.unreadOnly,
          limit: input.limit,
        }),
        storage.countUnreadNotifications(sessionUser.organizationId, sessionUser.id),
      ]);
      res.json({ notifications: items, unreadCount });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Filtro inválido." });
      }
      next(error);
    }
  });

  app.patch("/api/notifications/read-all", requireAuth, async (req, res, next) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.id || sessionUser.isSuperAdmin || !sessionUser.organizationId) {
        return res.json({ updated: 0 });
      }
      const updated = await storage.markAllNotificationsRead(sessionUser.organizationId, sessionUser.id);
      res.json({ updated });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/notifications/:id/read", requireAuth, async (req, res, next) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.id || sessionUser.isSuperAdmin || !sessionUser.organizationId) {
        return res.status(404).json({ message: "Notificação não encontrada." });
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Notificação inválida." });
      }
      const updated = await storage.markNotificationRead(sessionUser.organizationId, sessionUser.id, id);
      if (!updated) return res.status(404).json({ message: "Notificação não encontrada." });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // ===== WEB PUSH NOTIFICATIONS =====
  app.get("/api/push-notifications/public-key", requireAuth, (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser?.id || sessionUser.isSuperAdmin || !sessionUser.organizationId) {
      return res.json({ enabled: false, publicKey: null });
    }

    const publicKey = getWebPushPublicKey();
    res.json({
      enabled: isWebPushConfigured(),
      publicKey: publicKey || null,
    });
  });

  app.post("/api/push-notifications/subscriptions", requireAuth, async (req, res, next) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.id || sessionUser.isSuperAdmin || !sessionUser.organizationId) {
        return res.status(403).json({ message: "Usuário sem organização para notificações." });
      }
      if (!isWebPushConfigured()) {
        return res.status(503).json({ message: "Web Push não configurado no servidor." });
      }

      const subscription = browserPushSubscriptionSchema.parse(req.body?.subscription ?? req.body);
      const saved = await storage.upsertPushSubscription({
        organizationId: sessionUser.organizationId,
        userId: sessionUser.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: req.get("user-agent") ?? null,
        active: true,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      });
      res.status(201).json({
        id: saved.id,
        enabled: saved.active !== false,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Inscricao push inválida." });
      }
      next(error);
    }
  });

  app.post("/api/push-notifications/test", requireAuth, async (req, res, next) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.id || sessionUser.isSuperAdmin || !sessionUser.organizationId) {
        return res.status(403).json({ message: "Usuário sem organização para notificações." });
      }
      if (!isWebPushConfigured()) {
        return res.status(503).json({ message: "Web Push não configurado no servidor." });
      }

      const subscriptions = await storage.getActivePushSubscriptions(sessionUser.organizationId, sessionUser.id);
      if (subscriptions.length === 0) {
        return res.status(400).json({ message: "Nenhuma inscrição Push ativa para este usuário neste dispositivo." });
      }

      const created = await storage.createNotification(buildInternalNotification(sessionUser.organizationId, {
        userId: sessionUser.id,
        type: "push_test",
        severity: "info",
        sourceModule: "notifications",
        title: "Teste de notificação EasyCare",
        message: "Se esta mensagem apareceu no celular, o Push deste dispositivo esta funcionando.",
        actionUrl: "/notificações",
      }));

      await sendWebPushNotifications([created]);
      res.json({
        success: true,
        notificationId: created.id,
        subscriptions: subscriptions.length,
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/push-notifications/subscriptions", requireAuth, async (req, res, next) => {
    try {
      const sessionUser = req.session.user;
      if (!sessionUser?.id || sessionUser.isSuperAdmin || !sessionUser.organizationId) {
        return res.json({ updated: 0 });
      }

      const input = browserPushUnsubscribeSchema.parse(req.body);
      const updated = await storage.deactivatePushSubscription(
        sessionUser.organizationId,
        sessionUser.id,
        input.endpoint,
      );
      res.json({ updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Inscricao push inválida." });
      }
      next(error);
    }
  });

  // ===== FAMILY PORTAL AUTH =====
  const requireFamilyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const familyMember = req.session.familyMember;
    if (!familyMember) return res.status(401).json({ message: "Não autorizado" });

    try {
      const organization = await storage.getOrganization(familyMember.organizationId);
      if (!organization) {
        await destroySession(req);
        res.clearCookie("easycare.sid");
        return res.status(403).json({ message: "Organização não encontrada. Acesso bloqueado." });
      }

      const organizationStatus = normalizeOrgStatus(organization);
      if (organizationStatus !== "active") {
        await destroySession(req);
        res.clearCookie("easycare.sid");
        return res.status(403).json({ message: getBlockedOrganizationMessage(organizationStatus) });
      }

      next();
    } catch (error) {
      next(error);
    }
  };

  const familyInvitePasswordSchema = z.object({
    password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres.").max(128),
  });

  const resolveFamilyPortalInvite = async (token: string) => {
    const normalizedToken = token.trim();
    if (normalizedToken.length < 24 || normalizedToken.length > 160) {
      return null;
    }

    const member = await storage.getFamilyMemberByInviteTokenHash(hashFamilyPortalInviteToken(normalizedToken));
    if (!member?.portalInviteExpiresAt) return null;

    const expiresAt = new Date(member.portalInviteExpiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return null;
    }

    const organization = await storage.getOrganization(member.organizationId);
    if (!organization || normalizeOrgStatus(organization) !== "active") return null;

    const resident = await storage.getResident(member.organizationId, member.residentId);
    if (!resident) return null;

    return { member, organization, resident, expiresAt };
  };

  app.get("/api/family-portal/invite/:token", async (req, res) => {
    const invite = await resolveFamilyPortalInvite(req.params.token);
    if (!invite) {
      return res.status(404).json({ message: "Convite inválido ou expirado." });
    }

    res.json({
      expiresAt: invite.expiresAt,
      member: {
        name: invite.member.name,
        relationship: invite.member.relationship,
      },
      organization: {
        name: invite.organization.name,
        phone: invite.organization.phone ?? null,
      },
      resident: {
        name: invite.resident.name,
      },
    });
  });

  app.post("/api/family-portal/invite/:token/accept", familyLoginRateLimiter, async (req, res) => {
    try {
      const invite = await resolveFamilyPortalInvite(req.params.token);
      if (!invite) {
        return res.status(404).json({ message: "Convite inválido ou expirado." });
      }

      const input = familyInvitePasswordSchema.parse(req.body);
      const member = await storage.updateFamilyMember(invite.member.organizationId, invite.member.id, {
        portalAccess: true,
        portalPassword: input.password,
        portalInviteTokenHash: null,
        portalInviteExpiresAt: null,
        portalLastLoginAt: new Date(),
      } as any);

      await regenerateSession(req);
      req.session.familyMember = buildFamilyPortalSession(member, invite.organization);
      await logAudit(req, {
        action: "family.portal_activated",
        entityType: "family_member",
        entityId: member.id,
        organizationId: member.organizationId,
        message: `${member.name} ativou o acesso ao portal da família.`,
        metadata: { residentId: member.residentId },
      });
      res.json({ success: true, familyMember: req.session.familyMember });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Senha inválida." });
      }
      const message = error instanceof Error ? error.message : "Erro ao aceitar convite.";
      res.status(400).json({ message });
    }
  });

  app.post("/api/family-portal/login", familyLoginRateLimiter, async (req, res) => {
    const { username, password, organizationCnpj } = req.body;
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ message: "Usuário e senha obrigatórios" });
    }

    const parsedOrganizationCnpj =
      typeof organizationCnpj === "string" ? organizationCnpj.trim() : "";
    if (!parsedOrganizationCnpj) {
      return res.status(400).json({ message: "Informe o CNPJ da organização para entrar." });
    }

    const organization = await storage.getOrganizationByCnpj(parsedOrganizationCnpj);
    if (!organization) {
      return res.status(401).json({ message: "Usuário ou senha incorretos" });
    }
    const organizationStatus = normalizeOrgStatus(organization);
    if (organizationStatus !== "active") {
      return res.status(403).json({ message: getBlockedOrganizationMessage(organizationStatus) });
    }

    const candidates = (await storage.getFamilyMembersByPortalLogin(username))
      .filter((member) => member.organizationId === organization.id);

    const validMatches = candidates
      .map((member) => ({ member, passwordCheck: verifyPassword(password, member.portalPassword ?? "") }))
      .filter((entry) => entry.passwordCheck.valid);

    if (validMatches.length === 0) {
      return res.status(401).json({ message: "Usuário ou senha incorretos" });
    }
    if (validMatches.length > 1) {
      return res.status(400).json({
        message: "Encontramos mais de um acesso com essas credenciais. Solicite ao administrador a redefinição do usuário do portal.",
      });
    }

    const { member, passwordCheck } = validMatches[0];

    const memberUpdates: Record<string, unknown> = { portalLastLoginAt: new Date() };
    if (passwordCheck.needsRehash) {
      memberUpdates.portalPassword = password;
    }
    const updatedMember = await storage.updateFamilyMember(member.organizationId, member.id, memberUpdates as any);

    await regenerateSession(req);
    req.session.familyMember = buildFamilyPortalSession(updatedMember, organization);
    await logAudit(req, {
      action: "family.portal_login",
      entityType: "family_member",
      entityId: updatedMember.id,
      organizationId: updatedMember.organizationId,
      message: `${updatedMember.name} entrou no portal da família.`,
      metadata: { residentId: updatedMember.residentId },
    });
    res.json({ success: true, familyMember: req.session.familyMember });
  });

  app.post("/api/family-portal/logout", async (req, res) => {
    if (req.session.familyMember) {
      await logAudit(req, {
        action: "family.portal_logout",
        entityType: "family_member",
        entityId: req.session.familyMember.id,
        organizationId: req.session.familyMember.organizationId,
        message: `${req.session.familyMember.name} saiu do portal da família.`,
      });
    }
    req.session.destroy(() => {
      res.clearCookie("easycare.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/family-portal/me", (req, res) => {
    res.json(req.session.familyMember || null);
  });

  app.get("/api/family-portal/resident", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    const resident = await storage.getResident(organizationId, residentId);
    if (!resident) return res.status(404).json({ message: "Paciente não encontrado" });
    // Return safe subset of resident data for family
    res.json({
      id: resident.id,
      name: resident.name,
      birthDate: resident.birthDate,
      roomNumber: resident.roomNumber,
      admissionDate: resident.admissionDate,
      healthNotes: resident.healthNotes,
      allergies: resident.allergies,
      dietaryRestrictions: resident.dietaryRestrictions,
      mobilityStatus: resident.mobilityStatus,
      cognitiveStatus: resident.cognitiveStatus,
      status: resident.status,
    });
  });

  app.get("/api/family-portal/medical-records", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    const records = await storage.getMedicalRecords(organizationId, residentId);
    // Only return shared records for family portal
    res.json(records.filter(r => r.visibility === "shared"));
  });

  app.get("/api/family-portal/medications", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    const meds = await storage.getMedications(organizationId, residentId);
    res.json(meds.filter(m => m.status === "active"));
  });

  app.get("/api/family-portal/occurrences", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    const occs = await storage.getOccurrences(organizationId, residentId);
    // Only show medium and high severity occurrences to family
    res.json(occs.filter(o => o.severity !== "low"));
  });

  app.get("/api/family-portal/comorbidities", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    res.json(await storage.getComorbidities(organizationId, residentId));
  });

  // ===== ORGANIZATIONS =====
  app.get("/api/organizations", requireAuth, requireSuperAdmin, async (req, res) => {
    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
    res.json(await storage.getOrganizations(includeInactive));
  });
  app.get("/api/onboarding/status", requireAuth, async (req, res) => {
    const organizationId = req.session.user?.organizationId;
    if (!organizationId || req.session.user?.isSuperAdmin) {
      return res.status(400).json({ message: "Organização não encontrada para este usuário." });
    }

    const summary = await getOrganizationOnboardingSummary(organizationId);
    if (!summary) {
      return res.status(404).json({ message: "Organização não encontrada." });
    }
    res.json(summary);
  });
  app.get("/api/organizations/onboarding-summary", requireAuth, requireSuperAdmin, async (_req, res) => {
    const organizations = await storage.getOrganizations(true);
    const summaries = await Promise.all(organizations.map((organization) => getOrganizationOnboardingSummary(organization.id)));
    res.json(summaries.filter(Boolean));
  });
  app.get("/api/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    const organization = await storage.getOrganization(Number(req.params.id));
    if (!organization) {
      return res.status(404).json({ message: "Organização não encontrada" });
    }
    res.json(organization);
  });
  app.get("/api/organizations/:id/usage", requireAuth, requireSuperAdmin, async (req, res) => {
    const orgId = Number(req.params.id);
    const organization = await storage.getOrganization(orgId);
    if (!organization) {
      return res.status(404).json({ message: "Organização não encontrada" });
    }

    const [users, residents] = await Promise.all([
      storage.getUsersByOrganization(orgId),
      storage.getResidents(orgId, { search: "" }),
    ]);
    const familyGroups = await Promise.all(
      residents.map((resident) => storage.getFamilyMembers(orgId, resident.id)),
    );
    const members = familyGroups.flat();
    const lastFamilyPortalLoginAt = members.reduce<Date | null>((latest, member) => {
      if (!member.portalLastLoginAt) return latest;
      const parsed = new Date(member.portalLastLoginAt);
      if (Number.isNaN(parsed.getTime())) return latest;
      if (!latest || parsed.getTime() > latest.getTime()) return parsed;
      return latest;
    }, null);

    res.json({
      users: users.length,
      activeUsers: users.filter((user) => user.active !== false).length,
      residents: residents.length,
      activeResidents: residents.filter((resident) => resident.status === "active").length,
      familyMembers: members.length,
      familyPortalAccess: members.filter((member) => member.portalAccess).length,
      lastFamilyPortalLoginAt,
    });
  });
  app.post("/api/organizations/:id/billing/sync", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = Number(req.params.id);
      const organization = await storage.getOrganization(orgId);
      if (!organization) {
        return res.status(404).json({ message: "Organização não encontrada" });
      }
      if (!organization.stripeSubscriptionId && !organization.stripeCustomerId) {
        return res.status(400).json({ message: "Organização ainda não tem vínculo Stripe." });
      }

      const stripe = getStripeClient();
      let subscription: Stripe.Subscription | undefined;
      if (organization.stripeSubscriptionId) {
        subscription = await stripe.subscriptions.retrieve(organization.stripeSubscriptionId);
      } else if (organization.stripeCustomerId) {
        const subscriptions = await stripe.subscriptions.list({
          customer: organization.stripeCustomerId,
          status: "all",
          limit: 10,
        });
        subscription = subscriptions.data.sort((left, right) => right.created - left.created)[0];
      }

      if (!subscription) {
        return res.json({ synced: false, organization });
      }

      const updated = await syncStripeSubscriptionToOrganization(subscription);
      res.json({ synced: true, organization: updated ?? await storage.getOrganization(orgId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao sincronizar assinatura Stripe.";
      res.status(500).json({ message });
    }
  });
  app.post("/api/organizations", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const {
        name,
        address,
        phone,
        email,
        cnpj,
        capacity,
        status,
        manualAccessUntil,
        billingMethod,
        manualBillingDueDay,
        paymentGraceDays,
      } = req.body;
      if (!name || !cnpj || typeof cnpj !== "string" || !cnpj.trim()) {
        return res.status(400).json({ message: "Nome e CNPJ são obrigatórios" });
      }
      const parsedStatus = status === undefined ? "restricted" : parseOrgStatusInput(status);
      if (!parsedStatus) {
        return res.status(400).json({ message: "Status inválido. Use: active, inactive ou restricted." });
      }
      const organization = await storage.createOrganization({
        name,
        address,
        phone,
        email,
        cnpj: cnpj.trim(),
        capacity,
        status: parsedStatus,
        active: parsedStatus === "active",
        manualAccessUntil: parseManualAccessUntilInput(manualAccessUntil) ?? null,
        billingMethod: parseBillingMethodInput(billingMethod) ?? "stripe",
        manualBillingDueDay: parseNullableBoundedInteger(manualBillingDueDay, "Dia de vencimento", 1, 31) ?? null,
        paymentGraceDays: parseNullableBoundedInteger(paymentGraceDays, "Tolerância", 0, 60) ?? DEFAULT_PAYMENT_GRACE_DAYS,
      });
      await logAudit(req, {
        action: "organization.created",
        entityType: "organization",
        entityId: organization.id,
        organizationId: organization.id,
        message: `Organização ${organization.name} criada pelo superadmin.`,
      });
      res.status(201).json(organization);
    } catch { res.status(500).json({ message: "Erro ao criar organização" }); }
  });
  app.put("/api/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const payload = { ...req.body };
      const manualAccessReason = typeof payload.manualAccessReason === "string" && payload.manualAccessReason.trim()
        ? payload.manualAccessReason.trim()
        : null;
      delete payload.manualAccessReason;
      if (typeof payload.cnpj === "string") payload.cnpj = payload.cnpj.trim();
      if ("manualAccessUntil" in payload) {
        payload.manualAccessUntil = parseManualAccessUntilInput(payload.manualAccessUntil) ?? null;
      }
      if ("billingMethod" in payload) {
        payload.billingMethod = parseBillingMethodInput(payload.billingMethod) ?? "stripe";
      }
      if ("manualBillingDueDay" in payload) {
        payload.manualBillingDueDay = parseNullableBoundedInteger(payload.manualBillingDueDay, "Dia de vencimento", 1, 31);
      }
      if ("paymentGraceDays" in payload) {
        payload.paymentGraceDays = parseNullableBoundedInteger(payload.paymentGraceDays, "Tolerância", 0, 60) ?? DEFAULT_PAYMENT_GRACE_DAYS;
      }
      const parsedStatus = parseOrgStatusInput(payload.status);
      if (payload.status !== undefined && !parsedStatus) {
        return res.status(400).json({ message: "Status inválido. Use: active, inactive ou restricted." });
      }
      if (parsedStatus) {
        payload.status = parsedStatus;
        payload.active = parsedStatus === "active";
      } else if (typeof payload.active === "boolean") {
        payload.status = payload.active ? "active" : "inactive";
      }
      const organization = await storage.updateOrganization(Number(req.params.id), payload);
      const manualAccessReleased = Boolean(manualAccessReason && payload.manualAccessUntil && payload.status === "active");
      await logAudit(req, {
        action: manualAccessReleased ? "organization.manual_access_released" : "organization.updated",
        entityType: "organization",
        entityId: organization.id,
        organizationId: organization.id,
        message: manualAccessReleased
          ? `Acesso manual liberado para ${organization.name} até ${formatAppNotificationDateTime(new Date(payload.manualAccessUntil))}. Motivo: ${manualAccessReason}.`
          : `Organização ${organization.name} atualizada.`,
        metadata: { fields: Object.keys(payload), manualAccessReason },
      });
      res.json(organization);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao atualizar organização.";
      res.status(400).json({ message });
    }
  });
  app.delete("/api/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    const orgId = Number(req.params.id);
    await logAudit(req, {
      action: "organization.deleted",
      entityType: "organization",
      entityId: orgId,
      organizationId: orgId,
      message: `Organização ${orgId} removida pelo superadmin.`,
    });
    await storage.deleteOrganization(orgId);
    res.status(204).send();
  });

  app.get(ENV_SETTINGS_API_PATH, requireAuth, async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser) return res.status(401).json({ message: "Não autorizado" });
    if (sessionUser.isSuperAdmin || !sessionUser.organizationId) {
      return res.json(DEFAULT_ENVIRONMENT_SETTINGS);
    }

    const organization = await storage.getOrganization(sessionUser.organizationId);
    if (!organization) {
      return res.status(404).json({ message: "Organização não encontrada" });
    }

    res.json(parseEnvironmentSettingsFromOrganization(organization));
  });

  app.put(ENV_SETTINGS_API_PATH, requireAuth, requireRole("admin"), async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser?.organizationId) {
      return res.status(400).json({ message: "Usuário sem organização associada." });
    }

    const settings = normalizeEnvironmentSettings(req.body);
    await storage.updateOrganization(sessionUser.organizationId, {
      environmentSettings: JSON.stringify(settings),
    });
    res.json(settings);
  });

  // ===== ORG USERS =====
  app.get("/api/organizations/:id/users", requireAuth, requireSuperAdmin, async (req, res) => {
    const users = await storage.getUsersByOrganization(Number(req.params.id));
    res.json(users.map(sanitizeUser));
  });

  const findStaffForOrganizationUser = async (orgId: number, user: { id: number; username: string; name: string }) => {
    const staffMembers = await storage.getStaff(orgId);
    const normalizedUsername = normalizePortalUsername(user.username);
    const normalizedName = normalizeLinkableText(user.name);

    const linkedByUserId = staffMembers.find((member) => member.portalUserId === user.id);
    if (linkedByUserId) return linkedByUserId;

    const linkedByUsername = staffMembers.find(
      (member) => normalizePortalUsername(member.portalUsername ?? "") === normalizedUsername,
    );
    if (linkedByUsername) return linkedByUsername;

    const nameMatches = staffMembers.filter(
      (member) => !member.portalUserId && normalizeLinkableText(member.name) === normalizedName,
    );
    return nameMatches.length === 1 ? nameMatches[0] : undefined;
  };

  const ensureStaffForOrganizationUser = async (
    orgId: number,
    user: { id: number; username: string; name: string; role: string; active?: boolean | null },
    settings: EnvironmentSettings,
  ) => {
    const normalizedUsername = normalizePortalUsername(user.username);
    const roleValue = getAllowedRolesForSettings(settings).includes(normalizeStaffRoleValue(user.role))
      ? normalizeStaffRoleValue(user.role)
      : getDefaultRoleForSettings(settings);
    const defaultShift = getDefaultStaffShiftForSettings(settings);
    const existingStaff = await findStaffForOrganizationUser(orgId, user);
    const staffPayload = {
      name: user.name.trim(),
      role: roleValue,
      active: user.active !== false,
      portalAccess: true,
      portalUsername: normalizedUsername,
      portalUserId: user.id,
    };

    if (existingStaff) {
      return await storage.updateStaff(orgId, existingStaff.id, {
        ...staffPayload,
        shift: existingStaff.shift || defaultShift,
      } as any);
    }

    return await storage.createStaff({
      organizationId: orgId,
      ...staffPayload,
      shift: defaultShift,
    } as any);
  };

  const detachStaffFromOrganizationUser = async (user: { id: number; organizationId?: number | null; username: string }) => {
    if (!user.organizationId) return;
    const staffMembers = await storage.getStaff(user.organizationId);
    const normalizedUsername = normalizePortalUsername(user.username);
    const linkedStaff = staffMembers.find((member) =>
      member.portalUserId === user.id || normalizePortalUsername(member.portalUsername ?? "") === normalizedUsername,
    );
    if (!linkedStaff) return;

    await storage.updateStaff(user.organizationId, linkedStaff.id, {
      portalAccess: false,
      portalUsername: null,
      portalUserId: null,
    } as any);
  };

  const normalizeCnpjDigits = (value: string) => value.replace(/\D/g, "");
  const formatCnpj = (value: string) => {
    const digits = normalizeCnpjDigits(value);
    if (digits.length !== 14) return value.trim();
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };
  const publicSignupSchema = z.object({
    organizationName: z.string().trim().min(2, "Informe o nome da instituição.").max(140),
    cnpj: z.string().trim().refine((value) => normalizeCnpjDigits(value).length === 14, {
      message: "Informe um CNPJ válido.",
    }),
    phone: z.string().trim().min(8, "Informe um telefone.").max(30),
    email: z.string().trim().email("Informe um e-mail válido.").max(160),
    capacity: z.coerce.number().int().min(1).max(500).optional(),
    adminName: z.string().trim().min(2, "Informe seu nome.").max(120),
    username: z.string()
      .trim()
      .min(3, "Informe um usuário com pelo menos 3 caracteres.")
      .max(60)
      .regex(/^[a-zA-Z0-9._-]+$/, "Use apenas letras, números, ponto, hífen ou underline no usuário."),
    password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres.").max(128),
    embeddedCheckout: z.boolean().optional(),
    deferCheckout: z.boolean().optional(),
  });

  app.post("/api/public/signup", publicSignupRateLimiter, async (req, res) => {
    let createdOrganizationId: number | undefined;
    let createdUserId: number | undefined;
    let createdStaffId: number | undefined;

    try {
      if (!checkoutConfigured()) {
        return res.status(500).json({ message: "Checkout Stripe ainda não configurado." });
      }

      const input = publicSignupSchema.parse(req.body);
      const normalizedCnpj = formatCnpj(input.cnpj);
      const existingOrganization = await storage.getOrganizationByCnpj(normalizedCnpj);
      if (existingOrganization) {
        return res.status(409).json({
          message: "Esta instituição já está cadastrada. Entre pelo login ou fale com o suporte.",
        });
      }

      const organization = await storage.createOrganization({
        name: input.organizationName,
        cnpj: normalizedCnpj,
        phone: input.phone,
        email: input.email,
        capacity: input.capacity ?? 50,
        status: "restricted",
        active: false,
      });
      createdOrganizationId = organization.id;

      const usernameValue = normalizePortalUsername(input.username);
      const user = await storage.createUser({
        organizationId: organization.id,
        username: usernameValue,
        password: input.password,
        name: input.adminName,
        email: input.email,
        phone: input.phone,
        role: "admin",
        active: true,
        isSuperAdmin: false,
      });
      createdUserId = user.id;

      const staffMember = await ensureStaffForOrganizationUser(organization.id, user, DEFAULT_ENVIRONMENT_SETTINGS);
      createdStaffId = staffMember.id;

      let checkoutSession: Stripe.Checkout.Session | null = null;
      if (input.deferCheckout !== true) {
        checkoutSession = await createCheckoutSessionForOrganization(req, organization, {
          includeTrial: true,
          embedded: input.embeddedCheckout === true,
        });
        if (input.embeddedCheckout === true && !checkoutSession.client_secret) {
          throw new Error("Stripe não retornou client_secret para checkout embutido.");
        }
        if (input.embeddedCheckout !== true && !checkoutSession.url) {
          throw new Error("Stripe não retornou URL de checkout.");
        }
      }

      await regenerateSession(req);
      req.session.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        organizationId: organization.id,
        organizationName: organization.name,
        organizationStatus: "restricted",
        stripeSubscriptionStatus: null,
        isSuperAdmin: false,
      };

      await logAudit(req, {
        action: "organization.signup",
        entityType: "organization",
        entityId: organization.id,
        organizationId: organization.id,
        message: `${organization.name} iniciou cadastro self-service.`,
        metadata: {
          adminUserId: user.id,
          checkoutDeferred: input.deferCheckout === true,
          checkoutSessionId: checkoutSession?.id ?? null,
        },
      });

      res.status(201).json({
        url: checkoutSession?.url,
        clientSecret: checkoutSession?.client_secret,
        checkoutPath: input.deferCheckout === true ? "/checkout" : undefined,
        trialDays: getStripeTrialDays(),
        user: req.session.user,
      });
    } catch (error: any) {
      if (createdStaffId && createdOrganizationId) {
        await storage.deleteStaff(createdOrganizationId, createdStaffId).catch(() => undefined);
      }
      if (createdUserId) {
        await storage.deleteUser(createdUserId).catch(() => undefined);
      }
      if (createdOrganizationId) {
        await storage.deleteOrganization(createdOrganizationId).catch(() => undefined);
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Dados já cadastrados. Revise CNPJ e usuário." });
      }
      const message = error instanceof Error ? error.message : "Erro ao criar cadastro.";
      res.status(500).json({ message });
    }
  });

  app.post("/api/organizations/:id/users", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = Number(req.params.id);
      const settingsResult = await getOrganizationEnvironmentSettings(orgId);
      if (!settingsResult) {
        return res.status(404).json({ message: "Organização não encontrada" });
      }

      const { username, password, name, role } = req.body;
      if (!username || !password || !name) return res.status(400).json({ message: "Campos obrigatórios faltando" });
      const usernameValue = normalizePortalUsername(String(username));
      const nameValue = String(name).trim();
      if (!usernameValue || usernameValue.length < 3) {
        return res.status(400).json({ message: "Informe um usuário com pelo menos 3 caracteres." });
      }
      if (!nameValue) {
        return res.status(400).json({ message: "Nome obrigatório." });
      }
      const existingUsers = await storage.getUsersByOrganization(orgId);
      if (existingUsers.some((item) => normalizePortalUsername(item.username) === usernameValue)) {
        return res.status(400).json({ message: "Nome de usuário já existe nesta organização" });
      }
      const allowedRoles = getAllowedRolesForSettings(settingsResult.settings);
      const roleValue = typeof role === "string" && role.trim()
        ? normalizeStaffRoleValue(role)
        : getDefaultRoleForSettings(settingsResult.settings);
      if (!allowedRoles.includes(roleValue)) {
        return res.status(400).json({ message: "Papel inválido para esta organização." });
      }

      const user = await storage.createUser({
        organizationId: orgId,
        username: usernameValue,
        password,
        name: nameValue,
        role: roleValue,
        isSuperAdmin: false,
      });
      try {
        await ensureStaffForOrganizationUser(orgId, user, settingsResult.settings);
      } catch (error) {
        await storage.deleteUser(user.id);
        throw error;
      }
      await logAudit(req, {
        action: "user.created",
        entityType: "user",
        entityId: user.id,
        organizationId: orgId,
        message: `Usuário ${user.name} criado.`,
        metadata: { role: user.role },
      });
      res.status(201).json(sanitizeUser(user));
    } catch (err: any) {
      if (err.code === "23505") return res.status(400).json({ message: "Nome de usuário já existe nesta organização" });
      res.status(400).json({ message: err?.message || "Erro ao criar usuário" });
    }
  });
  app.patch("/api/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, username, password, role } = req.body;
      const userId = Number(req.params.id);
      const currentUser = await storage.getUserById(userId);
      if (!currentUser) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }
      if (!currentUser.organizationId) {
        return res.status(400).json({ message: "Usuário sem organização associada." });
      }

      const updates: any = {};
      if (name !== undefined) {
        const nameValue = String(name).trim();
        if (!nameValue) return res.status(400).json({ message: "Nome obrigatório." });
        updates.name = nameValue;
      }
      if (username !== undefined) {
        const usernameValue = normalizePortalUsername(String(username));
        if (!usernameValue || usernameValue.length < 3) {
          return res.status(400).json({ message: "Informe um usuário com pelo menos 3 caracteres." });
        }
        const existingUsers = await storage.getUsersByOrganization(currentUser.organizationId);
        if (existingUsers.some((item) => item.id !== userId && normalizePortalUsername(item.username) === usernameValue)) {
          return res.status(400).json({ message: "Nome de usuário já existe nesta organização" });
        }
        updates.username = usernameValue;
      }
      if (role !== undefined) {
        if (typeof role !== "string" || !role.trim()) {
          return res.status(400).json({ message: "Papel inválido." });
        }
        const settingsResult = await getOrganizationEnvironmentSettings(currentUser.organizationId);
        if (!settingsResult) {
          return res.status(404).json({ message: "Organização não encontrada" });
        }
        const allowedRoles = getAllowedRolesForSettings(settingsResult.settings);
        const roleValue = normalizeStaffRoleValue(role);
        if (!allowedRoles.includes(roleValue)) {
          return res.status(400).json({ message: "Papel inválido para esta organização." });
        }
        updates.role = roleValue;
      }
      if (password && password.trim() !== "") updates.password = password;
      const updated = await storage.updateUser(userId, updates);
      const settingsResult = await getOrganizationEnvironmentSettings(currentUser.organizationId);
      if (settingsResult) {
        await ensureStaffForOrganizationUser(currentUser.organizationId, updated, settingsResult.settings);
      }
      await logAudit(req, {
        action: "user.updated",
        entityType: "user",
        entityId: updated.id,
        organizationId: currentUser.organizationId,
        message: `Usuário ${updated.name} atualizado.`,
        metadata: { fields: Object.keys(updates) },
      });
      res.json(sanitizeUser(updated));
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Erro ao atualizar usuário" });
    }
  });
  app.delete("/api/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    const user = await storage.getUserById(Number(req.params.id));
    if (user) {
      await detachStaffFromOrganizationUser(user);
      await logAudit(req, {
        action: "user.deleted",
        entityType: "user",
        entityId: user.id,
        organizationId: user.organizationId ?? null,
        message: `Usuário ${user.name} removido.`,
      });
    }
    await storage.deleteUser(Number(req.params.id));
    res.status(204).send();
  });

  const shouldCountAsActivePatient = (status: unknown) =>
    typeof status !== "string" || status.trim() === "" || status.trim().toLowerCase() === "active";

  const ensurePatientCapacityAvailable = async (
    res: Response,
    orgId: number,
    excludedResidentId?: number,
  ) => {
    const [organization, activeResidents] = await Promise.all([
      storage.getOrganization(orgId),
      storage.getResidents(orgId, { search: "", status: "active" }),
    ]);
    const capacity = organization?.capacity ?? 50;
    const activeCount = activeResidents.filter((resident) => resident.id !== excludedResidentId).length;

    if (capacity > 0 && activeCount >= capacity) {
      res.status(409).json({
        message: `Limite de pacientes ativos do plano atingido (${capacity}). Faça upgrade para liberar mais pacientes.`,
        capacity,
        activePatients: activeCount,
      });
      return false;
    }

    return true;
  };

  // ===== RESIDENTS =====
  app.get("/api/residents", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getResidents(orgId, req.query as any));
  });
  app.get("/api/residents/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const resident = await storage.getResident(orgId, Number(req.params.id));
    if (!resident) return res.status(404).json({ message: "Paciente não encontrado" });
    res.json(resident);
  });
  app.post("/api/residents", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      if (shouldCountAsActivePatient(req.body?.status)) {
        const hasCapacity = await ensurePatientCapacityAvailable(res, orgId);
        if (!hasCapacity) return;
      }

      const resident = await storage.createResident({ ...req.body, organizationId: orgId });
      await logAudit(req, {
        action: "resident.created",
        entityType: "resident",
        entityId: resident.id,
        organizationId: orgId,
        message: `Paciente ${resident.name} cadastrado.`,
      });
      res.status(201).json(resident);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });
  app.put("/api/residents/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const residentId = Number(req.params.id);
    const currentResident = await storage.getResident(orgId, residentId);
    if (!currentResident) return res.status(404).json({ message: "Paciente não encontrado" });

    const nextStatus = typeof req.body?.status === "string" ? req.body.status : currentResident.status;
    if (currentResident.status !== "active" && shouldCountAsActivePatient(nextStatus)) {
      const hasCapacity = await ensurePatientCapacityAvailable(res, orgId, residentId);
      if (!hasCapacity) return;
    }

    const resident = await storage.updateResident(orgId, residentId, req.body);
    await logAudit(req, {
      action: "resident.updated",
      entityType: "resident",
      entityId: resident.id,
      organizationId: orgId,
      message: `Paciente ${resident.name} atualizado.`,
      metadata: { fields: Object.keys(req.body ?? {}) },
    });
    res.json(resident);
  });
  app.delete("/api/residents/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const residentId = Number(req.params.id);
    await logAudit(req, {
      action: "resident.deleted",
      entityType: "resident",
      entityId: residentId,
      organizationId: orgId,
      message: `Paciente ${residentId} removido.`,
    });
    await storage.deleteResident(orgId, residentId);
    res.status(204).send();
  });

  // ===== FAMILY MEMBERS =====
  app.get("/api/residents/:residentId/family", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const members = await storage.getFamilyMembers(orgId, Number(req.params.residentId));
    res.json(members.map(sanitizeFamilyMember));
  });
  app.post("/api/residents/:residentId/family", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const payload = {
        ...req.body,
        organizationId: orgId,
        residentId: Number(req.params.residentId),
      } as Record<string, unknown>;

      if (payload.portalAccess) {
        await assertPortalUsernameAvailable(orgId, payload.portalUsername);
      }

      const member = await storage.createFamilyMember(payload as any);
      await logAudit(req, {
        action: "family.created",
        entityType: "family_member",
        entityId: member.id,
        organizationId: orgId,
        message: `Familiar ${member.name} cadastrado.`,
        metadata: { residentId: member.residentId },
      });
      res.status(201).json(sanitizeFamilyMember(member));
    } catch (err) {
      res.status(400).json({
        message: err instanceof Error ? err.message : "Erro ao cadastrar familiar",
      });
    }
  });
  app.put("/api/family/:id", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const memberId = Number(req.params.id);
      const payload = { ...req.body } as Record<string, unknown>;

      if (payload.portalAccess || typeof payload.portalUsername === "string") {
        await assertPortalUsernameAvailable(orgId, payload.portalUsername, memberId);
      }

      const member = await storage.updateFamilyMember(orgId, memberId, payload as any);
      await logAudit(req, {
        action: "family.updated",
        entityType: "family_member",
        entityId: member.id,
        organizationId: orgId,
        message: `Familiar ${member.name} atualizado.`,
        metadata: { fields: Object.keys(payload) },
      });
      res.json(sanitizeFamilyMember(member));
    } catch (err) {
      res.status(400).json({
        message: err instanceof Error ? err.message : "Erro ao atualizar familiar",
      });
    }
  });
  app.post("/api/family/:id/portal-invite", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const memberId = Number(req.params.id);
      const member = await storage.getFamilyMember(orgId, memberId);
      if (!member) {
        return res.status(404).json({ message: "Familiar não encontrado." });
      }

      const organization = await storage.getOrganization(orgId);
      const resident = await storage.getResident(orgId, member.residentId);
      if (!organization || !resident) {
        return res.status(404).json({ message: "Dados do convite não encontrados." });
      }

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + FAMILY_PORTAL_INVITE_DAYS * 24 * 60 * 60 * 1000);
      await storage.updateFamilyMember(orgId, member.id, {
        portalInviteTokenHash: hashFamilyPortalInviteToken(token),
        portalInviteExpiresAt: expiresAt,
        portalInvitedAt: new Date(),
      } as any);

      const inviteUrl = buildFamilyPortalInviteUrl(req, token);
      const whatsappText = [
        `Olá, ${member.name}.`,
        `${organization.name} liberou seu acesso ao Portal da Família EasyCare para acompanhar ${resident.name}.`,
        `Acesse e crie sua senha: ${inviteUrl}`,
        `Este convite expira em ${FAMILY_PORTAL_INVITE_DAYS} dias.`,
      ].join("\n");

      await logAudit(req, {
        action: "family.invite_created",
        entityType: "family_member",
        entityId: member.id,
        organizationId: orgId,
        message: `Convite familiar gerado para ${member.name}.`,
        metadata: { residentId: resident.id, expiresAt },
      });

      res.json({
        url: inviteUrl,
        expiresAt,
        whatsappText,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao gerar convite.";
      res.status(400).json({ message });
    }
  });
  app.delete("/api/family/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const memberId = Number(req.params.id);
    const member = await storage.getFamilyMember(orgId, memberId);
    if (member) {
      await logAudit(req, {
        action: "family.deleted",
        entityType: "family_member",
        entityId: member.id,
        organizationId: orgId,
        message: `Familiar ${member.name} removido.`,
        metadata: { residentId: member.residentId },
      });
    }
    await storage.deleteFamilyMember(orgId, memberId);
    res.status(204).send();
  });

  // ===== PATIENT DOCUMENTS =====
  const patientDocumentInputSchema = z.object({
    title: z.string().trim().min(2, "Titulo obrigatorio.").max(160),
    subtitle: z.string().trim().max(240).optional().nullable(),
    category: z.string().trim().max(60).optional().nullable(),
    fileName: z.string().trim().min(1, "Arquivo obrigatorio.").max(255),
    fileType: z.string().trim().max(120).optional().nullable(),
    fileSize: z.coerce.number().int().min(1).max(15 * 1024 * 1024, "Arquivo maior que 15MB.").optional().nullable(),
    fileData: z.string().max(22_000_000, "Arquivo maior que 15MB.").refine((value) => value.startsWith("data:"), "Arquivo inválido."),
  });

  app.get("/api/residents/:residentId/documents", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const residentId = Number(req.params.residentId);
    const resident = await storage.getResident(orgId, residentId);
    if (!resident) return res.status(404).json({ message: "Paciente não encontrado." });
    res.json(await storage.getPatientDocuments(orgId, residentId));
  });

  app.post("/api/residents/:residentId/documents", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const residentId = Number(req.params.residentId);
      const resident = await storage.getResident(orgId, residentId);
      if (!resident) return res.status(404).json({ message: "Paciente não encontrado." });

      const input = patientDocumentInputSchema.parse(req.body);
      const document = await storage.createPatientDocument({
        organizationId: orgId,
        residentId,
        title: input.title,
        subtitle: input.subtitle?.trim() || null,
        category: input.category?.trim() || "document",
        fileName: input.fileName,
        fileType: input.fileType?.trim() || null,
        fileSize: input.fileSize ?? null,
        fileData: input.fileData,
        createdByUserId: req.session.user?.id ?? null,
      });
      res.status(201).json(document);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Documento inválido." });
      }
      res.status(400).json({
        message: error instanceof Error ? error.message : "Erro ao salvar documento.",
      });
    }
  });

  app.delete("/api/patient-documents/:id", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deletePatientDocument(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== COMORBIDITIES =====
  app.get("/api/residents/:residentId/comorbidities", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getComorbidities(orgId, Number(req.params.residentId)));
  });
  app.post("/api/residents/:residentId/comorbidities", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createComorbidity({ ...req.body, organizationId: orgId, residentId: Number(req.params.residentId) }));
  });
  app.put("/api/comorbidities/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateComorbidity(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/comorbidities/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteComorbidity(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== MEDICAL RECORDS / PRONTUÁRIO =====
  app.get("/api/residents/:residentId/medical-records", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getMedicalRecords(orgId, Number(req.params.residentId), req.query.type as string | undefined));
  });
  app.post("/api/residents/:residentId/medical-records", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const authorId = req.session.user?.id;
    const rawStaffId = req.body?.staffId;
    const staffId = rawStaffId === undefined || rawStaffId === null || rawStaffId === ""
      ? null
      : Number(rawStaffId);
    if (staffId !== null && (!Number.isInteger(staffId) || staffId <= 0)) {
      return res.status(400).json({ message: "Profissional inválido." });
    }
    if (staffId !== null) {
      const staffMember = await storage.getStaffMember(orgId, staffId);
      if (!staffMember) return res.status(400).json({ message: "Profissional inválido." });
    }
    res.status(201).json(await storage.createMedicalRecord({
      ...req.body,
      staffId,
      organizationId: orgId,
      residentId: Number(req.params.residentId),
      authorId,
    }));
  });
  app.put("/api/medical-records/:id", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateMedicalRecord(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/medical-records/:id", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteMedicalRecord(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== MEDICATIONS =====
  app.get("/api/medications", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getMedications(orgId, req.query.residentId ? Number(req.query.residentId) : undefined));
  });
  app.post("/api/medications", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const payload = buildMedicationPayload(req.body);
      res.status(201).json(await storage.createMedication({ ...payload, organizationId: orgId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dados de medicação inválidos.";
      res.status(400).json({ message });
    }
  });
  app.put("/api/medications/:id", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const payload = buildMedicationPayload(req.body);
      res.json(await storage.updateMedication(orgId, Number(req.params.id), payload));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dados de medicação inválidos.";
      res.status(400).json({ message });
    }
  });
  app.delete("/api/medications/:id", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteMedication(orgId, Number(req.params.id));
    res.status(204).send();
  });

  const MEDICATION_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0][1-9]|[12]\d|3[01])$/;
  const MEDICATION_TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const HOUR_IN_MS = 60 * 60 * 1000;
  const MINUTE_IN_MS = 60 * 1000;

  const toDateOnly = (value: Date): string => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const parseDateOnly = (value: string, endOfDay = false): Date | null => {
    if (!MEDICATION_DATE_REGEX.test(value)) return null;
    const [yearStr, monthStr, dayStr] = value.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    if (endOfDay) return new Date(year, month, day, 23, 59, 59, 999);
    return new Date(year, month, day, 0, 0, 0, 0);
  };

  type ParsedMedicationTime = { hour: number; minute: number; label: string };
  const parseMedicationScheduleTimes = (scheduleTime: string | null | undefined): ParsedMedicationTime[] => {
    const parsedTimes: ParsedMedicationTime[] = [];
    if (scheduleTime && scheduleTime.trim().length > 0) {
      const tokens = scheduleTime
        .split(/[\n,;|]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      for (const token of tokens) {
        const match = token.match(MEDICATION_TIME_REGEX);
        if (!match) continue;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        parsedTimes.push({
          hour,
          minute,
          label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        });
      }
    }

    if (parsedTimes.length > 0) {
      const dedupMap = new Map<string, ParsedMedicationTime>();
      parsedTimes.forEach((item) => dedupMap.set(item.label, item));
      return Array.from(dedupMap.values()).sort((a, b) => {
        const left = a.hour * 60 + a.minute;
        const right = b.hour * 60 + b.minute;
        return left - right;
      });
    }
    return [];
  };

  const normalizeMedicationScheduleTime = (scheduleTime: unknown): string | null => {
    const raw = typeof scheduleTime === "string" ? scheduleTime : "";
    const parsed = parseMedicationScheduleTimes(raw);
    if (parsed.length === 0) return null;
    return parsed.map((item) => item.label).join(", ");
  };

  const parseMedicationIntervalHours = (frequency: string | null | undefined): number | null => {
    const normalizedFrequency = (frequency ?? "").trim().toLowerCase();
    if (!normalizedFrequency) return null;
    if (normalizedFrequency.includes("sob demanda")) return null;
    if (normalizedFrequency.includes("semanal")) return 24 * 7;

    // Legacy support: "12h/12h", "8h/8h" and variants.
    const legacyEveryHourMatch = normalizedFrequency.match(/^(\d{1,2})\s*h\s*\/\s*\d{1,2}\s*h$/);
    if (legacyEveryHourMatch) {
      const legacyHours = Number(legacyEveryHourMatch[1]);
      if (legacyHours >= 1 && legacyHours <= 24) return legacyHours;
    }

    const everyHourMatch = normalizedFrequency.match(/(?:a cada\s*)?(\d{1,2})\s*h/);
    if (everyHourMatch) {
      const everyHours = Number(everyHourMatch[1]);
      if (everyHours >= 1 && everyHours <= 24) return everyHours;
    }

    const timesPerDayMatch = normalizedFrequency.match(/(\d{1,2})\s*x\s*ao\s*dia/);
    if (timesPerDayMatch) {
      const timesPerDay = Number(timesPerDayMatch[1]);
      if (timesPerDay >= 1 && timesPerDay <= 24 && 24 % timesPerDay === 0) {
        return 24 / timesPerDay;
      }
    }

    return null;
  };

  const isOnDemandFrequency = (frequency: string | null | undefined): boolean => {
    const normalizedFrequency = (frequency ?? "").trim().toLowerCase();
    return normalizedFrequency.includes("sob demanda");
  };

  const buildMedicationPayload = (body: any) => {
    const residentId = Number(body?.residentId);
    if (!Number.isInteger(residentId) || residentId <= 0) {
      throw new Error("Paciente inválido.");
    }

    const name = String(body?.name ?? "").trim();
    if (name.length < 2) throw new Error("Medicamento obrigatorio.");

    const dosage = String(body?.dosage ?? "").trim();
    if (dosage.length === 0) throw new Error("Dose obrigatoria.");

    const frequency = String(body?.frequency ?? "").trim();
    if (frequency.length === 0) throw new Error("Frequencia obrigatoria.");

    const normalizedScheduleTime = normalizeMedicationScheduleTime(body?.scheduleTime);
    const intervalHours = parseMedicationIntervalHours(frequency);
    const scheduleTime =
      normalizedScheduleTime ??
      (intervalHours !== null && !isOnDemandFrequency(frequency) ? "08:00" : null);

    const startDateRaw = typeof body?.startDate === "string" ? body.startDate.trim() : "";
    const endDateRaw = typeof body?.endDate === "string" ? body.endDate.trim() : "";

    const startDate = startDateRaw.length > 0 ? startDateRaw : null;
    const endDate = endDateRaw.length > 0 ? endDateRaw : null;

    if (startDate && !MEDICATION_DATE_REGEX.test(startDate)) {
      throw new Error("Data de início inválida. Use yyyy-mm-dd.");
    }
    if (endDate && !MEDICATION_DATE_REGEX.test(endDate)) {
      throw new Error("Data de fim inválida. Use yyyy-mm-dd.");
    }

    if (startDate && endDate) {
      const start = parseDateOnly(startDate);
      const end = parseDateOnly(endDate, true);
      if (!start || !end || end.getTime() < start.getTime()) {
        throw new Error("Data de fim deve ser maior ou igual a data de início.");
      }
    }

    return {
      residentId,
      name,
      dosage,
      frequency,
      status: body?.status === "suspended" ? "suspended" : "active",
      route: typeof body?.route === "string" && body.route.trim().length > 0 ? body.route.trim() : null,
      scheduleTime,
      prescribedBy:
        typeof body?.prescribedBy === "string" && body.prescribedBy.trim().length > 0
          ? body.prescribedBy.trim()
          : null,
      notes: typeof body?.notes === "string" && body.notes.trim().length > 0 ? body.notes.trim() : null,
      startDate,
      endDate,
    };
  };

  const buildMedicationDoseKey = (medicationId: number, scheduledFor: Date): string => {
    const minuteBucket = Math.round(scheduledFor.getTime() / MINUTE_IN_MS);
    return `${medicationId}:${minuteBucket}`;
  };
  const medicationDoseAttentionView = (status: "given" | "skipped" | "refused" | "late") => {
    if (status === "refused") {
      return { title: "Dose recusada", label: "recusada", severity: "error" };
    }
    if (status === "skipped") {
      return { title: "Dose não administrada", label: "não administrada", severity: "warning" };
    }
    if (status === "late") {
      return { title: "Dose administrada com atraso", label: "marcada como atrasada", severity: "warning" };
    }
    return null;
  };
  const notifyMedicationDoseAttention = async (input: {
    orgId: number;
    medication: Medication & { residentName?: string | null };
    scheduledFor: Date | null;
    status: "given" | "skipped" | "refused" | "late";
    notes?: string | null;
  }) => {
    const view = medicationDoseAttentionView(input.status);
    if (!view) return;
    const scheduledLabel = input.scheduledFor
      ? ` prevista para ${formatAppNotificationDateTime(input.scheduledFor)}`
      : "";
    const residentLabel = input.medication.residentName || "Paciente";
    await notifyMedicationRoles(input.orgId, {
      staffId: null,
      type: NOTIFICATION_TYPES.medicationDoseAttention,
      severity: view.severity,
      title: view.title,
      message: `${residentLabel}: ${input.medication.name} ${input.medication.dosage}${scheduledLabel} foi ${view.label}.${input.notes ? ` Obs: ${input.notes}` : ""}`,
      actionUrl: buildMedicationActionUrl({
        residentId: input.medication.residentId,
        medicationId: input.medication.id,
        scheduledFor: input.scheduledFor,
        medicationTab: input.scheduledFor ? "agenda" : "historico",
      }),
      entityType: "medication_dose",
      entityId: input.medication.id,
      dedupeKey: input.scheduledFor
        ? `medication-dose:${input.medication.id}:${buildMedicationDoseKey(input.medication.id, input.scheduledFor)}:${input.status}`
        : `medication-dose:${input.medication.id}:manual:${input.status}:${Date.now()}`,
      metadata: {
        medicationId: input.medication.id,
        residentId: input.medication.residentId,
        scheduledFor: input.scheduledFor?.toISOString() ?? null,
        status: input.status,
      },
    });
  };

  app.get("/api/residents/:residentId/medication-dose-schedule", requireAuth, async (req, res, next) => {
    try {
      const residentId = Number(req.params.residentId);
      if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({ message: "Paciente inválido." });
      }

      const orgId = getOrgId(req);
      const resident = await storage.getResident(orgId, residentId);
      if (!resident) {
        return res.status(404).json({ message: "Paciente não encontrado." });
      }

      const fromParam = typeof req.query.from === "string" ? req.query.from.trim() : "";
      const toParam = typeof req.query.to === "string" ? req.query.to.trim() : "";
      if (fromParam && !MEDICATION_DATE_REGEX.test(fromParam)) {
        return res.status(400).json({ message: "Parametro 'from' inválido. Use yyyy-mm-dd." });
      }
      if (toParam && !MEDICATION_DATE_REGEX.test(toParam)) {
        return res.status(400).json({ message: "Parametro 'to' inválido. Use yyyy-mm-dd." });
      }

      const today = new Date();
      const defaultFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const defaultTo = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6, 23, 59, 59, 999);
      const fromDate = fromParam ? parseDateOnly(fromParam) : defaultFrom;
      const toDate = toParam ? parseDateOnly(toParam, true) : defaultTo;

      if (!fromDate || !toDate) {
        return res.status(400).json({ message: "Periodo inválido." });
      }
      if (toDate.getTime() < fromDate.getTime()) {
        return res.status(400).json({ message: "Data final deve ser maior ou igual a data inicial." });
      }

      const includeSuspended = String(req.query.includeSuspended ?? "").toLowerCase() === "true";
      const allMedications = await storage.getMedications(orgId, residentId);
      const medicationsForAgenda = allMedications.filter(
        (item) => includeSuspended || item.status === "active",
      );
      const administrations = await storage.getMedicationAdministrations(orgId, residentId);

      const administrationByDoseKey = new Map<string, (typeof administrations)[number]>();
      administrations.forEach((admin) => {
        if (!admin.scheduledFor) return;
        const scheduledForDate = new Date(admin.scheduledFor);
        if (Number.isNaN(scheduledForDate.getTime())) return;
        const key = buildMedicationDoseKey(admin.medicationId, scheduledForDate);
        const current = administrationByDoseKey.get(key);
        const currentAdminAt = current?.administeredAt
          ? new Date(current.administeredAt).getTime()
          : 0;
        const nextAdminAt = admin.administeredAt
          ? new Date(admin.administeredAt).getTime()
          : 0;
        if (!current || nextAdminAt >= currentAdminAt) {
          administrationByDoseKey.set(key, admin);
        }
      });

      const doses: Array<{
        key: string;
        medicationId: number;
        medicationName: string;
        dosage: string;
        frequency: string;
        route: string | null;
        scheduledFor: string;
        scheduledDate: string;
        scheduledTime: string;
        status: "pending" | "given" | "skipped" | "refused" | "late";
        isOverdue: boolean;
        notes: string | null;
        administeredAt: string | null;
        administeredByName: string | null;
        administeredByStaffId: number | null;
      }> = [];

      const nowTimestamp = Date.now();
      for (const medication of medicationsForAgenda) {
        if (isOnDemandFrequency(medication.frequency)) continue;

        const medicationStart = medication.startDate
          ? parseDateOnly(String(medication.startDate))
          : null;
        const medicationEnd = medication.endDate
          ? parseDateOnly(String(medication.endDate), true)
          : null;

        const effectiveStart = new Date(Math.max(
          fromDate.getTime(),
          medicationStart ? medicationStart.getTime() : fromDate.getTime(),
        ));
        const effectiveEnd = new Date(Math.min(
          toDate.getTime(),
          medicationEnd ? medicationEnd.getTime() : toDate.getTime(),
        ));
        if (effectiveStart.getTime() > effectiveEnd.getTime()) continue;

        const scheduleTimes = parseMedicationScheduleTimes(medication.scheduleTime);
        const intervalHours = parseMedicationIntervalHours(medication.frequency);

        if (intervalHours !== null && scheduleTimes.length <= 1) {
          const baseScheduleTime = scheduleTimes[0] ?? { hour: 8, minute: 0, label: "08:00" };
          const stepInMs = intervalHours * HOUR_IN_MS;
          const anchorDate = medicationStart ?? effectiveStart;
          let occurrenceCursor = new Date(
            anchorDate.getFullYear(),
            anchorDate.getMonth(),
            anchorDate.getDate(),
            baseScheduleTime.hour,
            baseScheduleTime.minute,
            0,
            0,
          );

          if (occurrenceCursor.getTime() < effectiveStart.getTime()) {
            const diffInMs = effectiveStart.getTime() - occurrenceCursor.getTime();
            const stepsToAdvance = Math.ceil(diffInMs / stepInMs);
            occurrenceCursor = new Date(occurrenceCursor.getTime() + stepsToAdvance * stepInMs);
          }

          while (occurrenceCursor.getTime() <= effectiveEnd.getTime()) {
            const doseKey = buildMedicationDoseKey(medication.id, occurrenceCursor);
            const administration = administrationByDoseKey.get(doseKey);
            const baseStatus = administration?.status;
            const normalizedStatus =
              baseStatus === "given" || baseStatus === "skipped" || baseStatus === "refused" || baseStatus === "late"
                ? baseStatus
                : "pending";

            const timeLabel = `${String(occurrenceCursor.getHours()).padStart(2, "0")}:${String(
              occurrenceCursor.getMinutes(),
            ).padStart(2, "0")}`;

            doses.push({
              key: doseKey,
              medicationId: medication.id,
              medicationName: medication.name,
              dosage: medication.dosage,
              frequency: medication.frequency,
              route: medication.route ?? null,
              scheduledFor: occurrenceCursor.toISOString(),
              scheduledDate: toDateOnly(occurrenceCursor),
              scheduledTime: timeLabel,
              status: normalizedStatus,
              isOverdue: normalizedStatus === "pending" && occurrenceCursor.getTime() < nowTimestamp,
              notes: administration?.notes ?? null,
              administeredAt: administration?.administeredAt
                ? new Date(administration.administeredAt).toISOString()
                : null,
              administeredByName: administration?.administeredByName ?? null,
              administeredByStaffId: administration?.staffId ?? null,
            });

            occurrenceCursor = new Date(occurrenceCursor.getTime() + stepInMs);
          }
          continue;
        }

        const explicitTimes = scheduleTimes.length > 0 ? scheduleTimes : [{ hour: 8, minute: 0, label: "08:00" }];
        const dayCursor = new Date(
          effectiveStart.getFullYear(),
          effectiveStart.getMonth(),
          effectiveStart.getDate(),
          0,
          0,
          0,
          0,
        );
        const endCursor = new Date(
          effectiveEnd.getFullYear(),
          effectiveEnd.getMonth(),
          effectiveEnd.getDate(),
          0,
          0,
          0,
          0,
        );

        while (dayCursor.getTime() <= endCursor.getTime()) {
          for (const scheduledTime of explicitTimes) {
            const scheduledForDate = new Date(
              dayCursor.getFullYear(),
              dayCursor.getMonth(),
              dayCursor.getDate(),
              scheduledTime.hour,
              scheduledTime.minute,
              0,
              0,
            );
            if (scheduledForDate.getTime() < effectiveStart.getTime()) continue;
            if (scheduledForDate.getTime() > effectiveEnd.getTime()) continue;

            const doseKey = buildMedicationDoseKey(medication.id, scheduledForDate);
            const administration = administrationByDoseKey.get(doseKey);
            const baseStatus = administration?.status;
            const normalizedStatus =
              baseStatus === "given" || baseStatus === "skipped" || baseStatus === "refused" || baseStatus === "late"
                ? baseStatus
                : "pending";

            doses.push({
              key: doseKey,
              medicationId: medication.id,
              medicationName: medication.name,
              dosage: medication.dosage,
              frequency: medication.frequency,
              route: medication.route ?? null,
              scheduledFor: scheduledForDate.toISOString(),
              scheduledDate: toDateOnly(scheduledForDate),
              scheduledTime: scheduledTime.label,
              status: normalizedStatus,
              isOverdue: normalizedStatus === "pending" && scheduledForDate.getTime() < nowTimestamp,
              notes: administration?.notes ?? null,
              administeredAt: administration?.administeredAt
                ? new Date(administration.administeredAt).toISOString()
                : null,
              administeredByName: administration?.administeredByName ?? null,
              administeredByStaffId: administration?.staffId ?? null,
            });
          }

          dayCursor.setDate(dayCursor.getDate() + 1);
        }
      }

      doses.sort((left, right) => {
        const scheduledDiff =
          new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime();
        if (scheduledDiff !== 0) return scheduledDiff;
        return left.medicationName.localeCompare(right.medicationName, "pt-BR");
      });

      return res.json({
        residentId,
        from: toDateOnly(fromDate),
        to: toDateOnly(toDate),
        generatedAt: new Date().toISOString(),
        doses,
      });
    } catch (error) {
      next(error);
    }
  });

  // ===== MEDICATION ADMINISTRATIONS =====
  const medicationAdministrationInputSchema = z.object({
    medicationId: z.coerce.number().int().positive("Medicamento inválido."),
    staffId: z.coerce.number().int().positive().optional().nullable(),
    status: z.enum(["given", "skipped", "refused", "late"]).default("given"),
    notes: z.string().optional().nullable(),
    scheduledFor: z.coerce.date().optional().nullable(),
    administeredAt: z.coerce.date().optional().nullable(),
  });
  const medicationDoseRecordInputSchema = z.object({
    medicationId: z.coerce.number().int().positive("Medicamento inválido."),
    scheduledFor: z.coerce.date(),
    staffId: z.coerce.number().int().positive().optional().nullable(),
    status: z.enum(["given", "skipped", "refused", "late"]).default("given"),
    notes: z.string().optional().nullable(),
    administeredAt: z.coerce.date().optional().nullable(),
  });

  app.get("/api/medication-administrations", requireAuth, async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      res.json(await storage.getMedicationAdministrations(
        orgId,
        req.query.residentId ? Number(req.query.residentId) : undefined,
        req.query.medicationId ? Number(req.query.medicationId) : undefined,
      ));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/medication-administrations", requireAuth, async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const sessionUser = req.session.user;
      if (!sessionUser) {
        return res.status(401).json({ message: "Não autorizado." });
      }

      const input = medicationAdministrationInputSchema.parse(req.body);
      const meds = await storage.getMedications(orgId);
      const medication = meds.find((item) => item.id === input.medicationId);
      if (!medication) {
        return res.status(404).json({ message: "Medicamento não encontrado." });
      }

      const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, sessionUser);
      let effectiveStaffId = await enforceCaregiverOwnStaffId(orgId, sessionUser, input.staffId);

      if (sessionUser.role !== "cuidador") {
        if (effectiveStaffId) {
          const selectedStaff = await storage.getStaffMember(orgId, effectiveStaffId);
          if (!selectedStaff || selectedStaff.active === false) {
            return res.status(400).json({ message: "Profissional selecionado não está disponível." });
          }
        } else if (linkedStaff && linkedStaff.active !== false) {
          effectiveStaffId = linkedStaff.id;
        }
      }

      if (!effectiveStaffId) {
        return res.status(400).json({ message: "Selecione quem administrou a medicação." });
      }

      const created = await storage.createMedicationAdministration({
        organizationId: orgId,
        medicationId: medication.id,
        residentId: medication.residentId,
        staffId: effectiveStaffId,
        scheduledFor: input.scheduledFor ?? null,
        administeredAt: input.administeredAt ?? new Date(),
        status: input.status,
        notes: input.notes?.trim() || null,
      });
      await notifyMedicationDoseAttention({
        orgId,
        medication,
        scheduledFor: input.scheduledFor ?? null,
        status: input.status,
        notes: input.notes?.trim() || null,
      });

      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  app.post("/api/residents/:residentId/medication-dose-records", requireAuth, async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const residentId = Number(req.params.residentId);
      if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({ message: "Paciente inválido." });
      }

      const sessionUser = req.session.user;
      if (!sessionUser) {
        return res.status(401).json({ message: "Não autorizado." });
      }

      const input = medicationDoseRecordInputSchema.parse(req.body);
      const medications = await storage.getMedications(orgId, residentId);
      const medication = medications.find((item) => item.id === input.medicationId);
      if (!medication) {
        return res.status(404).json({ message: "Medicamento não encontrado para este paciente." });
      }

      const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, sessionUser);
      let effectiveStaffId = await enforceCaregiverOwnStaffId(orgId, sessionUser, input.staffId);

      if (sessionUser.role !== "cuidador") {
        if (effectiveStaffId) {
          const selectedStaff = await storage.getStaffMember(orgId, effectiveStaffId);
          if (!selectedStaff || selectedStaff.active === false) {
            return res.status(400).json({ message: "Profissional selecionado não está disponível." });
          }
        } else if (linkedStaff && linkedStaff.active !== false) {
          effectiveStaffId = linkedStaff.id;
        }
      }
      if (!effectiveStaffId) {
        return res.status(400).json({ message: "Selecione quem administrou a medicação." });
      }

      const saved = await storage.upsertMedicationAdministrationForDose({
        organizationId: orgId,
        medicationId: medication.id,
        residentId,
        staffId: effectiveStaffId,
        scheduledFor: input.scheduledFor,
        administeredAt: input.administeredAt ?? new Date(),
        status: input.status,
        notes: input.notes?.trim() || null,
      });
      await notifyMedicationDoseAttention({
        orgId,
        medication,
        scheduledFor: input.scheduledFor,
        status: input.status,
        notes: input.notes?.trim() || null,
      });

      return res.status(200).json(saved);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  // ===== STAFF =====
  const resolveLinkedPortalUserForStaff = async (
    orgId: number,
    currentStaff?: { portalUserId?: number | null; portalUsername?: string | null },
  ) => {
    if (currentStaff?.portalUserId) {
      const linkedById = await storage.getUserById(currentStaff.portalUserId);
      if (linkedById && linkedById.organizationId === orgId) {
        return linkedById;
      }
    }
    const normalizedPortalUsername = normalizePortalUsername(currentStaff?.portalUsername ?? "");
    if (!normalizedPortalUsername) return undefined;
    return await storage.getUserByUsernameAndOrganization(normalizedPortalUsername, orgId);
  };

  const syncPortalUserForStaff = async (input: {
    orgId: number;
    currentStaff?: { portalUserId?: number | null; portalUsername?: string | null };
    portalAccess: boolean;
    portalUsername: string;
    portalPassword: string;
    staffName: string;
    staffRole: string;
    staffActive: boolean;
  }) => {
    const linkedUser = await resolveLinkedPortalUserForStaff(input.orgId, input.currentStaff);

    if (!input.portalAccess) {
      if (linkedUser && linkedUser.active !== false) {
        await storage.updateUser(linkedUser.id, { active: false });
      }
      return {
        portalAccess: false,
        portalUsername: null,
        portalUserId: null,
      };
    }

    if (!input.portalUsername || input.portalUsername.length < 3) {
      throw new Error("Informe um usuário de acesso com pelo menos 3 caracteres.");
    }

    const usernameOwner = await storage.getUserByUsernameAndOrganization(input.portalUsername, input.orgId);
    if (usernameOwner && (!linkedUser || usernameOwner.id !== linkedUser.id)) {
      throw new Error("Usuário de acesso já existe na organização.");
    }

    if (linkedUser) {
      const userUpdates: Record<string, unknown> = {
        username: input.portalUsername,
        name: input.staffName,
        role: input.staffRole,
        active: input.staffActive,
      };
      if (input.portalPassword) {
        userUpdates.password = input.portalPassword;
      }
      await storage.updateUser(linkedUser.id, userUpdates);
      return {
        portalAccess: true,
        portalUsername: input.portalUsername,
        portalUserId: linkedUser.id,
      };
    }

    if (!input.portalPassword) {
      throw new Error("Informe a senha para criar o acesso ao portal.");
    }

    const createdUser = await storage.createUser({
      organizationId: input.orgId,
      username: input.portalUsername,
      password: input.portalPassword,
      name: input.staffName,
      role: input.staffRole,
      active: input.staffActive,
      isSuperAdmin: false,
    });

    return {
      portalAccess: true,
      portalUsername: input.portalUsername,
      portalUserId: createdUser.id,
    };
  };

  // Leitura: admin + enfermeiro (para ver a equipe nas escalas)
  app.get("/api/staff", requireAuth, requireRole(...STAFF_MGMT_ROLES, "enfermeiro", "tecnico_enfermagem", "medico", "recepcionista", "administrativo", "cuidador"), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      res.json(await storage.getStaff(orgId));
    } catch (error) {
      next(error);
    }
  });
  // Escrita: somente admin
  app.post("/api/staff", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const payload = { ...req.body } as Record<string, unknown>;
      const environmentSettings =
        (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const shiftProfile = normalizeStaffShiftProfile(payload.shift);
      assertShiftProfileAllowedForSettings(environmentSettings, shiftProfile);
      payload.shift = shiftProfile;
      const roleValue = normalizeStaffRoleValue(payload.role);
      if (!roleValue) {
        return res.status(400).json({ message: "Cargo inválido para o colaborador." });
      }
      if (!getAllowedRolesForSettings(environmentSettings).includes(roleValue)) {
        return res.status(400).json({ message: "Cargo inválido para esta organização." });
      }
      payload.role = roleValue;

      const staffName = typeof payload.name === "string" ? payload.name.trim() : "";
      if (!staffName) {
        return res.status(400).json({ message: "Nome do colaborador obrigatorio." });
      }
      payload.name = staffName;

      const portalAccess = payload.portalAccess === true;
      const portalUsername = typeof payload.portalUsername === "string"
        ? normalizePortalUsername(payload.portalUsername)
        : "";
      const portalPassword = typeof payload.portalPassword === "string"
        ? payload.portalPassword.trim()
        : "";
      delete payload.portalPassword;

      let createdStaff = await storage.createStaff({
        ...payload,
        organizationId: orgId,
        portalAccess,
        portalUsername: portalAccess ? portalUsername : null,
        portalUserId: null,
      } as any);

      try {
        const portalLink = await syncPortalUserForStaff({
          orgId,
          currentStaff: createdStaff,
          portalAccess,
          portalUsername,
          portalPassword,
          staffName: staffName,
          staffRole: roleValue,
          staffActive: createdStaff.active !== false,
        });

        createdStaff = await storage.updateStaff(orgId, createdStaff.id, portalLink);
      } catch (error) {
        await storage.deleteStaff(orgId, createdStaff.id);
        throw error;
      }

      res.status(201).json(createdStaff);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  app.put("/api/staff/:id", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const payload = { ...req.body } as Record<string, unknown>;
      const currentStaff = await storage.getStaffMember(orgId, Number(req.params.id));
      if (!currentStaff) {
        return res.status(404).json({ message: "Colaborador não encontrado." });
      }
      const environmentSettings =
        (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      if (payload.shift !== undefined) {
        const shiftProfile = normalizeStaffShiftProfile(payload.shift);
        assertShiftProfileAllowedForSettings(environmentSettings, shiftProfile);
        payload.shift = shiftProfile;
      }

      const requestedRole = normalizeStaffRoleValue(payload.role);
      const nextRole = requestedRole || normalizeStaffRoleValue(currentStaff.role);
      if (!getAllowedRolesForSettings(environmentSettings).includes(nextRole)) {
        return res.status(400).json({ message: "Cargo inválido para esta organização." });
      }
      payload.role = nextRole;

      const nextName = typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : currentStaff.name;
      payload.name = nextName;

      const portalAccess = payload.portalAccess !== undefined
        ? payload.portalAccess === true
        : Boolean(currentStaff.portalAccess);
      const portalUsernameSource = payload.portalUsername !== undefined
        ? payload.portalUsername
        : currentStaff.portalUsername;
      const portalUsername = typeof portalUsernameSource === "string"
        ? normalizePortalUsername(portalUsernameSource)
        : "";
      const portalPassword = typeof payload.portalPassword === "string"
        ? payload.portalPassword.trim()
        : "";
      delete payload.portalPassword;

      const nextActive = typeof payload.active === "boolean"
        ? payload.active
        : currentStaff.active !== false;
      const portalLink = await syncPortalUserForStaff({
        orgId,
        currentStaff,
        portalAccess,
        portalUsername,
        portalPassword,
        staffName: nextName,
        staffRole: nextRole,
        staffActive: nextActive,
      });

      const updates = {
        ...payload,
        ...portalLink,
      };
      res.json(await storage.updateStaff(orgId, Number(req.params.id), updates));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  app.delete("/api/staff/:id", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      await storage.deleteStaff(orgId, Number(req.params.id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // ===== OCCURRENCES =====
  app.get("/api/occurrences", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getOccurrences(orgId, req.query.residentId ? Number(req.query.residentId) : undefined));
  });
  app.post("/api/occurrences", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const authorId = req.session.user?.id;
    res.status(201).json(await storage.createOccurrence({ ...req.body, organizationId: orgId, authorId }));
  });
  app.put("/api/occurrences/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const body = { ...req.body };
    if (body.resolvedAt && typeof body.resolvedAt === "string") {
      body.resolvedAt = new Date(body.resolvedAt);
    }
    res.json(await storage.updateOccurrence(orgId, Number(req.params.id), body));
  });
  app.delete("/api/occurrences/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const deleted = await storage.deleteOccurrence(orgId, Number(req.params.id));
    if (!deleted) {
      return res.status(404).json({ message: "Ocorrência não encontrada." });
    }
    res.status(204).send();
  });

  const LOCAL_DATE_TIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
  const parseLocalDateTimeInput = (value: unknown): Date => {
    if (value instanceof Date) return new Date(value);
    if (typeof value === "string") {
      const trimmed = value.trim();
      const match = trimmed.match(LOCAL_DATE_TIME_REGEX);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hour = Number(match[4]);
        const minute = Number(match[5]);
        const second = Number(match[6] ?? 0);
        const parsed = new Date(year, month - 1, day, hour, minute, second, 0);
        const isSameLocalDateTime =
          parsed.getFullYear() === year
          && parsed.getMonth() === month - 1
          && parsed.getDate() === day
          && parsed.getHours() === hour
          && parsed.getMinutes() === minute
          && parsed.getSeconds() === second;
        return isSameLocalDateTime ? parsed : new Date(NaN);
      }
      return new Date(trimmed);
    }
    return new Date(value as any);
  };
  const formatLocalDateTimeForJson = (value: string | Date): string => {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  };
  const serializeShiftAssignment = <T extends { startTime: string | Date; endTime: string | Date }>(shift: T) => ({
    ...shift,
    startTime: formatLocalDateTimeForJson(shift.startTime),
    endTime: formatLocalDateTimeForJson(shift.endTime),
  });

  // ===== SHIFT ASSIGNMENTS =====
  const shiftInputSchema = z.object({
    staffId: z.number(),
    residentId: z.number().optional().nullable(),
    shiftType: z.enum(["12h_manha", "12h_noite", "24h", "avulso"]).default("avulso"),
    startTime: z.preprocess(parseLocalDateTimeInput, z.date()),
    endTime: z.preprocess(parseLocalDateTimeInput, z.date()),
    notes: z.string().optional().nullable(),
    payableAmount: z.coerce.number().min(0).optional().nullable(),
    promoteToStaffDefault: z.boolean().optional(),
  });
  const shiftPayableInputSchema = z.object({
    payableAmount: z.coerce.number().min(0).optional().nullable(),
    promoteToStaffDefault: z.boolean().optional(),
  });
  const generateMonthInputSchema = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido. Use YYYY-MM."),
    staffId: z.number().optional(),
    clearGenerated: z.boolean().optional().default(false),
  });
  class ShiftValidationError extends Error {}

  type WeekdayKey =
    | "sunday"
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday";

  type WorkScheduleSlot = { start: string; end: string };
  type WorkScheduleRule = { enabled?: boolean; slots?: WorkScheduleSlot[] };
  type ParsedWorkSchedule = {
    weekly: Record<WeekdayKey, WorkScheduleRule>;
    oddDays: WorkScheduleRule;
    evenDays: WorkScheduleRule;
    blockedDates: string[];
    profileCycleStart: "12h_manha" | "12h_noite" | null;
  };

  const AUTO_MONTH_NOTE_PREFIX = "[AUTO-MONTH:";
  const AUTO_MONTH_PAYABLE_NOTE_PREFIX = "[AUTO-MONTH-PAYABLE:";
  const MANUAL_SHIFT_PAYABLE_NOTE_PREFIX = "[SHIFT-PAYABLE]";
  const MANUAL_PAYABLE_SHIFT_ID_REGEX = /\[SHIFT:(\d+)\]/;
  const AUTO_PAYABLE_NOTE_REGEX = /\[AUTO-MONTH-PAYABLE:(\d{4}-(0[1-9]|1[0-2]))\]\[STAFF:(\d+)\]/;
  const AUTO_PAYABLE_UNIT_REGEX = /(\d+)x([0-9]+(?:\.[0-9]+)?)/;
  const AUTO_PAYABLE_IDS_REGEX = /ids:([0-9,]+)/;
  const parseManualPayableShiftId = (notes: unknown): number | null => {
    if (typeof notes !== "string") return null;
    const match = notes.match(MANUAL_PAYABLE_SHIFT_ID_REGEX);
    if (!match) return null;
    const shiftId = Number(match[1]);
    if (!Number.isInteger(shiftId) || shiftId <= 0) return null;
    return shiftId;
  };
  const SHIFT_TYPE_LABELS: Record<ShiftAssignmentType, string> = {
    "12h_manha": "Diurno (12h)",
    "12h_noite": "Noturno (12h)",
    "24h": "24h",
    "avulso": "Avulso",
  };
  const WEEKDAY_KEYS: WeekdayKey[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const WEEKDAY_LABELS_PT: Record<WeekdayKey, string> = {
    sunday: "domingo",
    monday: "segunda",
    tuesday: "terca",
    wednesday: "quarta",
    thursday: "quinta",
    friday: "sexta",
    saturday: "sabado",
  };

  const createDefaultWorkSchedule = (): ParsedWorkSchedule => ({
    weekly: {
      sunday: { enabled: false, slots: [] },
      monday: { enabled: false, slots: [] },
      tuesday: { enabled: false, slots: [] },
      wednesday: { enabled: false, slots: [] },
      thursday: { enabled: false, slots: [] },
      friday: { enabled: false, slots: [] },
      saturday: { enabled: false, slots: [] },
    },
    oddDays: { enabled: false, slots: [] },
    evenDays: { enabled: false, slots: [] },
    blockedDates: [],
    profileCycleStart: null,
  });

  const DATE_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0][1-9]|[12]\d|3[01])$/;
  const toDateKey = (value: Date): string => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const normalizeWorkScheduleRule = (raw: unknown): WorkScheduleRule => {
    if (!raw || typeof raw !== "object") return { enabled: false, slots: [] };
    const candidate = raw as { enabled?: unknown; slots?: unknown };
    const slots = Array.isArray(candidate.slots)
      ? candidate.slots
          .map((slot) => {
            if (!slot || typeof slot !== "object") return null;
            const rawSlot = slot as { start?: unknown; end?: unknown };
            if (typeof rawSlot.start !== "string" || typeof rawSlot.end !== "string") return null;
            return { start: rawSlot.start, end: rawSlot.end };
          })
          .filter((slot): slot is WorkScheduleSlot => !!slot)
      : [];
    return {
      enabled: Boolean(candidate.enabled),
      slots,
    };
  };

  const parseStaffWorkSchedule = (value: unknown): ParsedWorkSchedule => {
    const defaultSchedule = createDefaultWorkSchedule();
    if (typeof value !== "string" || !value.trim()) return defaultSchedule;
    try {
      const raw = JSON.parse(value) as Record<string, unknown>;
      const weeklySource = raw.weekly && typeof raw.weekly === "object"
        ? (raw.weekly as Record<string, unknown>)
        : {};

      const weekly = WEEKDAY_KEYS.reduce<Record<WeekdayKey, WorkScheduleRule>>((acc, key) => {
        acc[key] = normalizeWorkScheduleRule(weeklySource[key]);
        return acc;
      }, {} as Record<WeekdayKey, WorkScheduleRule>);

      return {
        weekly,
        oddDays: normalizeWorkScheduleRule(raw.oddDays),
        evenDays: normalizeWorkScheduleRule(raw.evenDays),
        blockedDates: Array.isArray(raw.blockedDates)
          ? raw.blockedDates
              .filter((date): date is string => typeof date === "string" && DATE_KEY_REGEX.test(date))
              .filter((date, index, source) => source.indexOf(date) === index)
              .sort()
          : [],
        profileCycleStart:
          raw.profileCycleStart === "12h_manha" || raw.profileCycleStart === "12h_noite"
            ? raw.profileCycleStart
            : null,
      };
    } catch {
      return defaultSchedule;
    }
  };

  const normalizeClock = (value?: string): string | null => {
    if (!value) return null;
    const normalized = value.trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized)) return null;
    return normalized;
  };

  const buildDateWithClock = (baseDate: Date, clock: string): Date | null => {
    const normalized = normalizeClock(clock);
    if (!normalized) return null;
    const [hours, minutes] = normalized.split(":").map(Number);
    return new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      hours,
      minutes,
      0,
      0,
    );
  };
  type DailyScheduleWindow = { start: Date; end: Date; source: string };
  type DailyScheduleResolution = {
    hasRestrictions: boolean;
    blocked: boolean;
    windows: DailyScheduleWindow[];
    invalidSlots: number;
  };
  const isRuleConfigured = (rule: WorkScheduleRule | undefined): boolean =>
    Boolean(rule?.enabled && (rule.slots?.length ?? 0) > 0);
  const buildRuleWindowsForDate = (
    baseDate: Date,
    rule: WorkScheduleRule | undefined,
    source: string,
  ): { windows: DailyScheduleWindow[]; invalidSlots: number } => {
    if (!isRuleConfigured(rule)) return { windows: [], invalidSlots: 0 };
    const windows: DailyScheduleWindow[] = [];
    let invalidSlots = 0;

    for (const slot of rule?.slots ?? []) {
      const start = buildDateWithClock(baseDate, slot.start);
      const rawEnd = buildDateWithClock(baseDate, slot.end);
      if (!start || !rawEnd) {
        invalidSlots++;
        continue;
      }
      const end = new Date(rawEnd);
      if (end <= start) {
        end.setDate(end.getDate() + 1);
      }
      windows.push({ start, end, source });
    }

    return { windows, invalidSlots };
  };
  const intersectDailyWindows = (
    first: DailyScheduleWindow[],
    second: DailyScheduleWindow[],
  ): DailyScheduleWindow[] => {
    const intersections: DailyScheduleWindow[] = [];
    for (const left of first) {
      for (const right of second) {
        const start = new Date(Math.max(left.start.getTime(), right.start.getTime()));
        const end = new Date(Math.min(left.end.getTime(), right.end.getTime()));
        if (end > start) {
          intersections.push({
            start,
            end,
            source: `${left.source}+${right.source}`,
          });
        }
      }
    }
    return intersections;
  };
  const resolveDailySchedule = (schedule: ParsedWorkSchedule, baseDate: Date): DailyScheduleResolution => {
    const dayKey = toDateKey(baseDate);
    if (schedule.blockedDates.includes(dayKey)) {
      return {
        hasRestrictions: true,
        blocked: true,
        windows: [],
        invalidSlots: 0,
      };
    }

    const weekdayKey = WEEKDAY_KEYS[baseDate.getDay()];
    const hasWeeklyRestriction = WEEKDAY_KEYS.some((key) => isRuleConfigured(schedule.weekly[key]));
    const hasOddRestriction = isRuleConfigured(schedule.oddDays);
    const hasEvenRestriction = isRuleConfigured(schedule.evenDays);
    const hasParityRestriction = hasOddRestriction || hasEvenRestriction;

    const weeklyWindowsForDay = buildRuleWindowsForDate(
      baseDate,
      schedule.weekly[weekdayKey],
      WEEKDAY_LABELS_PT[weekdayKey],
    );
    const isOddDay = baseDate.getDate() % 2 === 1;
    const parityRule = isOddDay ? schedule.oddDays : schedule.evenDays;
    const parityWindowsForDay = buildRuleWindowsForDate(
      baseDate,
      parityRule,
      isOddDay ? "dias impares" : "dias pares",
    );

    let windows: DailyScheduleWindow[] = [];
    if (hasParityRestriction) {
      // Dias pares/impares têm prioridade e dispensam seleção de dia da semana.
      windows = parityWindowsForDay.windows;
    } else if (hasWeeklyRestriction) {
      windows = weeklyWindowsForDay.windows;
    }

    return {
      hasRestrictions: hasWeeklyRestriction || hasParityRestriction,
      blocked: false,
      windows,
      invalidSlots: weeklyWindowsForDay.invalidSlots + parityWindowsForDay.invalidSlots,
    };
  };
  const isShiftWithinWindows = (startTime: Date, endTime: Date, windows: DailyScheduleWindow[]) =>
    windows.some((window) => startTime >= window.start && endTime <= window.end);

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const formatHourMinute = (value: Date): string =>
    `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  const getManualShiftPayableKey = (shiftId: number): string =>
    `${MANUAL_SHIFT_PAYABLE_NOTE_PREFIX}[SHIFT:${shiftId}]`;
  const buildManualShiftPayableNote = (shift: {
    id: number;
    startTime: Date;
    endTime: Date;
    shiftType: string;
    notes?: string | null;
  }): string => {
    const shiftStart = new Date(shift.startTime);
    const shiftEnd = new Date(shift.endTime);
    const shiftTypeLabel =
      SHIFT_TYPE_LABELS[(shift.shiftType as ShiftAssignmentType) ?? "avulso"] ?? shift.shiftType;
    const detailLabel =
      `${toDateKey(shiftStart)} ${formatHourMinute(shiftStart)} - ${toDateKey(shiftEnd)} ${formatHourMinute(shiftEnd)}`;
    return `${getManualShiftPayableKey(shift.id)} ${detailLabel} ${shiftTypeLabel}${shift.notes ? ` | ${shift.notes}` : ""}`;
  };
  const buildManualShiftPayableBasePayload = async (
    orgId: number,
    shift: {
      id: number;
      staffId: number;
      startTime: Date;
      endTime: Date;
      shiftType: string;
      notes?: string | null;
    },
  ) => {
    const shiftStart = new Date(shift.startTime);
    const staffMember = await storage.getStaffMember(orgId, shift.staffId);
    const dueDate = toDateKey(shiftStart);
    const referenceMonth = `${shiftStart.getFullYear()}-${String(shiftStart.getMonth() + 1).padStart(2, "0")}`;
    return {
      staffId: shift.staffId,
      title: `Plantao ${dueDate} - ${staffMember?.name ?? "colaborador"}`,
      category: "staff" as const,
      referenceMonth,
      dueDate,
      notes: buildManualShiftPayableNote(shift),
    };
  };
  const listManualShiftPayablesByShiftId = async (orgId: number, shiftId: number) => {
    const shiftPayableKey = getManualShiftPayableKey(shiftId);
    const payables = await storage.getAccountsPayable(orgId);
    return payables
      .filter((item) => typeof item.notes === "string" && item.notes.includes(shiftPayableKey))
      .sort((left, right) => left.id - right.id);
  };
  const buildShiftPayableLinkResponse = async (
    orgId: number,
    shift: { id: number },
  ) => {
    const linkedPayables = await listManualShiftPayablesByShiftId(orgId, shift.id);
    const linkedPayable = linkedPayables[0];
    return {
      shiftId: shift.id,
      linked: Boolean(linkedPayable),
      payableId: linkedPayable?.id ?? null,
      amount: linkedPayable ? Number(linkedPayable.amount ?? 0) : null,
      status: linkedPayable?.status ?? null,
      title: linkedPayable?.title ?? null,
    };
  };
  const maybeApplyShiftValueAsStaffDefault = async (input: {
    orgId: number;
    staffId: number;
    value: number;
  }) => {
    const staffMember = await storage.getStaffMember(input.orgId, input.staffId);
    if (!staffMember) return;
    const currentShiftValue = Number(staffMember.shiftValue ?? 0);
    if (!Number.isFinite(currentShiftValue) || currentShiftValue <= 0) {
      await storage.updateStaff(input.orgId, staffMember.id, {
        shiftValue: input.value,
      });
    }
  };
  const syncManualShiftPayableForShift = async (input: {
    orgId: number;
    shift: {
      id: number;
      staffId: number;
      startTime: Date;
      endTime: Date;
      shiftType: string;
      notes?: string | null;
    };
    payableAmount?: number | null;
    remove?: boolean;
    promoteToStaffDefault?: boolean;
  }) => {
    const linkedPayables = await listManualShiftPayablesByShiftId(input.orgId, input.shift.id);
    const rawExplicitAmount = Number(input.payableAmount ?? NaN);
    const hasExplicitAmount =
      input.payableAmount !== undefined && input.payableAmount !== null && Number.isFinite(rawExplicitAmount);
    const explicitAmount = hasExplicitAmount ? roundMoney(Math.max(0, rawExplicitAmount)) : null;
    if (hasExplicitAmount && (explicitAmount ?? 0) > 0 && input.promoteToStaffDefault) {
      await maybeApplyShiftValueAsStaffDefault({
        orgId: input.orgId,
        staffId: input.shift.staffId,
        value: explicitAmount ?? 0,
      });
    }
    const shouldDelete = Boolean(input.remove || (hasExplicitAmount && (explicitAmount ?? 0) <= 0));

    if (shouldDelete) {
      for (const payable of linkedPayables) {
        await storage.deleteAccountPayable(input.orgId, payable.id);
      }
      return;
    }

    const primaryPayable = linkedPayables[0];
    const duplicatedPayables = linkedPayables.slice(primaryPayable ? 1 : 0);
    for (const duplicatedPayable of duplicatedPayables) {
      await storage.deleteAccountPayable(input.orgId, duplicatedPayable.id);
    }

    if (!primaryPayable && !hasExplicitAmount) {
      return;
    }

    const basePayload = await buildManualShiftPayableBasePayload(input.orgId, input.shift);
    if (primaryPayable) {
      const currentAmount = roundMoney(Math.max(0, Number(primaryPayable.amount ?? 0)));
      const nextAmount = hasExplicitAmount ? (explicitAmount ?? 0) : currentAmount;
      if (nextAmount <= 0) {
        await storage.deleteAccountPayable(input.orgId, primaryPayable.id);
        return;
      }
      await storage.updateAccountPayable(input.orgId, primaryPayable.id, {
        ...basePayload,
        amount: nextAmount,
      });
      return;
    }

    const createAmount = explicitAmount ?? 0;
    if (createAmount <= 0) {
      return;
    }
    await storage.createAccountPayable({
      organizationId: input.orgId,
      ...basePayload,
      amount: createAmount,
      discount: 0,
      extra: 0,
      status: "pending",
      paidAt: null,
      paymentMethod: null,
    });
  };

  const assertShiftWindow = (startTime: Date, endTime: Date) => {
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new ShiftValidationError("Data/hora inválida para a escala.");
    }
    if (endTime <= startTime) {
      throw new ShiftValidationError("Horário de fim precisa ser maior que o de início.");
    }
  };

  const rangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
    aStart < bEnd && aEnd > bStart;
  const resolveShiftTypeFromWindow = (startTime: Date, endTime: Date): ShiftAssignmentType => {
    const durationMs = endTime.getTime() - startTime.getTime();
    if (Math.abs(durationMs - (12 * HOUR_MS)) <= FIVE_MINUTES_MS) {
      return startTime.getHours() < 12 ? "12h_manha" : "12h_noite";
    }
    if (Math.abs(durationMs - (24 * HOUR_MS)) <= FIVE_MINUTES_MS) {
      return "24h";
    }
    return "avulso";
  };
  const getDefaultShiftTypeForRule = (allowedShiftTypes: ShiftAssignmentType[]): ShiftAssignmentType => {
    if (allowedShiftTypes.includes("12h_manha")) return "12h_manha";
    if (allowedShiftTypes.includes("12h_noite")) return "12h_noite";
    if (allowedShiftTypes.includes("24h")) return "24h";
    if (allowedShiftTypes.includes("avulso")) return "avulso";
    return "avulso";
  };
  const buildShiftWindowFromType = (
    baseDate: Date,
    shiftType: ShiftAssignmentType,
    exactShiftHours?: number | null,
  ): { startTime: Date; endTime: Date } => {
    let startHour = 8;
    if (shiftType === "12h_manha" || shiftType === "24h") startHour = 7;
    if (shiftType === "12h_noite") startHour = 19;

    const startTime = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      startHour,
      0,
      0,
      0,
    );
    const durationHours =
      exactShiftHours && exactShiftHours > 0
        ? exactShiftHours
        : shiftType === "24h"
          ? 24
          : shiftType === "12h_manha" || shiftType === "12h_noite"
            ? 12
            : 8;
    const endTime = new Date(startTime.getTime() + (durationHours * HOUR_MS));
    return { startTime, endTime };
  };

  const assertShiftAssignmentAllowed = async (input: {
    orgId: number;
    staffId: number;
    shiftType: ShiftAssignmentType;
    startTime: Date;
    endTime: Date;
    excludeShiftId?: number;
    environmentSettings?: EnvironmentSettings;
  }) => {
    const staffMember = await storage.getStaffMember(input.orgId, input.staffId);
    if (!staffMember) {
      throw new ShiftValidationError("Funcionário não encontrado.");
    }

    assertShiftWindow(input.startTime, input.endTime);

    const existingShifts = await storage.getShiftAssignments(input.orgId, { staffId: input.staffId });
    const otherShifts = existingShifts.filter((shift) => shift.id !== input.excludeShiftId);

    const hasOverlap = otherShifts.some((shift) => {
      const existingStart = new Date(shift.startTime);
      const existingEnd = new Date(shift.endTime);
      return rangesOverlap(input.startTime, input.endTime, existingStart, existingEnd);
    });
    if (hasOverlap) {
      throw new ShiftValidationError("Funcionário já possui escala neste período.");
    }

    const hasCustomWorkSchedule =
      typeof staffMember.workSchedule === "string" && staffMember.workSchedule.trim().length > 0;

    if (hasCustomWorkSchedule) {
      const schedule = parseStaffWorkSchedule(staffMember.workSchedule);
      const dayReference = new Date(
        input.startTime.getFullYear(),
        input.startTime.getMonth(),
        input.startTime.getDate(),
        0,
        0,
        0,
        0,
      );
      const dailySchedule = resolveDailySchedule(schedule, dayReference);

      if (dailySchedule.blocked) {
        throw new ShiftValidationError("Este dia esta bloqueado na jornada do colaborador.");
      }
      if (dailySchedule.hasRestrictions) {
        if (dailySchedule.windows.length === 0) {
          throw new ShiftValidationError("Dia/horário fora da jornada configurada do colaborador.");
        }
        if (!isShiftWithinWindows(input.startTime, input.endTime, dailySchedule.windows)) {
          throw new ShiftValidationError("Horario fora da jornada configurada do colaborador.");
        }
      }
    }

    const shiftRule = getShiftProfileRule(staffMember.shift, input.environmentSettings?.shiftProfiles);
    if (!shiftRule.enabled) {
      return;
    }

    if (shiftRule.allowedShiftTypes.length > 0 && !shiftRule.allowedShiftTypes.includes(input.shiftType)) {
      throw new ShiftValidationError(
        `Perfil ${staffMember.shift} aceita apenas: ${shiftRule.allowedShiftTypes.join(", ")}.`,
      );
    }

    const isAvulsoShift = input.shiftType === "avulso";
    const durationMs = input.endTime.getTime() - input.startTime.getTime();
    // Plantao avulso ignora regra fixa de duracao do perfil (ex.: 12x36).
    if (!isAvulsoShift && shiftRule.exactShiftHours) {
      const expectedDurationMs = shiftRule.exactShiftHours * HOUR_MS;
      if (Math.abs(durationMs - expectedDurationMs) > FIVE_MINUTES_MS) {
        throw new ShiftValidationError(
          `Perfil ${staffMember.shift} exige plantão de ${shiftRule.exactShiftHours}h.`,
        );
      }
    }

    // Plantão avulso também ignora descanso mínimo entre escalas do perfil.
    if (!isAvulsoShift && shiftRule.minRestHours) {
      const minimumRestMs = shiftRule.minRestHours * HOUR_MS;
      const violatesRest = otherShifts.some((shift) => {
        const existingStartMs = new Date(shift.startTime).getTime();
        const existingEndMs = new Date(shift.endTime).getTime();
        const startMs = input.startTime.getTime();
        const endMs = input.endTime.getTime();

        if (startMs >= existingEndMs) {
          return startMs - existingEndMs < minimumRestMs;
        }
        if (endMs <= existingStartMs) {
          return existingStartMs - endMs < minimumRestMs;
        }
        return true;
      });

      if (violatesRest) {
        throw new ShiftValidationError(
          `Perfil ${staffMember.shift} exige descanso mínimo de ${shiftRule.minRestHours}h entre plantões.`,
        );
      }
    }
  };

  app.get("/api/shift-assignments", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const { residentId, staffId, start, end } = req.query;
    const shifts = await storage.getShiftAssignments(orgId, {
      residentId: residentId ? Number(residentId) : undefined,
      staffId: staffId ? Number(staffId) : undefined,
      start: start ? parseLocalDateTimeInput(start) : undefined,
      end: end ? parseLocalDateTimeInput(end) : undefined,
    });
    res.json(shifts.map(serializeShiftAssignment));
  });
  app.get("/api/shift-assignments/:id/payable", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const shiftId = Number(req.params.id);
    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      return res.status(400).json({ message: "ID de escala inválido." });
    }

    const shifts = await storage.getShiftAssignments(orgId);
    const targetShift = shifts.find((shift) => shift.id === shiftId);
    if (!targetShift) {
      return res.status(404).json({ message: "Escala não encontrada." });
    }

    await enforceCaregiverOwnStaffId(orgId, req.session.user, targetShift.staffId);
    return res.json(await buildShiftPayableLinkResponse(orgId, targetShift));
  });
  // Escrita de escalas: admin + enfermeiro + tecnico + recepcionista + administrativo
  const SHIFT_WRITE_ROLES = ["admin", "enfermeiro", "tecnico_enfermagem", "recepcionista", "administrativo"];
  app.put("/api/shift-assignments/:id/payable", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const shiftId = Number(req.params.id);
      if (!Number.isInteger(shiftId) || shiftId <= 0) {
        return res.status(400).json({ message: "ID de escala inválido." });
      }
      const input = shiftPayableInputSchema.parse(req.body ?? {});

      const shifts = await storage.getShiftAssignments(orgId);
      const targetShift = shifts.find((shift) => shift.id === shiftId);
      if (!targetShift) {
        return res.status(404).json({ message: "Escala não encontrada." });
      }

      await enforceCaregiverOwnStaffId(orgId, req.session.user, targetShift.staffId);
      await syncManualShiftPayableForShift({
        orgId,
        shift: targetShift,
        payableAmount: input.payableAmount,
        promoteToStaffDefault: input.promoteToStaffDefault !== false,
      });

      return res.json(await buildShiftPayableLinkResponse(orgId, targetShift));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      next(err);
    }
  });
  app.post("/api/shift-assignments/generate-month", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const environmentSettings = (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const input = generateMonthInputSchema.parse(req.body);
      const enforcedStaffId = await enforceCaregiverOwnStaffId(orgId, req.session.user, input.staffId ?? null);
      const [year, monthNumber] = input.month.split("-").map(Number);
      const monthStart = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(year, monthNumber, 0, 23, 59, 59, 999);
      const totalDaysInMonth = monthEnd.getDate();

      const allStaff = await storage.getStaff(orgId);
      const targetStaff = enforcedStaffId
        ? allStaff.filter((member) => member.id === enforcedStaffId)
        : input.staffId
          ? allStaff.filter((member) => member.id === input.staffId)
        : allStaff;

      if ((input.staffId || enforcedStaffId) && targetStaff.length === 0) {
        return res.status(404).json({ message: "Funcionário não encontrado." });
      }

      const targetStaffIds = new Set<number>(targetStaff.map((member) => member.id));
      const payablesForMonth = await storage.getAccountsPayable(orgId, {
        referenceMonth: input.month,
      });
      const manualPayableShiftIdsForTargetStaff = new Set<number>(
        payablesForMonth
          .filter((item) => Number.isInteger(item.staffId) && targetStaffIds.has(Number(item.staffId)))
          .map((item) => parseManualPayableShiftId(item.notes))
          .filter((shiftId): shiftId is number => shiftId !== null),
      );

      let monthlyShifts = await storage.getShiftAssignments(orgId, {
        start: monthStart,
        end: monthEnd,
      });

      const isGeneratedShift = (note?: string | null) =>
        typeof note === "string" && note.startsWith(`${AUTO_MONTH_NOTE_PREFIX}${input.month}]`);

      if (input.clearGenerated) {
        const generatedShifts = monthlyShifts.filter(
          (shift) =>
            isGeneratedShift(shift.notes) &&
            (!input.staffId || shift.staffId === input.staffId),
        );
        const generatedShiftsToPreserve = generatedShifts.filter((shift) =>
          manualPayableShiftIdsForTargetStaff.has(shift.id),
        );
        const generatedShiftsToDelete = generatedShifts.filter((shift) =>
          !manualPayableShiftIdsForTargetStaff.has(shift.id),
        );

        for (const generatedShift of generatedShiftsToDelete) {
          await syncManualShiftPayableForShift({
            orgId,
            shift: generatedShift,
            remove: true,
          });
          await storage.deleteShiftAssignment(orgId, generatedShift.id);
        }

        monthlyShifts = await storage.getShiftAssignments(orgId, {
          start: monthStart,
          end: monthEnd,
        });

        if (generatedShiftsToPreserve.length > 0) {
          console.log(
            `[generate-month] preservados ${generatedShiftsToPreserve.length} plantão(oes) com valor manual em ${input.month}`,
          );
        }
      }

      type ShiftRange = { start: Date; end: Date };
      const shiftRangesByStaff = new Map<number, ShiftRange[]>();
      for (const shift of monthlyShifts) {
        const existingRanges = shiftRangesByStaff.get(shift.staffId) ?? [];
        existingRanges.push({
          start: new Date(shift.startTime),
          end: new Date(shift.endTime),
        });
        shiftRangesByStaff.set(shift.staffId, existingRanges);
      }

      let createdCount = 0;
      let skippedCount = 0;
      let invalidSlotCount = 0;
      let overlapSkipCount = 0;
      let validationSkipCount = 0;
      let configuredStaffCount = 0;

      for (const member of targetStaff) {
        if (member.active === false) continue;

        const schedule = parseStaffWorkSchedule(member.workSchedule);
        const hasWeeklyRule = WEEKDAY_KEYS.some((key) => {
          const rule = schedule.weekly[key];
          return Boolean(rule.enabled && (rule.slots?.length ?? 0) > 0);
        });
        const hasOddRule = Boolean(schedule.oddDays.enabled && (schedule.oddDays.slots?.length ?? 0) > 0);
        const hasEvenRule = Boolean(schedule.evenDays.enabled && (schedule.evenDays.slots?.length ?? 0) > 0);
        const hasRecurringSchedule = hasWeeklyRule || hasOddRule || hasEvenRule;

        const shiftRule = getShiftProfileRule(member.shift, environmentSettings.shiftProfiles);
        // Sem agenda recorrente configurada, não inferimos mais 07:00/19:00 pelo perfil.
        // O perfil valida duração/descanso; os horários reais precisam vir do colaborador ou da escala manual.
        const canGenerateFromProfileRule = false;
        const preferredProfileShiftType =
          schedule.profileCycleStart
          && shiftRule.allowedShiftTypes.includes(schedule.profileCycleStart)
            ? schedule.profileCycleStart
            : null;
        const profileShiftType = preferredProfileShiftType ?? getDefaultShiftTypeForRule(shiftRule.allowedShiftTypes);

        if (!hasRecurringSchedule && !canGenerateFromProfileRule) continue;
        configuredStaffCount++;

        const memberRanges = shiftRangesByStaff.get(member.id) ?? [];

        for (let day = 1; day <= totalDaysInMonth; day++) {
          const currentDay = new Date(year, monthNumber - 1, day, 0, 0, 0, 0);
          if (hasRecurringSchedule) {
            const dailySchedule = resolveDailySchedule(schedule, currentDay);
            if (dailySchedule.blocked) {
              continue;
            }
            if (!dailySchedule.hasRestrictions) {
              continue;
            }
            if (dailySchedule.invalidSlots > 0) {
              skippedCount += dailySchedule.invalidSlots;
              invalidSlotCount += dailySchedule.invalidSlots;
            }
            if (dailySchedule.windows.length === 0) {
              continue;
            }

            for (const window of dailySchedule.windows) {
              const startTime = new Date(window.start);
              const endTime = new Date(window.end);
              const generatedShiftType = resolveShiftTypeFromWindow(startTime, endTime);

              const hasOverlap = memberRanges.some((range) =>
                rangesOverlap(startTime, endTime, range.start, range.end),
              );
              if (hasOverlap) {
                skippedCount++;
                overlapSkipCount++;
                continue;
              }

              try {
                await assertShiftAssignmentAllowed({
                  orgId,
                  staffId: member.id,
                  shiftType: generatedShiftType,
                  startTime,
                  endTime,
                  environmentSettings,
                });
              } catch (error) {
                if (error instanceof ShiftValidationError) {
                  skippedCount++;
                  validationSkipCount++;
                  continue;
                }
                throw error;
              }

              const notes = `${AUTO_MONTH_NOTE_PREFIX}${input.month}] ${window.source}`;
              const createdShift = await storage.createShiftAssignment({
                organizationId: orgId,
                staffId: member.id,
                residentId: null,
                shiftType: generatedShiftType,
                startTime,
                endTime,
                notes,
              });

              memberRanges.push({
                start: new Date(createdShift.startTime),
                end: new Date(createdShift.endTime),
              });
              createdCount++;
            }
            continue;
          }

          if (!canGenerateFromProfileRule) {
            continue;
          }

          const { startTime, endTime } = buildShiftWindowFromType(
            currentDay,
            profileShiftType,
            shiftRule.exactShiftHours,
          );
          const hasOverlap = memberRanges.some((range) =>
            rangesOverlap(startTime, endTime, range.start, range.end),
          );
          if (hasOverlap) {
            skippedCount++;
            overlapSkipCount++;
            continue;
          }

          try {
            await assertShiftAssignmentAllowed({
              orgId,
              staffId: member.id,
              shiftType: profileShiftType,
              startTime,
              endTime,
              environmentSettings,
            });
          } catch (error) {
            if (error instanceof ShiftValidationError) {
              skippedCount++;
              validationSkipCount++;
              continue;
            }
            throw error;
          }

          const notes = `${AUTO_MONTH_NOTE_PREFIX}${input.month}] regra:${member.shift}`;
          const createdShift = await storage.createShiftAssignment({
            organizationId: orgId,
            staffId: member.id,
            residentId: null,
            shiftType: profileShiftType,
            startTime,
            endTime,
            notes,
          });

          memberRanges.push({
            start: new Date(createdShift.startTime),
            end: new Date(createdShift.endTime),
          });
          createdCount++;
        }

        shiftRangesByStaff.set(member.id, memberRanges);
      }

      const monthShiftsAfterGeneration = await storage.getShiftAssignments(orgId, {
        start: monthStart,
        end: monthEnd,
      });
      const getAutoPayableKey = (staffId: number) =>
        `${AUTO_MONTH_PAYABLE_NOTE_PREFIX}${input.month}][STAFF:${staffId}]`;
      const isAutoPayableForStaff = (note: unknown, staffId: number) =>
        typeof note === "string" && note.includes(getAutoPayableKey(staffId));

      const monthDueDate = `${input.month}-${String(totalDaysInMonth).padStart(2, "0")}`;
      let payablesCreated = 0;
      let payablesUpdated = 0;
      let payablesDeleted = 0;
      let payablesSkippedLocked = 0;

      for (const member of targetStaff) {
        if (member.active === false) continue;

        const shiftValueRaw = Number(member.shiftValue ?? 0);
        const shiftValue = Number.isFinite(shiftValueRaw) && shiftValueRaw > 0
          ? roundMoney(shiftValueRaw)
          : 0;
        const payablesForStaffMonth = await storage.getAccountsPayable(orgId, {
          staffId: member.id,
          referenceMonth: input.month,
        });
        const manualPayableShiftIdsForStaff = new Set<number>(
          payablesForStaffMonth
            .map((item) => parseManualPayableShiftId(item.notes))
            .filter((shiftId): shiftId is number => shiftId !== null),
        );
        const generatedShiftsForStaff = monthShiftsAfterGeneration
          .filter(
            (shift) =>
              shift.staffId === member.id
              && isGeneratedShift(shift.notes)
              && !manualPayableShiftIdsForStaff.has(shift.id),
          )
          .sort((left, right) =>
            new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
          );
        const generatedShiftCount = generatedShiftsForStaff.length;
        const autoPayables = payablesForStaffMonth.filter((item) =>
          isAutoPayableForStaff(item.notes, member.id),
        );
        const paidAutoPayables = autoPayables.filter((item) => item.status === "paid");
        const editableAutoPayables = autoPayables.filter((item) => item.status !== "paid");

        if (paidAutoPayables.length > 0) {
          for (const payable of editableAutoPayables) {
            await storage.deleteAccountPayable(orgId, payable.id);
            payablesDeleted++;
          }
          payablesSkippedLocked += paidAutoPayables.length;
          continue;
        }

        const primaryEditable = editableAutoPayables[0];
        const duplicatedEditable = editableAutoPayables.slice(primaryEditable ? 1 : 0);
        for (const duplicated of duplicatedEditable) {
          await storage.deleteAccountPayable(orgId, duplicated.id);
          payablesDeleted++;
        }

        if (shiftValue <= 0 || generatedShiftCount <= 0) {
          if (primaryEditable) {
            await storage.deleteAccountPayable(orgId, primaryEditable.id);
            payablesDeleted++;
          }
          continue;
        }

        const amount = roundMoney(generatedShiftCount * shiftValue);
        const consideredShiftIds = generatedShiftsForStaff.map((shift) => shift.id).join(",");
        const autoPayableNote = `${getAutoPayableKey(member.id)} ${generatedShiftCount}x${shiftValue.toFixed(2)} ids:${consideredShiftIds}`;
        const basePayablePayload = {
          organizationId: orgId,
          staffId: member.id,
          title: `Plantões ${input.month} - ${member.name}`,
          category: "staff",
          referenceMonth: input.month,
          dueDate: monthDueDate,
          amount,
          discount: 0,
          extra: 0,
          paymentMethod: null,
          notes: autoPayableNote,
        } as const;

        if (primaryEditable) {
          await storage.updateAccountPayable(orgId, primaryEditable.id, {
            ...basePayablePayload,
            status: "pending",
            paidAt: null,
          });
          payablesUpdated++;
        } else {
          await storage.createAccountPayable({
            ...basePayablePayload,
            status: "pending",
            paidAt: null,
          });
          payablesCreated++;
        }
      }

      res.json({
        month: input.month,
        staffProcessed: targetStaff.length,
        staffWithSchedule: configuredStaffCount,
        created: createdCount,
        skipped: skippedCount,
        skippedByInvalidSlot: invalidSlotCount,
        skippedByOverlap: overlapSkipCount,
        skippedByValidation: validationSkipCount,
        clearedGenerated: Boolean(input.clearGenerated),
        payablesCreated,
        payablesUpdated,
        payablesDeleted,
        payablesSkippedLocked,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      next(err);
    }
  });
  app.post("/api/shift-assignments/:id/exclude-day", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const shiftId = Number(req.params.id);
      if (!Number.isInteger(shiftId) || shiftId <= 0) {
        return res.status(400).json({ message: "ID de escala inválido." });
      }

      const shifts = await storage.getShiftAssignments(orgId);
      const targetShift = shifts.find((shift) => shift.id === shiftId);
      if (!targetShift) {
        return res.status(404).json({ message: "Escala não encontrada." });
      }

      const staffMember = await storage.getStaffMember(orgId, targetShift.staffId);
      if (!staffMember) {
        return res.status(404).json({ message: "Funcionário não encontrado." });
      }

      const blockedDate = toDateKey(new Date(targetShift.startTime));
      const schedule = parseStaffWorkSchedule(staffMember.workSchedule);
      if (!schedule.blockedDates.includes(blockedDate)) {
        schedule.blockedDates.push(blockedDate);
        schedule.blockedDates.sort();
      }

      await storage.updateStaff(orgId, staffMember.id, {
        workSchedule: JSON.stringify(schedule),
      });
      await syncManualShiftPayableForShift({
        orgId,
        shift: targetShift,
        remove: true,
      });
      await storage.deleteShiftAssignment(orgId, targetShift.id);

      res.json({
        message: "Dia dispensado com sucesso.",
        shiftId: targetShift.id,
        staffId: staffMember.id,
        blockedDate,
      });
    } catch (err) {
      throw err;
    }
  });
  app.post("/api/shift-assignments", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const environmentSettings = (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const input = shiftInputSchema.parse(req.body);
      const enforcedStaffId = await enforceCaregiverOwnStaffId(orgId, req.session.user, input.staffId);
      if (!enforcedStaffId) {
        return res.status(400).json({ message: "Profissional da escala não informado." });
      }
      const normalizedInput = { ...input, staffId: enforcedStaffId };
      await assertShiftAssignmentAllowed({
        orgId,
        staffId: normalizedInput.staffId,
        shiftType: normalizedInput.shiftType,
        startTime: normalizedInput.startTime,
        endTime: normalizedInput.endTime,
        environmentSettings,
      });
      const { payableAmount, promoteToStaffDefault, ...shiftPayload } = normalizedInput;
      const createdShift = await storage.createShiftAssignment({ ...shiftPayload, organizationId: orgId });
      await syncManualShiftPayableForShift({
        orgId,
        shift: createdShift,
        payableAmount,
        promoteToStaffDefault: promoteToStaffDefault !== false,
      });

      res.status(201).json(serializeShiftAssignment(createdShift));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof ShiftValidationError) return res.status(400).json({ message: err.message });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      next(err);
    }
  });
  app.put("/api/shift-assignments/:id", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const environmentSettings = (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const shiftId = Number(req.params.id);
      const updates = shiftInputSchema.partial().parse(req.body);
      const { payableAmount, promoteToStaffDefault, ...shiftUpdates } = updates;

      const currentShifts = await storage.getShiftAssignments(orgId);
      const currentShift = currentShifts.find((shift) => shift.id === shiftId);
      if (!currentShift) {
        return res.status(404).json({ message: "Escala não encontrada" });
      }

      const requestedStaffId = shiftUpdates.staffId ?? currentShift.staffId;
      const enforcedStaffId = await enforceCaregiverOwnStaffId(orgId, req.session.user, requestedStaffId);
      if (!enforcedStaffId) {
        return res.status(400).json({ message: "Profissional da escala não informado." });
      }
      const nextStaffId = enforcedStaffId;
      const nextShiftType = (shiftUpdates.shiftType ?? currentShift.shiftType ?? "avulso") as "12h_manha" | "12h_noite" | "24h" | "avulso";
      const nextStartTime = shiftUpdates.startTime ?? new Date(currentShift.startTime);
      const nextEndTime = shiftUpdates.endTime ?? new Date(currentShift.endTime);

      await assertShiftAssignmentAllowed({
        orgId,
        staffId: nextStaffId,
        shiftType: nextShiftType,
        startTime: nextStartTime,
        endTime: nextEndTime,
        excludeShiftId: shiftId,
        environmentSettings,
      });

      const normalizedUpdates = shiftUpdates.staffId !== undefined || req.session.user?.role === "cuidador"
        ? { ...shiftUpdates, staffId: nextStaffId }
        : shiftUpdates;
      const updatedShift = await storage.updateShiftAssignment(orgId, shiftId, normalizedUpdates);
      await syncManualShiftPayableForShift({
        orgId,
        shift: updatedShift,
        payableAmount,
        promoteToStaffDefault: promoteToStaffDefault !== false,
      });

      res.json(serializeShiftAssignment(updatedShift));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof ShiftValidationError) return res.status(400).json({ message: err.message });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      next(err);
    }
  });
  app.delete("/api/shift-assignments/:id", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const shiftId = Number(req.params.id);
    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      return res.status(400).json({ message: "ID de escala inválido." });
    }

    const shifts = await storage.getShiftAssignments(orgId);
    const targetShift = shifts.find((shift) => shift.id === shiftId);
    if (!targetShift) {
      return res.status(404).json({ message: "Escala não encontrada." });
    }

    await enforceCaregiverOwnStaffId(orgId, req.session.user, targetShift.staffId);
    await syncManualShiftPayableForShift({
      orgId,
      shift: targetShift,
      remove: true,
    });
    await storage.deleteShiftAssignment(orgId, shiftId);
    res.status(204).send();
  });

  // ===== TIME CLOCK / PONTO ELETRONICO =====
  const TIME_CLOCK_EVENT_TYPES = ["clock_in", "break_start", "break_end", "clock_out"] as const;
  type TimeClockEventType = (typeof TIME_CLOCK_EVENT_TYPES)[number];
  type TimeClockState = {
    state: "closed" | "working" | "on_break";
    nextActions: TimeClockEventType[];
    message?: string;
  };
  const TIME_CLOCK_EVENT_LABELS: Record<TimeClockEventType, string> = {
    clock_in: "Entrada",
    break_start: "Pausa",
    break_end: "Retorno",
    clock_out: "Saída",
  };
  const BREAK_NOTIFICATION_TYPES = ["time_clock_break_reminder", "time_clock_break_overdue"] as const;
  const CLOCK_OUT_NOTIFICATION_TYPES = ["time_clock_clock_out_missing"] as const;
  const formatNotificationDateTime = (date: Date) =>
    date.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const formatNotificationTime = (date: Date) =>
    date.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
  const addMinutesToDate = (date: Date, minutes: number) =>
    new Date(date.getTime() + minutes * 60 * 1000);
  const buildTimeClockActionUrl = (input: {
    tab?: "closure" | "mirror" | "log";
    entryId?: number | null;
    adjustmentId?: number | null;
    staffId?: number | null;
    month?: string | null;
  } = {}) => {
    const params = new URLSearchParams({ tab: input.tab ?? "log" });
    if (input.entryId) params.set("entryId", String(input.entryId));
    if (input.adjustmentId) params.set("adjustmentId", String(input.adjustmentId));
    if (input.staffId) params.set("staffId", String(input.staffId));
    if (input.month) params.set("month", input.month);
    return `/ponto-eletronico?${params.toString()}`;
  };
  const buildPunchNotificationMessage = (input: {
    eventType: TimeClockEventType;
    eventTime: Date;
    requiresApproval: boolean;
    settings?: TimeClockSettings | null;
  }) => {
    const eventTimeLabel = formatNotificationTime(input.eventTime);
    const approvalSuffix = input.requiresApproval ? " Esta batida foi enviada para aprovação do gestor." : "";

    if (input.eventType === "break_start" && input.settings) {
      const durationMinutes = Math.max(0, Math.round(input.settings.breakDurationMinutes));
      const reminderBeforeMinutes = Math.max(0, Math.round(input.settings.breakReminderBeforeMinutes));
      const expectedEnd = addMinutesToDate(input.eventTime, durationMinutes);
      const reminderText = reminderBeforeMinutes > 0
        ? ` Voce recebera um lembrete ${reminderBeforeMinutes} minuto(s) antes.`
        : "";
      return `Pausa registrada as ${eventTimeLabel}. Retorno previsto para ${formatNotificationTime(expectedEnd)}.${reminderText}${approvalSuffix}`;
    }

    if (input.eventType === "break_end") {
      return `Retorno da pausa registrado as ${eventTimeLabel}.${approvalSuffix}`;
    }

    if (input.eventType === "clock_out") {
      return `Saída registrada às ${eventTimeLabel}. Jornada finalizada.${approvalSuffix}`;
    }

    return `Entrada registrada as ${eventTimeLabel}.${approvalSuffix}`;
  };
  const notifyTimeClockManagers = async (
    orgId: number,
    payload: Omit<InternalNotificationPayload, "userId" | "sourceModule">,
  ) => {
    await notifyOrganizationRoles(orgId, ["admin", "administrativo"], {
      ...payload,
      sourceModule: "time_clock",
      actionUrl: payload.actionUrl ?? buildTimeClockActionUrl({
        entryId: payload.entityType === "time_clock_entry" ? payload.entityId : null,
        adjustmentId: payload.entityType === "time_clock_adjustment_request" ? payload.entityId : null,
        staffId: payload.staffId ?? null,
      }),
    });
  };
  const getTimeClockSettingsForRequest = async (
    orgId: number,
    responseSettings?: EnvironmentSettings,
  ): Promise<TimeClockSettings> =>
    responseSettings?.timeClock
      ?? (await getOrganizationEnvironmentSettings(orgId))?.settings.timeClock
      ?? DEFAULT_ENVIRONMENT_SETTINGS.timeClock;
  const getLastTimeClockStateEntry = (
    entries: Array<{ id?: number; eventType: string; status?: string | null; eventTime: string | Date | null }>,
  ) =>
    entries
      .filter((entry) => entry.status === "valid" || entry.status === "manual_adjusted" || entry.status === "pending_approval")
      .slice()
      .sort((left, right) => Number(toDateTime(left.eventTime)?.getTime() ?? 0) - Number(toDateTime(right.eventTime)?.getTime() ?? 0))
      .at(-1) ?? null;
  const scheduleBreakNotifications = async (input: {
    orgId: number;
    sessionUser: SessionUser | undefined;
    staffId: number;
    staffName: string;
    breakEntryId: number;
    breakStart: Date;
    settings: TimeClockSettings;
  }) => {
    if (!input.sessionUser?.id) return;
    const durationMinutes = Math.max(0, Math.round(input.settings.breakDurationMinutes));
    if (durationMinutes <= 0) return;

    const reminderBeforeMinutes = Math.max(0, Math.round(input.settings.breakReminderBeforeMinutes));
    const expectedEnd = addMinutesToDate(input.breakStart, durationMinutes);
    const reminderAt = addMinutesToDate(expectedEnd, -reminderBeforeMinutes);
    const staffUserIds = [
      input.sessionUser.id,
      ...(await resolveNotificationUserIdsForStaff(input.orgId, input.staffId)),
    ];
    const payloads: Array<Omit<InternalNotificationPayload, "userId">> = [];

    if (reminderBeforeMinutes > 0 && reminderAt.getTime() > Date.now()) {
      payloads.push({
        staffId: input.staffId,
        type: "time_clock_break_reminder",
        severity: "warning",
        sourceModule: "time_clock",
        title: "Pausa terminando",
        message: `Sua pausa termina em ${reminderBeforeMinutes} minuto(s). Retorno previsto para ${formatNotificationDateTime(expectedEnd)}.`,
        actionUrl: buildTimeClockActionUrl({
          entryId: input.breakEntryId,
          staffId: input.staffId,
          month: getTimeClockReferenceMonth(input.breakStart),
        }),
        entityType: "time_clock_entry",
        entityId: input.breakEntryId,
        scheduledFor: reminderAt,
        metadata: {
          breakStart: input.breakStart.toISOString(),
          expectedEnd: expectedEnd.toISOString(),
          durationMinutes,
          reminderBeforeMinutes,
        },
      });
    }

    payloads.push({
      staffId: input.staffId,
      type: "time_clock_break_overdue",
      severity: "error",
      sourceModule: "time_clock",
      title: "Pausa passou do horário",
      message: `A pausa de ${input.staffName} passou do horário previsto de retorno (${formatNotificationDateTime(expectedEnd)}).`,
      actionUrl: buildTimeClockActionUrl({
        entryId: input.breakEntryId,
        staffId: input.staffId,
        month: getTimeClockReferenceMonth(input.breakStart),
      }),
      entityType: "time_clock_entry",
      entityId: input.breakEntryId,
      scheduledFor: expectedEnd,
      metadata: {
        breakStart: input.breakStart.toISOString(),
        expectedEnd: expectedEnd.toISOString(),
        durationMinutes,
      },
    });

    await safeCreateInternalNotifications(
      input.orgId,
      payloads.flatMap((payload) =>
        Array.from(new Set(staffUserIds)).map((userId) => ({ ...payload, userId })),
      ),
    );
    await notifyTimeClockManagers(input.orgId, {
      staffId: input.staffId,
      type: "time_clock_break_overdue",
      severity: "error",
      title: "Pausa passou do horário",
      message: `${input.staffName} não registrou retorno da pausa até ${formatNotificationDateTime(expectedEnd)}.`,
      actionUrl: buildTimeClockActionUrl({
        entryId: input.breakEntryId,
        staffId: input.staffId,
        month: getTimeClockReferenceMonth(input.breakStart),
      }),
      entityType: "time_clock_entry",
      entityId: input.breakEntryId,
      scheduledFor: expectedEnd,
      metadata: {
        breakStart: input.breakStart.toISOString(),
        expectedEnd: expectedEnd.toISOString(),
        durationMinutes,
      },
    });
  };
  const cancelBreakNotifications = async (orgId: number, breakEntryId?: number | null) => {
    if (!breakEntryId) return;
    await storage.cancelScheduledNotifications(orgId, {
      types: [...BREAK_NOTIFICATION_TYPES],
      entityType: "time_clock_entry",
      entityId: breakEntryId,
      futureOnly: false,
    });
  };
  const findShiftForClockOutAlert = (
    shifts: Array<{ id?: number; startTime: string | Date | null; endTime: string | Date | null }>,
    eventTime: Date,
  ) => {
    const candidates: Array<{ id?: number; start: Date; end: Date }> = [];
    shifts.forEach((shift) => {
      const start = toDateTime(shift.startTime);
      const end = toDateTime(shift.endTime);
      if (!start || !end || end.getTime() <= eventTime.getTime()) return;
      candidates.push({ id: shift.id, start, end });
    });
    candidates.sort((left, right) => left.end.getTime() - right.end.getTime());
    const activeShift = candidates.find((shift) =>
      shift.start.getTime() <= eventTime.getTime() && shift.end.getTime() >= eventTime.getTime(),
    );
    return activeShift ?? candidates[0] ?? null;
  };
  const cancelClockOutMissingNotifications = async (orgId: number, staffId: number) => {
    await storage.cancelScheduledNotifications(orgId, {
      types: [...CLOCK_OUT_NOTIFICATION_TYPES],
      staffId,
      futureOnly: false,
    });
  };
  const scheduleClockOutMissingNotifications = async (input: {
    orgId: number;
    sessionUser: SessionUser | undefined;
    staffId: number;
    staffName: string;
    triggerEntryId: number;
    eventTime: Date;
    shifts: Array<{ id?: number; startTime: string | Date | null; endTime: string | Date | null }>;
    settings: TimeClockSettings;
  }) => {
    const targetShift = findShiftForClockOutAlert(input.shifts, input.eventTime);
    if (!targetShift) return;
    const toleranceMinutes = Math.max(0, Math.round(input.settings.overtimeToleranceMinutes));
    const scheduledFor = addMinutesToDate(targetShift.end, toleranceMinutes);
    if (scheduledFor.getTime() <= Date.now()) return;

    await cancelClockOutMissingNotifications(input.orgId, input.staffId);

    const staffUserIds = [
      input.sessionUser?.id,
      ...(await resolveNotificationUserIdsForStaff(input.orgId, input.staffId)),
    ];
    await notifyUsers(input.orgId, staffUserIds, {
      staffId: input.staffId,
      type: "time_clock_clock_out_missing",
      severity: "warning",
      sourceModule: "time_clock",
      title: "Saída pendente",
      message: `Sua escala terminou as ${formatNotificationDateTime(targetShift.end)}. Registre a saída se a jornada foi finalizada.`,
      actionUrl: buildTimeClockActionUrl({
        entryId: input.triggerEntryId,
        staffId: input.staffId,
        month: getTimeClockReferenceMonth(input.eventTime),
      }),
      entityType: "time_clock_entry",
      entityId: input.triggerEntryId,
      scheduledFor,
      metadata: {
        shiftId: targetShift.id ?? null,
        expectedEnd: targetShift.end.toISOString(),
        toleranceMinutes,
      },
    });
    await notifyTimeClockManagers(input.orgId, {
      staffId: input.staffId,
      type: "time_clock_clock_out_missing",
      severity: "warning",
      title: "Saída não registrada",
      message: `${input.staffName} esta com jornada aberta apos o fim previsto da escala (${formatNotificationDateTime(targetShift.end)}).`,
      actionUrl: buildTimeClockActionUrl({
        entryId: input.triggerEntryId,
        staffId: input.staffId,
        month: getTimeClockReferenceMonth(input.eventTime),
      }),
      entityType: "time_clock_entry",
      entityId: input.triggerEntryId,
      scheduledFor,
      metadata: {
        shiftId: targetShift.id ?? null,
        expectedEnd: targetShift.end.toISOString(),
        toleranceMinutes,
      },
    });
  };
  const timeClockPunchInputSchema = z.object({
    eventType: z.enum(TIME_CLOCK_EVENT_TYPES),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    accuracy: z.coerce.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  });
  const timeClockLocationInputSchema = z.object({
    name: z.string().trim().min(2, "Nome obrigatório."),
    address: z.string().trim().optional().nullable(),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().int().min(25).max(5000).default(200),
    active: z.boolean().optional().default(true),
  });
  const timeClockCoordinateInputSchema = z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  });
  const timeClockAddressInputSchema = z.object({
    address: z.string().trim().optional().nullable(),
    cep: z.string().trim().optional().nullable(),
    number: z.string().trim().optional().nullable(),
  }).refine((value) => Boolean(value.address?.trim() || value.cep?.trim()), {
    message: "Informe um endereço ou CEP.",
  });
  const timeClockAdjustmentInputSchema = z.object({
    staffId: z.coerce.number().int().positive().optional().nullable(),
    entryId: z.coerce.number().int().positive().optional().nullable(),
    eventType: z.enum(TIME_CLOCK_EVENT_TYPES),
    requestedEventTime: z.coerce.date(),
    reason: z.string().trim().min(3, "Justificativa obrigatoria."),
    notes: z.string().trim().optional().nullable(),
  });
  const timeClockAdjustmentReviewSchema = z.object({
    status: z.enum(["approved", "rejected"]),
    reviewerNotes: z.string().trim().optional().nullable(),
  });
  const timeClockEntryReviewSchema = z.object({
    status: z.enum(["approved", "rejected"]),
    reviewerNotes: z.string().trim().optional().nullable(),
  });
  const timeClockClosureInputSchema = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido. Use YYYY-MM."),
    action: z.enum(["close", "reopen"]),
    notes: z.string().trim().optional().nullable(),
  });
  const timeClockMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido. Use YYYY-MM.");

  const getTimeClockMonthRange = (month: string) => {
    const [year, monthNumber] = month.split("-").map(Number);
    return {
      start: new Date(year, monthNumber - 1, 1, 0, 0, 0, 0),
      end: new Date(year, monthNumber, 0, 23, 59, 59, 999),
    };
  };
  const toDateTime = (value: string | Date | null | undefined): Date | null => {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const minutesBetween = (start: Date, end: Date) =>
    Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const parseClockMinutes = (value: string | null | undefined, fallback: string) => {
    const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
    const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      const fallbackMatch = fallback.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
      return fallbackMatch ? Number(fallbackMatch[1]) * 60 + Number(fallbackMatch[2]) : 0;
    }
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const setDateMinutes = (date: Date, minutes: number) => {
    const next = new Date(date);
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return next;
  };
  const nightMinutesBetween = (start: Date, end: Date, settings: TimeClockSettings = DEFAULT_ENVIRONMENT_SETTINGS.timeClock) => {
    if (end.getTime() <= start.getTime()) return 0;
    let total = 0;
    const nightStartMinutes = parseClockMinutes(settings.nightStartTime, DEFAULT_ENVIRONMENT_SETTINGS.timeClock.nightStartTime);
    const nightEndMinutes = parseClockMinutes(settings.nightEndTime, DEFAULT_ENVIRONMENT_SETTINGS.timeClock.nightEndTime);
    const crossesMidnight = nightEndMinutes <= nightStartMinutes;
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    if (crossesMidnight) cursor.setDate(cursor.getDate() - 1);
    const finalDay = new Date(end);
    finalDay.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= finalDay.getTime()) {
      const nightStart = setDateMinutes(cursor, nightStartMinutes);
      const nightEnd = setDateMinutes(cursor, nightEndMinutes);
      if (crossesMidnight) nightEnd.setDate(nightEnd.getDate() + 1);
      const overlapStart = new Date(Math.max(start.getTime(), nightStart.getTime()));
      const overlapEnd = new Date(Math.min(end.getTime(), nightEnd.getTime()));
      if (overlapEnd.getTime() > overlapStart.getTime()) {
        total += minutesBetween(overlapStart, overlapEnd);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  };
  const haversineDistanceMeters = (
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number,
  ) => {
    const earthRadiusMeters = 6371000;
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const deltaLatitude = toRadians(latitudeB - latitudeA);
    const deltaLongitude = toRadians(longitudeB - longitudeA);
    const latA = toRadians(latitudeA);
    const latB = toRadians(latitudeB);
    const haversine =
      Math.sin(deltaLatitude / 2) ** 2
      + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLongitude / 2) ** 2;
    return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  };
  const getNearestTimeClockLocation = (
    locations: Array<{ id: number; name: string; latitude: number; longitude: number; radiusMeters: number; active?: boolean | null }>,
    latitude: number,
    longitude: number,
  ) => {
    const activeLocations = locations.filter((location) => location.active !== false);
    let nearest: (typeof activeLocations)[number] | null = null;
    let distanceMeters = Number.POSITIVE_INFINITY;
    for (const location of activeLocations) {
      const distance = haversineDistanceMeters(latitude, longitude, Number(location.latitude), Number(location.longitude));
      if (distance < distanceMeters) {
        nearest = location;
        distanceMeters = distance;
      }
    }
    return nearest ? { location: nearest, distanceMeters } : null;
  };
  const getTimeClockStateWindowStart = (
    dayStart: Date,
    shifts: Array<{ startTime: string | Date | null }>,
  ) => {
    const shiftStarts = shifts
      .map((shift) => toDateTime(shift.startTime))
      .filter((date): date is Date => Boolean(date));
    if (shiftStarts.length === 0) return dayStart;
    return new Date(Math.min(dayStart.getTime(), ...shiftStarts.map((date) => date.getTime())));
  };
  const getTimeClockState = (
    entries: Array<{ eventType: string; status?: string | null; eventTime: string | Date | null }>,
    shifts: Array<{ startTime: string | Date | null; endTime: string | Date | null }> = [],
  ): TimeClockState => {
    const validEntries = entries
      .filter((entry) => entry.status === "valid" || entry.status === "manual_adjusted" || entry.status === "pending_approval")
      .slice()
      .sort((left, right) => Number(toDateTime(left.eventTime)?.getTime() ?? 0) - Number(toDateTime(right.eventTime)?.getTime() ?? 0));
    const lastEntry = validEntries[validEntries.length - 1];
    const clockInCount = validEntries.filter((entry) => entry.eventType === "clock_in").length;
    const scheduledShiftCount = shifts.filter((shift) => toDateTime(shift.startTime) && toDateTime(shift.endTime)).length;
    const canStartShift = !lastEntry
      || (scheduledShiftCount === 0 ? true : clockInCount < scheduledShiftCount);
    if (!lastEntry) {
      return { state: "closed", nextActions: ["clock_in"] };
    }
    if (lastEntry.eventType === "clock_out") {
      return canStartShift
        ? { state: "closed", nextActions: ["clock_in"] }
        : {
          state: "closed",
          nextActions: [],
          message: "Jornada do dia concluida. Nova entrada apenas com outra escala prevista.",
        };
    }
    if (lastEntry.eventType === "break_start") {
      return { state: "on_break", nextActions: ["break_end"] };
    }
    if (lastEntry.eventType === "clock_in" || lastEntry.eventType === "break_end") {
      return { state: "working", nextActions: ["break_start", "clock_out"] };
    }
    return { state: "closed", nextActions: ["clock_in"] };
  };
  const summarizeTimeClockEntries = (
    entries: Array<any>,
    shifts: Array<any>,
    monthStart: Date,
    monthEnd: Date,
    settings: TimeClockSettings = DEFAULT_ENVIRONMENT_SETTINGS.timeClock,
  ) => {
    type DailySummary = {
      key: string;
      date: string;
      staffId: number;
      staffName: string | null;
      expectedMinutes: number;
      workedMinutes: number;
      balanceMinutes: number;
      lateMinutes: number;
      overtimeMinutes: number;
      nightMinutes: number;
      absence: boolean;
      incomplete: boolean;
      expectedStart: Date | null;
      expectedEnd: Date | null;
      firstClockIn: Date | null;
      lastClockOut: Date | null;
    };
    const summaries = new Map<string, DailySummary>();
    const ensureSummary = (staffId: number, date: string, staffName?: string | null) => {
      const key = `${staffId}:${date}`;
      const existing = summaries.get(key);
      if (existing) {
        if (!existing.staffName && staffName) existing.staffName = staffName;
        return existing;
      }
      const created: DailySummary = {
        key,
        date,
        staffId,
        staffName: staffName ?? null,
        expectedMinutes: 0,
        workedMinutes: 0,
        balanceMinutes: 0,
        lateMinutes: 0,
        overtimeMinutes: 0,
        nightMinutes: 0,
        absence: false,
        incomplete: false,
        expectedStart: null,
        expectedEnd: null,
        firstClockIn: null,
        lastClockOut: null,
      };
      summaries.set(key, created);
      return created;
    };

    for (const shift of shifts) {
      const shiftStart = toDateTime(shift.startTime);
      const shiftEnd = toDateTime(shift.endTime);
      if (!shiftStart || !shiftEnd) continue;
      const cursor = new Date(Math.max(shiftStart.getTime(), monthStart.getTime()));
      cursor.setHours(0, 0, 0, 0);
      const finalDay = new Date(Math.min(shiftEnd.getTime(), monthEnd.getTime()));
      finalDay.setHours(0, 0, 0, 0);
      while (cursor.getTime() <= finalDay.getTime()) {
        const dayStart = new Date(cursor);
        const dayEnd = new Date(cursor);
        dayEnd.setHours(23, 59, 59, 999);
        const overlapStart = new Date(Math.max(shiftStart.getTime(), dayStart.getTime(), monthStart.getTime()));
        const overlapEnd = new Date(Math.min(shiftEnd.getTime(), dayEnd.getTime(), monthEnd.getTime()));
        if (overlapEnd.getTime() > overlapStart.getTime()) {
          const summary = ensureSummary(shift.staffId, toDateOnly(dayStart), shift.staffName);
          summary.expectedMinutes += minutesBetween(overlapStart, overlapEnd);
          if (!summary.expectedStart || overlapStart.getTime() < summary.expectedStart.getTime()) {
            summary.expectedStart = overlapStart;
          }
          if (!summary.expectedEnd || overlapEnd.getTime() > summary.expectedEnd.getTime()) {
            summary.expectedEnd = overlapEnd;
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const entryGroups = new Map<string, any[]>();
    entries.forEach((entry) => {
      const eventTime = toDateTime(entry.eventTime);
      if (!eventTime) return;
      const date = toDateOnly(eventTime);
      const key = `${entry.staffId}:${date}`;
      const group = entryGroups.get(key) ?? [];
      group.push(entry);
      entryGroups.set(key, group);
      ensureSummary(entry.staffId, date, entry.staffName);
    });

    Array.from(entryGroups.entries()).forEach(([key, group]) => {
      const summary = summaries.get(key);
      if (!summary) return;
      const sorted = group
        .filter((entry: any) => entry.status === "valid" || entry.status === "manual_adjusted")
        .sort((left: any, right: any) => Number(toDateTime(left.eventTime)?.getTime() ?? 0) - Number(toDateTime(right.eventTime)?.getTime() ?? 0));
      let activeStart: Date | null = null;
      for (const entry of sorted) {
        const eventTime = toDateTime(entry.eventTime);
        if (!eventTime) continue;
        if (entry.eventType === "clock_in" || entry.eventType === "break_end") {
          if (entry.eventType === "clock_in" && (!summary.firstClockIn || eventTime.getTime() < summary.firstClockIn.getTime())) {
            summary.firstClockIn = eventTime;
          }
          if (!activeStart) activeStart = eventTime;
        } else if ((entry.eventType === "break_start" || entry.eventType === "clock_out") && activeStart) {
          summary.workedMinutes += minutesBetween(activeStart, eventTime);
          summary.nightMinutes += nightMinutesBetween(activeStart, eventTime, settings);
          if (entry.eventType === "clock_out" && (!summary.lastClockOut || eventTime.getTime() > summary.lastClockOut.getTime())) {
            summary.lastClockOut = eventTime;
          }
          activeStart = null;
        }
      }
      if (activeStart) {
        const dayEnd = parseDateOnly(summary.date, true) ?? monthEnd;
        const now = new Date();
        const cappedEnd = new Date(Math.min(now.getTime(), dayEnd.getTime()));
        summary.workedMinutes += minutesBetween(activeStart, cappedEnd);
        summary.nightMinutes += nightMinutesBetween(activeStart, cappedEnd, settings);
        summary.incomplete = true;
      }
    });

    const todayKey = toDateOnly(new Date());

    const dailySummaries = Array.from(summaries.values())
      .map((summary) => {
        const lateMinutes = summary.expectedStart && summary.firstClockIn
          ? Math.max(0, minutesBetween(summary.expectedStart, summary.firstClockIn) - settings.lateToleranceMinutes)
          : 0;
        const absence = summary.expectedMinutes > 0
          && summary.workedMinutes === 0
          && summary.date < todayKey;
        const balanceMinutes = summary.workedMinutes - summary.expectedMinutes;
        return {
          ...summary,
          balanceMinutes,
          lateMinutes,
          overtimeMinutes: Math.max(0, balanceMinutes - settings.overtimeToleranceMinutes),
          absence,
          expectedStart: summary.expectedStart?.toISOString() ?? null,
          expectedEnd: summary.expectedEnd?.toISOString() ?? null,
          firstClockIn: summary.firstClockIn?.toISOString() ?? null,
          lastClockOut: summary.lastClockOut?.toISOString() ?? null,
        };
      })
      .sort((left, right) => {
        if (left.date !== right.date) return right.date.localeCompare(left.date);
        return String(left.staffName ?? "").localeCompare(String(right.staffName ?? ""), "pt-BR");
      });
    const monthSummary = dailySummaries.reduce(
      (acc, summary) => {
        acc.expectedMinutes += summary.expectedMinutes;
        acc.workedMinutes += summary.workedMinutes;
        acc.balanceMinutes += summary.balanceMinutes;
        acc.lateMinutes += summary.lateMinutes;
        acc.overtimeMinutes += summary.overtimeMinutes;
        acc.nightMinutes += summary.nightMinutes;
        if (summary.absence) acc.absences += 1;
        if (summary.incomplete) acc.incompleteDays += 1;
        return acc;
      },
      { expectedMinutes: 0, workedMinutes: 0, balanceMinutes: 0, incompleteDays: 0, lateMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, absences: 0 },
    );
    return { dailySummaries, monthSummary };
  };
  const resolveTimeClockStaffId = async (orgId: number, sessionUser: SessionUser | undefined, requestedStaffId?: number | null) => {
    if (!sessionUser) throw new Error("Não autorizado.");
    if (sessionUser.role === "admin" || sessionUser.role === "administrativo") {
      return requestedStaffId ?? null;
    }
    const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, sessionUser);
    if (!linkedStaff || linkedStaff.active === false) {
      throw new Error("Seu usuário não está vinculado a um colaborador ativo.");
    }
    if (requestedStaffId && requestedStaffId !== linkedStaff.id) {
      throw new Error("Voce so pode consultar o proprio ponto.");
    }
    return linkedStaff.id;
  };
  const isTimeClockManager = (sessionUser: SessionUser | undefined) =>
    sessionUser?.role === "admin" || sessionUser?.role === "administrativo" || sessionUser?.isSuperAdmin === true;
  const getTimeClockReferenceMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const getTimeClockClosureStatus = async (orgId: number, month: string) => {
    const closure = await storage.getTimeClockClosure(orgId, month);
    return {
      closure,
      closed: closure?.status === "closed",
    };
  };
  const ensureTimeClockMonthOpen = async (orgId: number, month: string) => {
    const { closed } = await getTimeClockClosureStatus(orgId, month);
    if (closed) {
      throw new Error("Competência de ponto já fechada. Reabra o mês para alterar registros.");
    }
  };
  const createTimeClockAuditLog = async (input: {
    orgId: number;
    staffId?: number | null;
    entityType: string;
    entityId?: number | null;
    action: string;
    performedByUserId?: number | null;
    previousValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
  }) => {
    await storage.createTimeClockAuditLog({
      organizationId: input.orgId,
      staffId: input.staffId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      performedByUserId: input.performedByUserId ?? null,
      previousValue: input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
      newValue: input.newValue === undefined ? null : JSON.stringify(input.newValue),
      reason: input.reason ?? null,
    });
  };
  const reverseGeocodeTimeClockLocation = async (latitude: number, longitude: number) => {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(latitude),
      lon: String(longitude),
      addressdetails: "1",
      zoom: "18",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "EasyCare/1.0 reverse-geocoding",
        },
      });
      if (!response.ok) return null;
      const data = await response.json() as {
        name?: string;
        display_name?: string;
        address?: Record<string, string | undefined>;
      };
      const address = data.address ?? {};
      const city = address.city || address.town || address.village || address.municipality;
      const street = address.road || address.pedestrian || address.footway;
      const streetAddress = [
        street && address.house_number ? `${street}, ${address.house_number}` : street,
        address.suburb || address.neighbourhood,
        city,
        address.state,
        address.postcode,
      ].filter(Boolean).join(" - ");
      const name = [
        data.name,
        address.building,
        address.amenity,
        address.office,
        address.healthcare,
        address.shop,
        address.road,
        address.suburb,
        address.neighbourhood,
        address.city,
      ].find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
      const displayName = typeof data.display_name === "string" ? data.display_name.trim() : "";
      return {
        name: name || displayName.split(",")[0]?.trim() || null,
        displayName: displayName || null,
        address: streetAddress || displayName || null,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };
  const fetchJsonWithTimeout = async <T>(url: string, init?: RequestInit, timeoutMs = 7000): Promise<T | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return await response.json() as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };
  const lookupCepAddress = async (cep: string) => {
    const normalizedCep = cep.replace(/\D/g, "");
    if (normalizedCep.length !== 8) return null;
    type CepLookupResult = {
      erro?: boolean;
      cep?: string;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
      latitude?: number | null;
      longitude?: number | null;
      source?: string;
    };
    type AwesomeApiCepResult = {
      code?: string;
      message?: string;
      cep?: string;
      address?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      lat?: string | number | null;
      lng?: string | number | null;
    };
    type BrasilApiCepV2Result = {
      cep?: string;
      state?: string;
      city?: string;
      neighborhood?: string;
      street?: string;
      service?: string;
      location?: {
        coordinates?: {
          latitude?: string | number | null;
          longitude?: string | number | null;
        } | null;
      } | null;
    };
    const parseCoordinate = (value: unknown) => {
      const coordinate = Number(value);
      return Number.isFinite(coordinate) ? coordinate : null;
    };
    const hasCoordinates = (data: CepLookupResult | null) =>
      typeof data?.latitude === "number" && typeof data.longitude === "number";
    const normalizeAwesomeApiResult = (data: AwesomeApiCepResult | null): CepLookupResult | null => {
      if (!data || data.code === "not_found") return null;
      if (!data.address && !data.city && !data.state) return null;
      return {
        cep: data.cep || normalizedCep,
        logradouro: data.address || "",
        bairro: data.neighborhood || "",
        localidade: data.city || "",
        uf: data.state || "",
        latitude: parseCoordinate(data.lat),
        longitude: parseCoordinate(data.lng),
        source: "awesomeapi",
      };
    };
    const normalizeBrasilApiResult = (data: BrasilApiCepV2Result | null): CepLookupResult | null => {
      if (!data) return null;
      if (!data.street && !data.city && !data.state) return null;
      const latitude = parseCoordinate(data.location?.coordinates?.latitude);
      const longitude = parseCoordinate(data.location?.coordinates?.longitude);
      return {
        cep: data.cep || normalizedCep,
        logradouro: data.street || "",
        bairro: data.neighborhood || "",
        localidade: data.city || "",
        uf: data.state || "",
        latitude,
        longitude,
        source: data.service || "brasilapi",
      };
    };
    const normalizeCepResult = (data: CepLookupResult | null): CepLookupResult | null => {
      if (!data || data.erro) return null;
      if (!data.logradouro && !data.localidade && !data.uf) return null;
      return {
        cep: data.cep || normalizedCep,
        logradouro: data.logradouro || "",
        bairro: data.bairro || "",
        localidade: data.localidade || "",
        uf: data.uf || "",
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        source: data.source,
      };
    };
    const awesomeApi = normalizeAwesomeApiResult(await fetchJsonWithTimeout<AwesomeApiCepResult>(
      `https://cep.awesomeapi.com.br/json/${normalizedCep}`,
    ));
    if (hasCoordinates(awesomeApi)) return awesomeApi;
    const brasilApi = normalizeBrasilApiResult(await fetchJsonWithTimeout<BrasilApiCepV2Result>(
      `https://brasilapi.com.br/api/cep/v2/${normalizedCep}`,
    ));
    if (hasCoordinates(brasilApi)) return brasilApi;
    if (awesomeApi) return awesomeApi;
    if (brasilApi) return brasilApi;
    const viaCep = normalizeCepResult(await fetchJsonWithTimeout<CepLookupResult>(
      `https://viacep.com.br/ws/${normalizedCep}/json/`,
    ));
    if (viaCep) return viaCep;
    return normalizeCepResult(await fetchJsonWithTimeout<CepLookupResult>(
      `https://opencep.com/v1/${normalizedCep}.json`,
    ));
  };
  const formatTimeClockCepAddress = (cepAddress: NonNullable<Awaited<ReturnType<typeof lookupCepAddress>>>, number?: string | null) => {
    const trimmedNumber = number?.trim();
    const street = cepAddress.logradouro?.trim();
    const streetLine = street && trimmedNumber ? `${street}, ${trimmedNumber}` : street;
    return [
      streetLine,
      cepAddress.bairro,
      [cepAddress.localidade, cepAddress.uf].filter(Boolean).join("/"),
      cepAddress.cep,
    ].filter((part) => typeof part === "string" && part.trim().length > 0).join(" - ");
  };
  const geocodeTimeClockAddress = async (input: z.infer<typeof timeClockAddressInputSchema>) => {
    const cepAddress = input.cep ? await lookupCepAddress(input.cep) : null;
    const number = input.number?.trim();
    const typedAddress = input.address?.trim();
    const cepStreet = cepAddress?.logradouro?.trim();
    const addressLine = cepStreet
      ? `${cepStreet}${number ? `, ${number}` : ""}`
      : [typedAddress, number].filter(Boolean).join(", ");
    const cityState = [
      cepAddress?.bairro,
      cepAddress?.localidade,
      cepAddress?.uf,
    ].filter(Boolean).join(" - ");
    const fullAddress = cepAddress
      ? formatTimeClockCepAddress(cepAddress, number)
      : [
        addressLine,
        cityState,
        input.cep,
      ].filter((part) => typeof part === "string" && part.trim().length > 0).join(" - ");
    const query = [
      addressLine || typedAddress,
      cepAddress?.bairro,
      cepAddress?.localidade,
      cepAddress?.uf,
      "Brasil",
    ].filter((part) => typeof part === "string" && part.trim().length > 0).join(", ");
    const cepLatitude = cepAddress?.latitude ?? null;
    const cepLongitude = cepAddress?.longitude ?? null;
    const cepLocationResult = Number.isFinite(cepLatitude) && Number.isFinite(cepLongitude)
      ? {
        latitude: Number(cepLatitude),
        longitude: Number(cepLongitude),
        name: cepStreet || typedAddress || fullAddress || null,
        address: fullAddress || null,
        displayName: fullAddress || null,
      }
      : null;
    const params = new URLSearchParams({
      format: "jsonv2",
      addressdetails: "1",
      limit: "1",
      countrycodes: "br",
      q: query,
    });
    const results = await fetchJsonWithTimeout<Array<{
      lat: string;
      lon?: string;
      name?: string;
      display_name?: string;
      address?: Record<string, string | undefined>;
    }>>(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "EasyCare/1.0 address-geocoding",
      },
    });
    const first = results?.[0];
    const latitude = first?.lat ? Number(first.lat) : NaN;
    const longitude = first?.lon ? Number(first.lon) : NaN;
    if (!first || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return cepLocationResult;

    const foundAddress = first.address ?? {};
    const foundCity = foundAddress.city || foundAddress.town || foundAddress.village || foundAddress.municipality;
    const foundStreet = foundAddress.road || foundAddress.pedestrian || foundAddress.footway;
    const resolvedAddress = [
      foundStreet && foundAddress.house_number ? `${foundStreet}, ${foundAddress.house_number}` : foundStreet,
      foundAddress.suburb || foundAddress.neighbourhood,
      foundCity,
      foundAddress.state,
      foundAddress.postcode,
    ].filter(Boolean).join(" - ");
    const displayName = typeof first.display_name === "string" ? first.display_name.trim() : "";
    const name = [
      first.name,
      foundAddress.building,
      foundAddress.amenity,
      foundAddress.office,
      foundStreet,
      foundAddress.suburb,
    ].find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
    return {
      latitude,
      longitude,
      name: name || addressLine || displayName.split(",")[0]?.trim() || null,
      address: resolvedAddress || fullAddress || displayName || null,
      displayName: displayName || null,
    };
  };

  app.get("/api/time-clock/lookup-cep", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      if (!req.session.user?.isSuperAdmin && req.session.user?.role !== "admin") {
        return res.status(403).json({ message: "Apenas admin pode consultar CEP de local." });
      }
      const cep = String(req.query.cep || "");
      const number = typeof req.query.number === "string" ? req.query.number : "";
      const result = await lookupCepAddress(cep);
      if (!result) return res.status(404).json({ message: "CEP não encontrado." });
      res.json({
        cep: result.cep ?? cep.replace(/\D/g, ""),
        street: result.logradouro || null,
        district: result.bairro || null,
        city: result.localidade || null,
        state: result.uf || null,
        latitude: result.latitude ?? null,
        longitude: result.longitude ?? null,
        address: formatTimeClockCepAddress(result, number),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/time-clock/geocode-address", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      if (!req.session.user?.isSuperAdmin && req.session.user?.role !== "admin") {
        return res.status(403).json({ message: "Apenas admin pode buscar endereço de local." });
      }
      const input = timeClockAddressInputSchema.parse(req.query);
      const result = await geocodeTimeClockAddress(input);
      if (!result) {
        return res.status(404).json({ message: "Não foi possível localizar este endereço." });
      }
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Endereço inválido." });
      }
      next(error);
    }
  });

  app.get("/api/time-clock/reverse-geocode", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      if (!req.session.user?.isSuperAdmin && req.session.user?.role !== "admin") {
        return res.status(403).json({ message: "Apenas admin pode buscar nome de local." });
      }
      const input = timeClockCoordinateInputSchema.parse(req.query);
      const result = await reverseGeocodeTimeClockLocation(input.latitude, input.longitude);
      res.json({
        latitude: input.latitude,
        longitude: input.longitude,
        name: result?.name ?? null,
        address: result?.address ?? null,
        displayName: result?.displayName ?? null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Coordenada inválida." });
      }
      next(error);
    }
  });

  app.get("/api/time-clock/locations", requireAuth, requireRole(...TIME_CLOCK_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      res.json(await storage.getTimeClockLocations(orgId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/time-clock/locations", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      if (!req.session.user?.isSuperAdmin && req.session.user?.role !== "admin") {
        return res.status(403).json({ message: "Apenas admin pode configurar locais de ponto." });
      }
      const orgId = getOrgId(req);
      const input = timeClockLocationInputSchema.parse(req.body);
      const created = await storage.createTimeClockLocation({
        ...input,
        address: input.address?.trim() || null,
        organizationId: orgId,
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      next(error);
    }
  });

  app.put("/api/time-clock/locations/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      if (!req.session.user?.isSuperAdmin && req.session.user?.role !== "admin") {
        return res.status(403).json({ message: "Apenas admin pode configurar locais de ponto." });
      }
      const orgId = getOrgId(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Local inválido." });
      const input = timeClockLocationInputSchema.partial().parse(req.body);
      const updated = await storage.updateTimeClockLocation(orgId, id, {
        ...input,
        ...(input.address !== undefined ? { address: input.address?.trim() || null } : {}),
      });
      if (!updated) return res.status(404).json({ message: "Local não encontrado." });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      next(error);
    }
  });

  app.get("/api/time-clock/status", requireAuth, requireRole(...TIME_CLOCK_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const sessionUser = req.session.user;
      const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, sessionUser);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart);
      todayEnd.setHours(23, 59, 59, 999);
      const todayShifts = linkedStaff
        ? await storage.getShiftAssignments(orgId, { staffId: linkedStaff.id, start: todayStart, end: todayEnd })
        : [];
      const stateStart = getTimeClockStateWindowStart(todayStart, todayShifts);
      const stateEntries = linkedStaff
        ? await storage.getTimeClockEntries(orgId, { staffId: linkedStaff.id, start: stateStart, end: todayEnd })
        : [];
      const todayEntries = stateEntries.filter((entry) => {
        const eventTime = toDateTime(entry.eventTime);
        return eventTime && eventTime.getTime() >= todayStart.getTime() && eventTime.getTime() <= todayEnd.getTime();
      });
      res.json({
        staff: linkedStaff
          ? { id: linkedStaff.id, name: linkedStaff.name, role: linkedStaff.role }
          : null,
        current: getTimeClockState(stateEntries, todayShifts),
        todayEntries,
        hasShiftToday: todayShifts.length > 0,
        shiftCountToday: todayShifts.length,
        locations: await storage.getTimeClockLocations(orgId),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/time-clock/entries", requireAuth, requireRole(...TIME_CLOCK_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const month = timeClockMonthSchema.parse(String(req.query.month || toDateOnly(new Date()).slice(0, 7)));
      const staffId = req.query.staffId ? Number(req.query.staffId) : null;
      if (staffId !== null && (!Number.isInteger(staffId) || staffId <= 0)) {
        return res.status(400).json({ message: "Colaborador inválido." });
      }
      const effectiveStaffId = await resolveTimeClockStaffId(orgId, req.session.user, staffId);
      const environmentSettings = (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const range = getTimeClockMonthRange(month);
      const [entries, shifts] = await Promise.all([
        storage.getTimeClockEntries(orgId, { staffId: effectiveStaffId ?? undefined, start: range.start, end: range.end }),
        storage.getShiftAssignments(orgId, { staffId: effectiveStaffId ?? undefined, start: range.start, end: range.end }),
      ]);
      const summary = summarizeTimeClockEntries(entries, shifts, range.start, range.end, environmentSettings.timeClock);
      const closure = await storage.getTimeClockClosure(orgId, month);
      res.json({ month, entries, closure: closure ?? null, settings: environmentSettings.timeClock, ...summary });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  app.patch("/api/time-clock/entries/:id/review", requireAuth, requireRole("admin", "administrativo"), async (req, res, next) => {
    try {
      if (!isTimeClockManager(req.session.user)) {
        return res.status(403).json({ message: "Apenas gestor pode revisar batidas pendentes." });
      }
      const orgId = getOrgId(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Batida inválida." });
      const input = timeClockEntryReviewSchema.parse(req.body);
      const current = await storage.getTimeClockEntry(orgId, id);
      if (!current) return res.status(404).json({ message: "Batida não encontrada." });
      if (current.status !== "pending_approval") {
        return res.status(400).json({ message: "Batida não está pendente de aprovação." });
      }
      await ensureTimeClockMonthOpen(orgId, getTimeClockReferenceMonth(new Date(current.eventTime)));
      const reviewNote = input.reviewerNotes?.trim() || null;
      const updated = await storage.updateTimeClockEntry(orgId, id, {
        status: input.status === "approved" ? "valid" : "rejected",
        notes: [
          current.notes,
          input.status === "approved" ? "Aprovado pelo gestor." : "Reprovado pelo gestor.",
          reviewNote,
        ].filter(Boolean).join(" | ") || null,
      });
      await createTimeClockAuditLog({
        orgId,
        staffId: current.staffId,
        entityType: "time_clock_entry",
        entityId: id,
        action: input.status === "approved" ? "approved" : "rejected",
        performedByUserId: req.session.user?.id ?? null,
        previousValue: current,
        newValue: updated,
        reason: reviewNote,
      });
      const reviewedEventLabel = TIME_CLOCK_EVENT_LABELS[current.eventType as TimeClockEventType] ?? "Batida";
      const reviewStatusLabel = input.status === "approved" ? "aprovada" : "reprovada";
      await notifyUsers(
        orgId,
        [
          current.userId,
          ...(await resolveNotificationUserIdsForStaff(orgId, current.staffId)),
        ],
        {
          staffId: current.staffId,
          type: "time_clock_entry_reviewed",
          severity: input.status === "approved" ? "success" : "warning",
          sourceModule: "time_clock",
          title: `Batida ${reviewStatusLabel}`,
          message: `${reviewedEventLabel} de ${formatNotificationDateTime(new Date(current.eventTime))} foi ${reviewStatusLabel} pelo gestor.`,
          actionUrl: buildTimeClockActionUrl({
            entryId: id,
            staffId: current.staffId,
            month: getTimeClockReferenceMonth(new Date(current.eventTime)),
          }),
          entityType: "time_clock_entry",
          entityId: id,
          metadata: { eventType: current.eventType, status: input.status, reviewerNotes: reviewNote },
        },
      );
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error instanceof Error) return res.status(400).json({ message: error.message });
      next(error);
    }
  });

  app.get("/api/time-clock/adjustments", requireAuth, requireRole(...TIME_CLOCK_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const month = timeClockMonthSchema.parse(String(req.query.month || toDateOnly(new Date()).slice(0, 7)));
      const requestedStaffId = req.query.staffId ? Number(req.query.staffId) : null;
      if (requestedStaffId !== null && (!Number.isInteger(requestedStaffId) || requestedStaffId <= 0)) {
        return res.status(400).json({ message: "Colaborador inválido." });
      }
      const effectiveStaffId = await resolveTimeClockStaffId(orgId, req.session.user, requestedStaffId);
      const range = getTimeClockMonthRange(month);
      const status = typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : undefined;
      const adjustments = await storage.getTimeClockAdjustmentRequests(orgId, {
        staffId: effectiveStaffId ?? undefined,
        status,
        start: range.start,
        end: range.end,
      });
      res.json(adjustments);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error instanceof Error) return res.status(400).json({ message: error.message });
      next(error);
    }
  });

  app.post("/api/time-clock/adjustments", requireAuth, requireRole(...TIME_CLOCK_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const sessionUser = req.session.user;
      const input = timeClockAdjustmentInputSchema.parse(req.body);
      const effectiveStaffId = await resolveTimeClockStaffId(orgId, sessionUser, input.staffId ?? null);
      if (!effectiveStaffId) {
        return res.status(400).json({ message: "Selecione o colaborador do ajuste." });
      }
      await ensureTimeClockMonthOpen(orgId, getTimeClockReferenceMonth(input.requestedEventTime));
      const created = await storage.createTimeClockAdjustmentRequest({
        organizationId: orgId,
        staffId: effectiveStaffId,
        requestedByUserId: sessionUser?.id ?? null,
        entryId: input.entryId ?? null,
        eventType: input.eventType,
        requestedEventTime: input.requestedEventTime,
        reason: input.reason,
        notes: input.notes?.trim() || null,
        status: "pending",
        reviewedByUserId: null,
        reviewedAt: null,
        reviewerNotes: null,
        appliedEntryId: null,
      });
      await createTimeClockAuditLog({
        orgId,
        staffId: effectiveStaffId,
        entityType: "time_clock_adjustment_request",
        entityId: created.id,
        action: "requested",
        performedByUserId: sessionUser?.id ?? null,
        newValue: created,
        reason: input.reason,
      });
      const adjustedStaff = await storage.getStaffMember(orgId, effectiveStaffId);
      const requestedEventLabel = TIME_CLOCK_EVENT_LABELS[input.eventType] ?? "Batida";
      await notifyTimeClockManagers(orgId, {
        staffId: effectiveStaffId,
        type: "time_clock_adjustment_pending",
        severity: "warning",
        title: "Ajuste de ponto solicitado",
        message: `${adjustedStaff?.name ?? "Colaborador"} solicitou ajuste de ${requestedEventLabel.toLowerCase()} em ${formatNotificationDateTime(input.requestedEventTime)}.`,
        actionUrl: buildTimeClockActionUrl({
          adjustmentId: created.id,
          staffId: effectiveStaffId,
          month: getTimeClockReferenceMonth(input.requestedEventTime),
        }),
        entityType: "time_clock_adjustment_request",
        entityId: created.id,
        metadata: { eventType: input.eventType, reason: input.reason },
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error instanceof Error) return res.status(400).json({ message: error.message });
      next(error);
    }
  });

  app.patch("/api/time-clock/adjustments/:id/review", requireAuth, requireRole("admin", "administrativo"), async (req, res, next) => {
    try {
      if (!isTimeClockManager(req.session.user)) {
        return res.status(403).json({ message: "Apenas gestor pode revisar ajustes." });
      }
      const orgId = getOrgId(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Solicitação inválida." });
      const input = timeClockAdjustmentReviewSchema.parse(req.body);
      const current = await storage.getTimeClockAdjustmentRequest(orgId, id);
      if (!current) return res.status(404).json({ message: "Solicitação não encontrada." });
      if (current.status !== "pending") return res.status(400).json({ message: "Solicitação já revisada." });
      await ensureTimeClockMonthOpen(orgId, getTimeClockReferenceMonth(new Date(current.requestedEventTime)));

      const sourceEntry = current.entryId
        ? await storage.getTimeClockEntry(orgId, current.entryId)
        : null;
      if (current.entryId && !sourceEntry) {
        return res.status(404).json({ message: "Batida original da correção não encontrada." });
      }
      if (sourceEntry && sourceEntry.staffId !== current.staffId) {
        return res.status(400).json({ message: "Batida original pertence a outro colaborador." });
      }

      let appliedEntryId: number | null = null;
      if (input.status === "approved") {
        if (sourceEntry) {
          const replacedSourceEntry = await storage.updateTimeClockEntry(orgId, sourceEntry.id, {
            status: "corrected",
            notes: `${sourceEntry.notes ? `${sourceEntry.notes}\n` : ""}Corrigida pelo ajuste aprovado #${current.id}.`,
          });
          await createTimeClockAuditLog({
            orgId,
            staffId: current.staffId,
            entityType: "time_clock_entry",
            entityId: sourceEntry.id,
            action: "replaced_by_adjustment",
            performedByUserId: req.session.user?.id ?? null,
            previousValue: sourceEntry,
            newValue: replacedSourceEntry,
            reason: input.reviewerNotes || current.reason,
          });
        }

        const entry = await storage.createTimeClockEntry({
          organizationId: orgId,
          staffId: current.staffId,
          userId: req.session.user?.id ?? null,
          locationId: sourceEntry?.locationId ?? null,
          eventType: current.eventType,
          eventTime: new Date(current.requestedEventTime),
          latitude: sourceEntry?.latitude ?? null,
          longitude: sourceEntry?.longitude ?? null,
          accuracy: sourceEntry?.accuracy ?? null,
          distanceMeters: sourceEntry?.distanceMeters ?? null,
          geofenceRadiusMeters: sourceEntry?.geofenceRadiusMeters ?? null,
          status: "manual_adjusted",
          notes: [
            `Ajuste aprovado #${current.id}: ${current.reason}`,
            current.notes,
            sourceEntry
              ? `Substitui batida #${sourceEntry.id} (${TIME_CLOCK_EVENT_LABELS[sourceEntry.eventType as TimeClockEventType] ?? sourceEntry.eventType} - ${formatNotificationDateTime(new Date(sourceEntry.eventTime))}).`
              : null,
          ].filter(Boolean).join(" | "),
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? null,
        });
        appliedEntryId = entry.id;
        await createTimeClockAuditLog({
          orgId,
          staffId: current.staffId,
          entityType: "time_clock_entry",
          entityId: entry.id,
          action: "manual_entry_created",
          performedByUserId: req.session.user?.id ?? null,
          newValue: entry,
          reason: input.reviewerNotes || current.reason,
        });
      }

      const updated = await storage.updateTimeClockAdjustmentRequest(orgId, id, {
        status: input.status,
        reviewedByUserId: req.session.user?.id ?? null,
        reviewedAt: new Date(),
        reviewerNotes: input.reviewerNotes?.trim() || null,
        appliedEntryId,
      });
      await createTimeClockAuditLog({
        orgId,
        staffId: current.staffId,
        entityType: "time_clock_adjustment_request",
        entityId: id,
        action: input.status,
        performedByUserId: req.session.user?.id ?? null,
        previousValue: current,
        newValue: updated,
        reason: input.reviewerNotes || null,
      });
      const adjustmentEventLabel = TIME_CLOCK_EVENT_LABELS[current.eventType as TimeClockEventType] ?? "Batida";
      const adjustmentStatusLabel = input.status === "approved" ? "aprovado" : "reprovado";
      await notifyUsers(
        orgId,
        [
          current.requestedByUserId,
          ...(await resolveNotificationUserIdsForStaff(orgId, current.staffId)),
        ],
        {
          staffId: current.staffId,
          type: "time_clock_adjustment_reviewed",
          severity: input.status === "approved" ? "success" : "warning",
          sourceModule: "time_clock",
          title: `Ajuste ${adjustmentStatusLabel}`,
          message: `Seu ajuste de ${adjustmentEventLabel.toLowerCase()} em ${formatNotificationDateTime(new Date(current.requestedEventTime))} foi ${adjustmentStatusLabel}.`,
          actionUrl: buildTimeClockActionUrl({
            entryId: appliedEntryId ?? current.entryId ?? null,
            adjustmentId: id,
            staffId: current.staffId,
            month: getTimeClockReferenceMonth(new Date(current.requestedEventTime)),
          }),
          entityType: "time_clock_adjustment_request",
          entityId: id,
          metadata: { eventType: current.eventType, status: input.status, reviewerNotes: input.reviewerNotes ?? null },
        },
      );
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error instanceof Error) return res.status(400).json({ message: error.message });
      next(error);
    }
  });

  app.get("/api/time-clock/audit", requireAuth, requireRole("admin", "administrativo"), async (req, res, next) => {
    try {
      if (!isTimeClockManager(req.session.user)) {
        return res.status(403).json({ message: "Apenas gestor pode consultar auditoria." });
      }
      const orgId = getOrgId(req);
      const month = timeClockMonthSchema.parse(String(req.query.month || toDateOnly(new Date()).slice(0, 7)));
      const staffId = req.query.staffId ? Number(req.query.staffId) : null;
      if (staffId !== null && (!Number.isInteger(staffId) || staffId <= 0)) {
        return res.status(400).json({ message: "Colaborador inválido." });
      }
      const range = getTimeClockMonthRange(month);
      const logs = await storage.getTimeClockAuditLogs(orgId, {
        staffId: staffId ?? undefined,
        start: range.start,
        end: range.end,
      });
      res.json(logs);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      next(error);
    }
  });

  app.get("/api/time-clock/closure", requireAuth, requireRole(...TIME_CLOCK_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const month = timeClockMonthSchema.parse(String(req.query.month || toDateOnly(new Date()).slice(0, 7)));
      const closure = await storage.getTimeClockClosure(orgId, month);
      res.json({ month, closure: closure ?? null, closed: closure?.status === "closed" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Mês inválido." });
      }
      next(error);
    }
  });

  app.post("/api/time-clock/closures", requireAuth, requireRole("admin", "administrativo"), async (req, res, next) => {
    try {
      if (!isTimeClockManager(req.session.user)) {
        return res.status(403).json({ message: "Apenas gestor pode fechar ponto." });
      }
      const orgId = getOrgId(req);
      const input = timeClockClosureInputSchema.parse(req.body);
      const current = await storage.getTimeClockClosure(orgId, input.month);
      let closure;
      if (input.action === "close") {
        const range = getTimeClockMonthRange(input.month);
        const environmentSettings = (res.locals.environmentSettings as EnvironmentSettings | undefined)
          ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
          ?? DEFAULT_ENVIRONMENT_SETTINGS;
        const pendingAdjustments = await storage.getTimeClockAdjustmentRequests(orgId, {
          status: "pending",
          start: range.start,
          end: range.end,
        });
        const [entries, shifts, auditLogs] = await Promise.all([
          storage.getTimeClockEntries(orgId, { start: range.start, end: range.end }),
          storage.getShiftAssignments(orgId, { start: range.start, end: range.end }),
          storage.getTimeClockAuditLogs(orgId, { start: range.start, end: range.end }),
        ]);
        const summary = summarizeTimeClockEntries(entries, shifts, range.start, range.end, environmentSettings.timeClock);
        const outOfRangeAttempts = auditLogs.filter((log: any) => log.action === "out_of_range_attempt").length;
        const pendingApprovalEntries = entries.filter((entry: any) => entry.status === "pending_approval").length;
        const closureBlockers: string[] = [];
        if (summary.dailySummaries.length === 0) closureBlockers.push("Não há dados de ponto no mês.");
        if (pendingAdjustments.length > 0) closureBlockers.push("Resolva os ajustes pendentes antes de fechar.");
        if (pendingApprovalEntries > 0) closureBlockers.push("Existem batidas sem escala aguardando aprovação.");
        if (environmentSettings.timeClock.blockCloseWithIncompleteDays && summary.monthSummary.incompleteDays > 0) {
          closureBlockers.push("Existem jornadas incompletas.");
        }
        if (environmentSettings.timeClock.blockCloseWithAbsences && summary.monthSummary.absences > 0) {
          closureBlockers.push("Existem faltas no período.");
        }
        if (environmentSettings.timeClock.blockCloseWithOutOfRangeAttempts && outOfRangeAttempts > 0) {
          closureBlockers.push("Existem tentativas fora do raio no período.");
        }
        if (closureBlockers.length > 0) {
          return res.status(400).json({ message: closureBlockers.join(" ") });
        }
        closure = current
          ? await storage.updateTimeClockClosure(orgId, current.id, {
            status: "closed",
            notes: input.notes?.trim() || current.notes,
            closedByUserId: req.session.user?.id ?? null,
            closedAt: new Date(),
            reopenedByUserId: null,
            reopenedAt: null,
          })
          : await storage.createTimeClockClosure({
            organizationId: orgId,
            referenceMonth: input.month,
            status: "closed",
            notes: input.notes?.trim() || null,
            closedByUserId: req.session.user?.id ?? null,
            closedAt: new Date(),
            reopenedByUserId: null,
            reopenedAt: null,
          });
      } else {
        if (!current) return res.status(404).json({ message: "Competência ainda não foi fechada." });
        closure = await storage.updateTimeClockClosure(orgId, current.id, {
          status: "reopened",
          notes: input.notes?.trim() || current.notes,
          reopenedByUserId: req.session.user?.id ?? null,
          reopenedAt: new Date(),
        });
      }
      await createTimeClockAuditLog({
        orgId,
        entityType: "time_clock_closure",
        entityId: closure.id,
        action: input.action === "close" ? "closed" : "reopened",
        performedByUserId: req.session.user?.id ?? null,
        previousValue: current ?? null,
        newValue: closure,
        reason: input.notes || null,
      });
      res.json(closure);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      next(error);
    }
  });

  app.post("/api/time-clock/punch", requireAuth, requireRole(...TIME_CLOCK_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const sessionUser = req.session.user;
      const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, sessionUser);
      if (!linkedStaff || linkedStaff.active === false) {
        return res.status(400).json({ message: "Seu usuário não está vinculado a um colaborador ativo." });
      }

      const input = timeClockPunchInputSchema.parse(req.body);
      const eventTime = new Date();
      await ensureTimeClockMonthOpen(orgId, getTimeClockReferenceMonth(eventTime));
      const locations = await storage.getTimeClockLocations(orgId);
      const nearest = getNearestTimeClockLocation(locations, input.latitude, input.longitude);
      if (!nearest) {
        return res.status(400).json({ message: "Nenhum local autorizado ativo configurado para o ponto." });
      }

      const todayStart = new Date(eventTime);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart);
      todayEnd.setHours(23, 59, 59, 999);
      const todayShifts = await storage.getShiftAssignments(orgId, {
        staffId: linkedStaff.id,
        start: todayStart,
        end: todayEnd,
      });
      const stateStart = getTimeClockStateWindowStart(todayStart, todayShifts);
      const stateEntries = await storage.getTimeClockEntries(orgId, {
        staffId: linkedStaff.id,
        start: stateStart,
        end: todayEnd,
      });
      const current = getTimeClockState(stateEntries, todayShifts);
      if (!current.nextActions.includes(input.eventType)) {
        return res.status(400).json({
          message: current.message || "Acao de ponto inválida para o estado atual da jornada.",
        });
      }
      const previousStateEntry = getLastTimeClockStateEntry(stateEntries);
      const openBreakEntry = input.eventType === "break_end" && previousStateEntry?.eventType === "break_start"
        ? previousStateEntry
        : null;
      const shouldLoadTimeClockSettings =
        input.eventType === "clock_in"
        || input.eventType === "break_start"
        || input.eventType === "break_end";
      const timeClockSettings = shouldLoadTimeClockSettings
        ? await getTimeClockSettingsForRequest(orgId, res.locals.environmentSettings as EnvironmentSettings | undefined)
        : null;

      const roundedDistance = Math.round(nearest.distanceMeters);
      const allowed = nearest.distanceMeters <= nearest.location.radiusMeters;
      const requiresApproval = todayShifts.length === 0;
      const entryPayload = {
        organizationId: orgId,
        staffId: linkedStaff.id,
        userId: sessionUser?.id ?? null,
        locationId: nearest.location.id,
        eventType: input.eventType,
        eventTime,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        distanceMeters: roundedDistance,
        geofenceRadiusMeters: nearest.location.radiusMeters,
        status: requiresApproval ? "pending_approval" : "valid",
        notes: [
          requiresApproval ? "Pendente de aprovação: batida registrada sem escala prevista." : null,
          input.notes?.trim() || null,
        ].filter(Boolean).join(" | ") || null,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      };
      if (!allowed) {
        await createTimeClockAuditLog({
          orgId,
          staffId: linkedStaff.id,
          entityType: "time_clock_entry",
          entityId: null,
          action: "out_of_range_attempt",
          performedByUserId: sessionUser?.id ?? null,
          newValue: {
            eventType: input.eventType,
            eventTime: eventTime.toISOString(),
            latitude: input.latitude,
            longitude: input.longitude,
            accuracy: input.accuracy ?? null,
            locationId: nearest.location.id,
            locationName: nearest.location.name,
            distanceMeters: roundedDistance,
            radiusMeters: nearest.location.radiusMeters,
          },
          reason: "Tentativa fora do raio permitido.",
        });
        return res.status(403).json({
          message: `Fora do raio permitido (${roundedDistance}m de distância).`,
          location: nearest.location,
          distanceMeters: roundedDistance,
        });
      }

      const entry = await storage.createTimeClockEntry(entryPayload);
      if (requiresApproval) {
        await createTimeClockAuditLog({
          orgId,
          staffId: linkedStaff.id,
          entityType: "time_clock_entry",
          entityId: entry.id,
          action: "pending_approval_created",
          performedByUserId: sessionUser?.id ?? null,
          newValue: entry,
          reason: "Batida registrada sem escala prevista.",
        });
      }
      const punchEventLabel = TIME_CLOCK_EVENT_LABELS[input.eventType];
      const punchNotificationMessage = buildPunchNotificationMessage({
        eventType: input.eventType,
        eventTime,
        requiresApproval,
        settings: timeClockSettings,
      });
      await notifyUsers(orgId, [sessionUser?.id], {
        staffId: linkedStaff.id,
        type: "time_clock_punch_registered",
        severity: requiresApproval ? "warning" : "success",
        sourceModule: "time_clock",
        title: "Ponto registrado",
        message: punchNotificationMessage,
        actionUrl: buildTimeClockActionUrl({
          entryId: entry.id,
          staffId: linkedStaff.id,
          month: getTimeClockReferenceMonth(eventTime),
        }),
        entityType: "time_clock_entry",
        entityId: entry.id,
        metadata: {
          eventType: input.eventType,
          status: entry.status,
          locationId: nearest.location.id,
          locationName: nearest.location.name,
          distanceMeters: roundedDistance,
        },
      });
      if (requiresApproval) {
        await notifyTimeClockManagers(orgId, {
          staffId: linkedStaff.id,
          type: "time_clock_entry_pending_approval",
          severity: "warning",
          title: "Batida sem escala para revisar",
          message: `${linkedStaff.name} registrou ${punchEventLabel.toLowerCase()} sem escala prevista em ${formatNotificationDateTime(eventTime)}.`,
          actionUrl: buildTimeClockActionUrl({
            entryId: entry.id,
            staffId: linkedStaff.id,
            month: getTimeClockReferenceMonth(eventTime),
          }),
          entityType: "time_clock_entry",
          entityId: entry.id,
          metadata: {
            eventType: input.eventType,
            status: entry.status,
            locationId: nearest.location.id,
            locationName: nearest.location.name,
            distanceMeters: roundedDistance,
          },
        });
      }
      try {
        if (input.eventType === "break_start" && timeClockSettings) {
          await scheduleBreakNotifications({
            orgId,
            sessionUser,
            staffId: linkedStaff.id,
            staffName: linkedStaff.name,
            breakEntryId: entry.id,
            breakStart: eventTime,
            settings: timeClockSettings,
          });
        }
        if (input.eventType === "break_end") {
          await cancelBreakNotifications(orgId, openBreakEntry?.id ?? null);
        }
        if ((input.eventType === "clock_in" || input.eventType === "break_end") && timeClockSettings) {
          await scheduleClockOutMissingNotifications({
            orgId,
            sessionUser,
            staffId: linkedStaff.id,
            staffName: linkedStaff.name,
            triggerEntryId: entry.id,
            eventTime,
            shifts: todayShifts,
            settings: timeClockSettings,
          });
        }
        if (input.eventType === "clock_out") {
          await cancelClockOutMissingNotifications(orgId, linkedStaff.id);
        }
      } catch (notificationError) {
        console.error("[notifications] erro ao agendar/cancelar alertas de pausa", notificationError);
      }
      const nextEntries = [...stateEntries, entry];
      res.status(201).json({
        entry,
        current: getTimeClockState(nextEntries, todayShifts),
        location: nearest.location,
        distanceMeters: roundedDistance,
        message: punchNotificationMessage,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos." });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  // ===== CONTRACTS =====
  app.get("/api/contracts", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getContracts(orgId, req.query.residentId ? Number(req.query.residentId) : undefined));
  });
  app.get("/api/contracts/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const contract = await storage.getContract(orgId, Number(req.params.id));
    if (!contract) return res.status(404).json({ message: "Contrato não encontrado" });
    res.json(contract);
  });
  app.post("/api/contracts", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createContract({ ...req.body, organizationId: orgId }));
  });
  app.put("/api/contracts/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateContract(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/contracts/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteContract(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== MONTHLY FEES =====
  type MonthlyFeeGenerationSummary = {
    month: string;
    totalContracts: number;
    activeContracts: number;
    created: number;
    skippedExisting: number;
    skippedInvalidValue: number;
    skippedInvalidDueDate: number;
  };
  const generateMonthlyFeesInputSchema = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido. Use YYYY-MM."),
  });
  const clampDayInMonth = (year: number, monthNumber: number, day: number) => {
    const maxDay = new Date(year, monthNumber, 0).getDate();
    const normalizedDay = Number.isFinite(day) ? Math.trunc(day) : 1;
    return Math.min(Math.max(1, normalizedDay), maxDay);
  };
  const buildMonthlyFeeDueDate = (referenceMonth: string, paymentDay: unknown) => {
    const [year, monthNumber] = referenceMonth.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      return null;
    }
    const parsedPaymentDay = Number(paymentDay ?? 5);
    const dueDay = clampDayInMonth(year, monthNumber, parsedPaymentDay);
    return `${referenceMonth}-${String(dueDay).padStart(2, "0")}`;
  };
  const isContractActiveInReferenceMonth = (
    contract: {
      status?: string | null;
      startDate?: string | null;
      endDate?: string | null;
    },
    referenceMonth: string,
  ) => {
    if ((contract.status ?? "active") !== "active") return false;
    const [year, monthNumber] = referenceMonth.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      return false;
    }
    const monthStart = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, monthNumber, 0, 23, 59, 59, 999);

    if (!contract.startDate) return false;
    const startDate = parseDateOnly(contract.startDate);
    if (!startDate) return false;

    const endDate = contract.endDate ? parseDateOnly(contract.endDate, true) : null;
    const startsBeforeOrDuringMonth = startDate.getTime() <= monthEnd.getTime();
    const endsAfterOrDuringMonth = !endDate || endDate.getTime() >= monthStart.getTime();
    return startsBeforeOrDuringMonth && endsAfterOrDuringMonth;
  };
  const generateMonthlyFeesForOrganizationMonth = async (
    orgId: number,
    month: string,
  ): Promise<MonthlyFeeGenerationSummary> => {
    const [contracts, monthFees] = await Promise.all([
      storage.getContracts(orgId),
      storage.getMonthlyFees(orgId, { referenceMonth: month }),
    ]);

    const activeContracts = contracts.filter((contract) =>
      isContractActiveInReferenceMonth(contract, month),
    );
    const existingContractIds = new Set(
      monthFees
        .filter((fee) => fee.referenceMonth === month)
        .map((fee) => fee.contractId),
    );

    let created = 0;
    let skippedExisting = 0;
    let skippedInvalidValue = 0;
    let skippedInvalidDueDate = 0;

    for (const contract of activeContracts) {
      if (existingContractIds.has(contract.id)) {
        skippedExisting++;
        continue;
      }

      const amount = roundMoney(Math.max(0, Number(contract.monthlyValue ?? 0)));
      if (!Number.isFinite(amount) || amount <= 0) {
        skippedInvalidValue++;
        continue;
      }

      const dueDate = buildMonthlyFeeDueDate(month, contract.paymentDay);
      if (!dueDate) {
        skippedInvalidDueDate++;
        continue;
      }

      await storage.createMonthlyFee({
        organizationId: orgId,
        contractId: contract.id,
        residentId: contract.residentId,
        referenceMonth: month,
        dueDate,
        amount,
        status: "pending",
        discount: 0,
        fine: 0,
        paymentMethod: contract.paymentMethod ?? null,
        notes: "Gerada automaticamente com base no contrato mensal.",
      });
      existingContractIds.add(contract.id);
      created++;
    }

    return {
      month,
      totalContracts: contracts.length,
      activeContracts: activeContracts.length,
      created,
      skippedExisting,
      skippedInvalidValue,
      skippedInvalidDueDate,
    };
  };
  app.get("/api/monthly-fees", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getMonthlyFees(orgId, {
      contractId: req.query.contractId ? Number(req.query.contractId) : undefined,
      residentId: req.query.residentId ? Number(req.query.residentId) : undefined,
      status: req.query.status as string | undefined,
      referenceMonth: req.query.referenceMonth as string | undefined,
    }));
  });
  app.post("/api/monthly-fees/generate-month", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const input = generateMonthlyFeesInputSchema.parse(req.body);
      const summary = await generateMonthlyFeesForOrganizationMonth(orgId, input.month);
      res.status(201).json(summary);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  });
  app.post("/api/monthly-fees", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createMonthlyFee({ ...req.body, organizationId: orgId }));
  });
  app.put("/api/monthly-fees/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const body = { ...req.body };
    if (body.paidAt && typeof body.paidAt === "string") {
      body.paidAt = new Date(body.paidAt);
    }
    res.json(await storage.updateMonthlyFee(orgId, Number(req.params.id), body));
  });
  app.delete("/api/monthly-fees/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteMonthlyFee(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== ACCOUNTS PAYABLE =====
  app.get("/api/accounts-payable", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getAccountsPayable(orgId, {
      staffId: req.query.staffId ? Number(req.query.staffId) : undefined,
      status: req.query.status as string | undefined,
      referenceMonth: req.query.referenceMonth as string | undefined,
    }));
  });
  app.get("/api/accounts-payable/:id/details", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const payableId = Number(req.params.id);
    if (!Number.isInteger(payableId) || payableId <= 0) {
      return res.status(400).json({ message: "ID inválido." });
    }

    const payable = await storage.getAccountPayable(orgId, payableId);
    if (!payable) {
      return res.status(404).json({ message: "Conta a pagar não encontrada." });
    }

    const noteText = typeof payable.notes === "string" ? payable.notes : "";
    const autoMatch = noteText.match(AUTO_PAYABLE_NOTE_REGEX);
    const manualShiftMatch = noteText.match(MANUAL_PAYABLE_SHIFT_ID_REGEX);
    const isAutoGenerated = Boolean(autoMatch);
    const isManualShiftPayable = noteText.includes(MANUAL_SHIFT_PAYABLE_NOTE_PREFIX);
    const parsedManualShiftId = manualShiftMatch?.[1] ? Number(manualShiftMatch[1]) : NaN;
    const manualShiftId = Number.isInteger(parsedManualShiftId) && parsedManualShiftId > 0
      ? parsedManualShiftId
      : null;
    const parsedReferenceMonth = autoMatch?.[1];
    const parsedStaffId = autoMatch?.[3] ? Number(autoMatch[3]) : undefined;
    const referenceMonth = payable.referenceMonth || parsedReferenceMonth || null;
    const resolvedStaffId = payable.staffId ?? parsedStaffId ?? null;

    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    let shiftsConsidered: Array<{
      id: number;
      startTime: Date;
      endTime: Date;
      shiftType: ShiftAssignmentType;
      notes?: string | null;
    }> = [];

    if (manualShiftId) {
      const shifts = await storage.getShiftAssignments(orgId, {
        staffId: resolvedStaffId ?? undefined,
      });
      const linkedShift = shifts.find((shift) => shift.id === manualShiftId);
      if (linkedShift) {
        const shiftStart = new Date(linkedShift.startTime);
        const shiftEnd = new Date(linkedShift.endTime);
        periodStart = toDateKey(shiftStart);
        periodEnd = toDateKey(shiftEnd);
        shiftsConsidered = [{
          id: linkedShift.id,
          startTime: shiftStart,
          endTime: shiftEnd,
          shiftType: linkedShift.shiftType as ShiftAssignmentType,
          notes: linkedShift.notes,
        }];
      } else if (payable.dueDate) {
        periodStart = payable.dueDate;
        periodEnd = payable.dueDate;
      }
    } else if (resolvedStaffId && referenceMonth) {
      const [year, monthNumber] = referenceMonth.split("-").map(Number);
      if (Number.isFinite(year) && Number.isFinite(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
        const monthStart = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
        const monthEnd = new Date(year, monthNumber, 0, 23, 59, 59, 999);
        periodStart = `${referenceMonth}-01`;
        periodEnd = `${referenceMonth}-${String(monthEnd.getDate()).padStart(2, "0")}`;

        const shiftsInMonth = await storage.getShiftAssignments(orgId, {
          staffId: resolvedStaffId,
          start: monthStart,
          end: monthEnd,
        });

        const idsMatch = noteText.match(AUTO_PAYABLE_IDS_REGEX);
        const consideredIds = idsMatch?.[1]
          ? idsMatch[1]
              .split(",")
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value > 0)
          : [];

        if (consideredIds.length > 0) {
          const idSet = new Set(consideredIds);
          shiftsConsidered = shiftsInMonth
            .filter((shift) => idSet.has(shift.id))
            .map((shift) => ({
              id: shift.id,
              startTime: new Date(shift.startTime),
              endTime: new Date(shift.endTime),
              shiftType: shift.shiftType as ShiftAssignmentType,
              notes: shift.notes,
            }));
        } else if (isAutoGenerated) {
          const monthShiftPrefix = `${AUTO_MONTH_NOTE_PREFIX}${referenceMonth}]`;
          shiftsConsidered = shiftsInMonth
            .filter((shift) => typeof shift.notes === "string" && shift.notes.startsWith(monthShiftPrefix))
            .map((shift) => ({
              id: shift.id,
              startTime: new Date(shift.startTime),
              endTime: new Date(shift.endTime),
              shiftType: shift.shiftType as ShiftAssignmentType,
              notes: shift.notes,
            }));
        } else {
          // Lançamentos manuais sem vínculo explícito não devem puxar todos os plantões do mês.
          if (isManualShiftPayable) {
            shiftsConsidered = [];
          }
          if (!isManualShiftPayable) {
            shiftsConsidered = shiftsInMonth.map((shift) => ({
              id: shift.id,
              startTime: new Date(shift.startTime),
              endTime: new Date(shift.endTime),
              shiftType: shift.shiftType as ShiftAssignmentType,
              notes: shift.notes,
            }));
          }
        }

        shiftsConsidered.sort((left, right) => left.startTime.getTime() - right.startTime.getTime());
      }
    }

    const unitMatch = noteText.match(AUTO_PAYABLE_UNIT_REGEX);
    const parsedUnitValue = unitMatch?.[2] ? Number(unitMatch[2]) : NaN;
    const fallbackUnitValue = shiftsConsidered.length > 0
      ? Number(payable.amount ?? 0) / shiftsConsidered.length
      : 0;
    const resolvedUnitValueRaw = Number.isFinite(parsedUnitValue) ? parsedUnitValue : fallbackUnitValue;
    const unitValue = roundMoney(Math.max(0, Number.isFinite(resolvedUnitValueRaw) ? resolvedUnitValueRaw : 0));
    const totalShifts = shiftsConsidered.length;
    const calculatedTotal = roundMoney(unitValue * totalShifts);

    return res.json({
      id: payable.id,
      status: payable.status,
      title: payable.title,
      category: payable.category,
      referenceMonth,
      dueDate: payable.dueDate,
      paidAt: payable.paidAt,
      paymentMethod: payable.paymentMethod,
      notes: payable.notes,
      amount: payable.amount,
      discount: payable.discount ?? 0,
      extra: payable.extra ?? 0,
      isAutoGenerated,
      staffId: resolvedStaffId,
      staffName: payable.staffName ?? null,
      periodStart,
      periodEnd,
      totalShifts,
      unitValue,
      calculatedTotal,
      shifts: shiftsConsidered.map((shift) => ({
        id: shift.id,
        date: toDateKey(shift.startTime),
        startTime: shift.startTime,
        endTime: shift.endTime,
        shiftType: shift.shiftType,
        shiftTypeLabel: SHIFT_TYPE_LABELS[shift.shiftType] ?? shift.shiftType,
        notes: shift.notes ?? null,
      })),
    });
  });
  app.post("/api/accounts-payable", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createAccountPayable({ ...req.body, organizationId: orgId }));
  });
  app.put("/api/accounts-payable/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const body = { ...req.body };
    if (body.paidAt && typeof body.paidAt === "string") {
      body.paidAt = new Date(body.paidAt);
    }
    res.json(await storage.updateAccountPayable(orgId, Number(req.params.id), body));
  });
  app.delete("/api/accounts-payable/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteAccountPayable(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== CRM (KANBAN) =====
  const normalizeLegacyCrmStage = (value: unknown) => {
    if (typeof value !== "string") return value;
    const normalized = value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized === "lost" ? "no_interest" : normalized;
  };
  const CRM_STAGE_KEY_REGEX = /^[a-z0-9_]{2,40}$/;
  const CRM_STAGE_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
  const crmStageSchema = z.preprocess(
    normalizeLegacyCrmStage,
    z.string().regex(CRM_STAGE_KEY_REGEX, "Etapa inválida."),
  );
  const stageUsesLostReason = (stage?: string | null) => stage === "no_interest";
  const getCrmStageValuesFromSettings = (settings: EnvironmentSettings): string[] =>
    settings.crmKanban.stages.map((stage) => stage.value);
  const loadEnvironmentSettingsForOrg = async (orgId: number) => {
    const settingsResult = await getOrganizationEnvironmentSettings(orgId);
    if (!settingsResult) {
      const error = new Error("Organização não encontrada.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }
    return settingsResult;
  };

  const CRM_FOLLOW_UP_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0][1-9]|[12]\d|3[01])$/;
  const crmFollowUpTaskSchema = z.object({
    id: z.string().trim().min(1).max(80).optional(),
    title: z.string().trim().min(1, "Titulo da tarefa obrigatorio").max(140),
    dueDate: z.string().regex(CRM_FOLLOW_UP_DATE_REGEX, "Data da tarefa inválida. Use YYYY-MM-DD."),
    done: z.boolean().optional().default(false),
    notes: z.string().trim().optional().nullable(),
    assigneeName: z.string().trim().optional().nullable(),
    createdAt: z.string().optional(),
    completedAt: z.string().optional().nullable(),
  });
  const normalizeCrmFollowUpTasks = (tasks: unknown): string => {
    const parsedTasks = z
      .array(crmFollowUpTaskSchema)
      .max(100, "Limite de 100 tarefas de follow-up por oportunidade.")
      .parse(tasks ?? []);
    const nowIso = new Date().toISOString();
    const normalized = parsedTasks.map((task, index) => {
      const parsedCreatedAt = task.createdAt ? new Date(task.createdAt) : null;
      const createdAtIso = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
        ? parsedCreatedAt.toISOString()
        : nowIso;
      const parsedCompletedAt = task.completedAt ? new Date(task.completedAt) : null;
      const completedAtIso = task.done
        ? (parsedCompletedAt && !Number.isNaN(parsedCompletedAt.getTime())
            ? parsedCompletedAt.toISOString()
            : nowIso)
        : null;
      const stableId = task.id && task.id.trim().length > 0
        ? task.id.trim().slice(0, 80)
        : `fu_${Date.now()}_${index + 1}`;
      return {
        id: stableId,
        title: task.title.trim(),
        dueDate: task.dueDate,
        done: Boolean(task.done),
        notes: task.notes?.trim() ? task.notes.trim() : null,
        assigneeName: task.assigneeName?.trim() ? task.assigneeName.trim() : null,
        createdAt: createdAtIso,
        completedAt: completedAtIso,
      };
    });
    return JSON.stringify(normalized);
  };
  const crmCreateSchema = z.object({
    organizationId: z.coerce.number().int().positive().optional(),
    title: z.string().trim().min(2, "Titulo obrigatorio"),
    contactName: z.string().trim().optional().nullable(),
    contactPhone: z.string().trim().optional().nullable(),
    contactEmail: z.string().trim().optional().nullable(),
    source: z.string().trim().optional().nullable(),
    stage: crmStageSchema.optional(),
    amount: z.coerce.number().min(0).optional().default(0),
    expectedCloseDate: z.string().trim().optional().nullable(),
    ownerId: z.coerce.number().int().positive().optional().nullable(),
    ownerStaffId: z.coerce.number().int().positive().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    followUpTasks: z.array(crmFollowUpTaskSchema).optional().default([]),
    lostReason: z.string().trim().optional().nullable(),
    position: z.coerce.number().int().min(0).optional().default(0),
  });
  const crmUpdateSchema = crmCreateSchema.partial();
  const crmMoveSchema = z.object({
    stage: crmStageSchema,
    position: z.coerce.number().int().min(0).optional(),
  });
  const crmKanbanStageSchema = z.object({
    value: crmStageSchema,
    label: z.string().trim().min(1).max(80),
    color: z.string().trim().regex(CRM_STAGE_COLOR_REGEX, "Cor inválida. Use #RRGGBB."),
  });
  const crmStagesUpdateSchema = z.object({
    organizationId: z.coerce.number().int().positive().optional(),
    stages: z.array(crmKanbanStageSchema).min(1).max(20),
  }).superRefine((payload, ctx) => {
    const seen = new Set<string>();
    payload.stages.forEach((stage, index) => {
      const key = stage.value.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "value"],
          message: "Etapa duplicada.",
        });
      } else {
        seen.add(key);
      }
    });
  });
  const crmFollowUpsUpdateSchema = z.object({
    organizationId: z.coerce.number().int().positive().optional(),
    followUpTasks: z.array(crmFollowUpTaskSchema).max(100),
  });
  const crmDateKeySchema = z.string().regex(CRM_FOLLOW_UP_DATE_REGEX, "Data inválida. Use YYYY-MM-DD.");
  const optionalCrmQueryText = (max = 120) =>
    z.preprocess(
      (value) => {
        if (Array.isArray(value)) value = value[0];
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      },
      z.string().max(max).optional(),
    );
  const crmOpportunitiesQuerySchema = z.object({
    organizationId: z.coerce.number().int().positive().optional(),
    stage: crmStageSchema.optional(),
    search: optionalCrmQueryText(140),
    source: optionalCrmQueryText(120),
    ownerId: z.coerce.number().int().positive().optional(),
    ownerStaffId: z.coerce.number().int().positive().optional(),
    expectedCloseFrom: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
      crmDateKeySchema.optional(),
    ),
    expectedCloseTo: z.preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
      crmDateKeySchema.optional(),
    ),
    followUpStatus: z.enum(["pending", "overdue", "today", "none"]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  });
  const assertCrmOwnerStaff = async (orgId: number, ownerStaffId?: number | null) => {
    if (!ownerStaffId) return;
    const member = await storage.getStaffMember(orgId, ownerStaffId);
    if (!member || member.active === false) {
      const error = new Error("Responsável da equipe inválido.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
  };

  app.get("/api/crm/stages", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const orgId = await resolveOrgIdForCrm(req, req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      res.json({
        stages: settingsResult.settings.crmKanban.stages,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/crm/stages", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const parsed = crmStagesUpdateSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, parsed.organizationId ?? req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const currentSettings = settingsResult.settings;
      const previousStageValues = getCrmStageValuesFromSettings(currentSettings);
      const nextSettings = normalizeEnvironmentSettings({
        ...currentSettings,
        crmKanban: {
          stages: parsed.stages,
        },
      });
      const nextStageValues = getCrmStageValuesFromSettings(nextSettings);
      const fallbackStage = nextStageValues[0];
      const removedStageValues = previousStageValues.filter((stage) => !nextStageValues.includes(stage));

      let migratedCount = 0;
      if (removedStageValues.length > 0 && fallbackStage) {
        migratedCount = await storage.reassignCrmOpportunityStages(orgId, removedStageValues, fallbackStage);
      }

      await storage.updateOrganization(orgId, {
        environmentSettings: JSON.stringify(nextSettings),
      });

      res.json({
        stages: nextSettings.crmKanban.stages,
        migratedCount,
      });
    } catch (error) {
      next(error);
    }
  });

  const crmResponsiblesHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = await resolveOrgIdForCrm(req, req.query.organizationId);
      const teamMembers = await storage.getStaff(orgId);
      res.json(
        teamMembers
          .filter((item) => item.active !== false)
          .map((item) => ({
            id: item.id,
            name: item.name,
            role: item.role,
            active: item.active,
          })),
      );
    } catch (error) {
      next(error);
    }
  };
  app.get("/api/crm/responsibles", requireAuth, requireRole(...CRM_ROLES), crmResponsiblesHandler);
  app.get("/api/crm/users", requireAuth, requireRole(...CRM_ROLES), crmResponsiblesHandler);

  app.get("/api/crm/opportunities", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const parsedQuery = crmOpportunitiesQuerySchema.parse(req.query);
      const orgId = await resolveOrgIdForCrm(req, parsedQuery.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const allowedStages = getCrmStageValuesFromSettings(settingsResult.settings);
      if (parsedQuery.stage && !allowedStages.includes(parsedQuery.stage)) {
        return res.status(400).json({ message: "Etapa inválida para esta organização." });
      }
      const filters = {
        stage: parsedQuery.stage,
        search: parsedQuery.search,
        ownerId: parsedQuery.ownerId,
        ownerStaffId: parsedQuery.ownerStaffId,
        source: parsedQuery.source,
        expectedCloseFrom: parsedQuery.expectedCloseFrom,
        expectedCloseTo: parsedQuery.expectedCloseTo,
        followUpStatus: parsedQuery.followUpStatus,
      };
      const wantsPagination = parsedQuery.page !== undefined || parsedQuery.pageSize !== undefined;
      if (wantsPagination) {
        const pageResult = await storage.getCrmOpportunitiesPaginated(orgId, {
          ...filters,
          page: parsedQuery.page,
          pageSize: parsedQuery.pageSize,
        });
        return res.json(pageResult);
      }
      const opportunities = await storage.getCrmOpportunities(orgId, filters);
      res.json(opportunities);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/crm/opportunities/:id", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const orgId = await resolveOrgIdForCrm(req, req.query.organizationId);
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID inválido." });
      }
      const opportunity = await storage.getCrmOpportunity(orgId, opportunityId);
      if (!opportunity) {
        return res.status(404).json({ message: "Oportunidade não encontrada." });
      }
      res.json(opportunity);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/crm/opportunities", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const parsed = crmCreateSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, parsed.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const allowedStages = getCrmStageValuesFromSettings(settingsResult.settings);
      const resolvedStage = parsed.stage ?? allowedStages[0];
      if (!resolvedStage || !allowedStages.includes(resolvedStage)) {
        return res.status(400).json({ message: "Etapa inválida para esta organização." });
      }
      await assertCrmOwnerStaff(orgId, parsed.ownerStaffId);
      const created = await storage.createCrmOpportunity({
        organizationId: orgId,
        title: parsed.title,
        contactName: parsed.contactName || null,
        contactPhone: parsed.contactPhone || null,
        contactEmail: parsed.contactEmail || null,
        source: parsed.source || null,
        stage: resolvedStage,
        amount: parsed.amount,
        expectedCloseDate: parsed.expectedCloseDate || null,
        ownerId: parsed.ownerId ?? null,
        ownerStaffId: parsed.ownerStaffId ?? null,
        notes: parsed.notes || null,
        followUpTasks: normalizeCrmFollowUpTasks(parsed.followUpTasks),
        lostReason: stageUsesLostReason(resolvedStage) ? (parsed.lostReason || null) : null,
        position: parsed.position,
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/crm/opportunities/:id", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID inválido." });
      }

      const parsed = crmUpdateSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, parsed.organizationId ?? req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const allowedStages = getCrmStageValuesFromSettings(settingsResult.settings);
      if (parsed.stage && !allowedStages.includes(parsed.stage)) {
        return res.status(400).json({ message: "Etapa inválida para esta organização." });
      }
      await assertCrmOwnerStaff(orgId, parsed.ownerStaffId);
      const updated = await storage.updateCrmOpportunity(orgId, opportunityId, {
        ...parsed,
        contactName: parsed.contactName === undefined ? undefined : (parsed.contactName || null),
        contactPhone: parsed.contactPhone === undefined ? undefined : (parsed.contactPhone || null),
        contactEmail: parsed.contactEmail === undefined ? undefined : (parsed.contactEmail || null),
        source: parsed.source === undefined ? undefined : (parsed.source || null),
        expectedCloseDate: parsed.expectedCloseDate === undefined ? undefined : (parsed.expectedCloseDate || null),
        ownerId: parsed.ownerId === undefined ? undefined : (parsed.ownerId ?? null),
        ownerStaffId: parsed.ownerStaffId === undefined ? undefined : (parsed.ownerStaffId ?? null),
        notes: parsed.notes === undefined ? undefined : (parsed.notes || null),
        followUpTasks: parsed.followUpTasks === undefined
          ? undefined
          : normalizeCrmFollowUpTasks(parsed.followUpTasks),
        lostReason: stageUsesLostReason(parsed.stage)
          ? (parsed.lostReason === undefined ? undefined : (parsed.lostReason || null))
          : (parsed.stage ? null : undefined),
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/crm/opportunities/:id/stage", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID inválido." });
      }
      const parsed = crmMoveSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, req.body?.organizationId ?? req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const allowedStages = getCrmStageValuesFromSettings(settingsResult.settings);
      if (!allowedStages.includes(parsed.stage)) {
        return res.status(400).json({ message: "Etapa inválida para esta organização." });
      }
      const updated = await storage.updateCrmOpportunity(orgId, opportunityId, {
        stage: parsed.stage,
        position: parsed.position,
        lostReason: stageUsesLostReason(parsed.stage) ? undefined : null,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/crm/opportunities/:id/follow-ups", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID inválido." });
      }
      const parsed = crmFollowUpsUpdateSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, parsed.organizationId ?? req.query.organizationId);
      const updated = await storage.updateCrmOpportunity(orgId, opportunityId, {
        followUpTasks: normalizeCrmFollowUpTasks(parsed.followUpTasks),
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/crm/opportunities/:id", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID inválido." });
      }
      const orgId = await resolveOrgIdForCrm(req, req.query.organizationId);
      await storage.deleteCrmOpportunity(orgId, opportunityId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // ===== STATS =====
  app.get("/api/stats", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getDashboardStats(orgId));
  });

  const resolveCurrentMonthKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };
  const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "sim"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "nao", "não"].includes(normalized)) return false;
    return fallback;
  };
  const parsePositiveIntegerEnv = (value: string | undefined, fallback: number, min: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const intValue = Math.trunc(parsed);
    if (intValue < min) return fallback;
    return intValue;
  };
  const autoMonthlyFeesEnabled = parseBooleanEnv(process.env.MONTHLY_FEES_AUTO_ENABLED, true);
  const autoMonthlyFeesIntervalMinutes = parsePositiveIntegerEnv(
    process.env.MONTHLY_FEES_AUTO_INTERVAL_MINUTES,
    180,
    10,
  );
  let monthlyFeeAutoGenerationRunning = false;
  const runAutoMonthlyFeesGeneration = async (source: "startup" | "interval") => {
    if (monthlyFeeAutoGenerationRunning) return;
    monthlyFeeAutoGenerationRunning = true;
    try {
      const referenceMonth = resolveCurrentMonthKey();
      const organizations = await storage.getOrganizations(true);
      let createdTotal = 0;
      let skippedExistingTotal = 0;
      let activeOrgs = 0;

      for (const organization of organizations) {
        if (normalizeOrgStatus(organization) !== "active") continue;
        activeOrgs++;
        try {
          const summary = await generateMonthlyFeesForOrganizationMonth(organization.id, referenceMonth);
          createdTotal += summary.created;
          skippedExistingTotal += summary.skippedExisting;
        } catch (error) {
          console.error(
            `[monthly-fees:auto] falha na organização ${organization.id} (${organization.name})`,
            error,
          );
        }
      }

      if (createdTotal > 0 || source === "startup") {
        console.log(
          `[monthly-fees:auto:${source}] mês ${referenceMonth} | organizações ativas=${activeOrgs} | criadas=${createdTotal} | já existentes=${skippedExistingTotal}`,
        );
      }
    } catch (error) {
      console.error("[monthly-fees:auto] erro na rotina automática", error);
    } finally {
      monthlyFeeAutoGenerationRunning = false;
    }
  };

  await seedDatabase();
  if (autoMonthlyFeesEnabled) {
    setTimeout(() => {
      void runAutoMonthlyFeesGeneration("startup");
    }, 1_000);

    const autoTimer = setInterval(() => {
      void runAutoMonthlyFeesGeneration("interval");
    }, autoMonthlyFeesIntervalMinutes * 60 * 1_000);
    autoTimer.unref?.();

    console.log(
      `[monthly-fees:auto] habilitado | intervalo=${autoMonthlyFeesIntervalMinutes}min`,
    );
  } else {
    console.log("[monthly-fees:auto] desabilitado por variável de ambiente.");
  }

  return httpServer;
}

async function seedDatabase() {
  const superAdmin = await storage.getSuperAdminByUsername("superadmin");

  // Always run new-module seeding if data is missing (even on existing DBs)
  await seedNewModules();
  // Always ensure portal credentials are set for seed family members
  await seedPortalCredentials();

  if (superAdmin) return;

  console.log("Seeding multi-tenant database...");

  await storage.createUser({ organizationId: null, username: "superadmin", password: "superadmin", name: "Super Administrador", role: "superadmin", isSuperAdmin: true });

  const org1 = await storage.createOrganization({ name: "Bem Viver ILPI", address: "Rua das Flores, 123 - São Paulo/SP", phone: "(11) 3333-0001", email: "contato@bemviver.com.br", cnpj: "12.345.678/0001-90", capacity: 50, status: "active", active: true });
  const org2 = await storage.createOrganization({ name: "Lar Esperança", address: "Av. das Acácias, 456 - Campinas/SP", phone: "(19) 3333-0002", email: "contato@laresperanca.com.br", cnpj: "98.765.432/0001-10", capacity: 30, status: "active", active: true });

  await storage.createUser({ organizationId: org1.id, username: "admin", password: "admin", name: "Administrador", role: "admin", isSuperAdmin: false });
  await storage.createUser({ organizationId: org2.id, username: "admin2", password: "admin2", name: "Administrador", role: "admin", isSuperAdmin: false });

  // === ORG 1 ===
  const r1 = await storage.createResident({ organizationId: org1.id, name: "Maria Silva", birthDate: "1945-03-15", gender: "F", cpf: "123.456.789-00", bloodType: "A+", mobilityStatus: "assistido", cognitiveStatus: "comprometimento leve", contactName: "João Silva", contactPhone: "(11) 99999-1234", contactRelationship: "Filho", admissionDate: "2023-01-10", roomNumber: "101-A", healthNotes: "Hipertensão, Diabetes Tipo 2.", allergies: "Dipirona", status: "active" });
  const r2 = await storage.createResident({ organizationId: org1.id, name: "Antônio Santos", birthDate: "1938-07-22", gender: "M", bloodType: "O-", mobilityStatus: "assistido", cognitiveStatus: "comprometimento moderado", contactName: "Ana Santos", contactPhone: "(11) 98888-5678", contactRelationship: "Filha", admissionDate: "2023-05-20", roomNumber: "102-B", healthNotes: "Alzheimer fase inicial.", allergies: "Nenhuma conhecida", status: "active" });
  const r3 = await storage.createResident({ organizationId: org1.id, name: "Josefa Oliveira", birthDate: "1950-11-05", gender: "F", bloodType: "B+", mobilityStatus: "independente", cognitiveStatus: "preservado", contactName: "Pedro Oliveira", contactPhone: "(11) 97777-4321", contactRelationship: "Sobrinho", admissionDate: "2024-02-15", roomNumber: "103-A", healthNotes: "Recuperação de fratura no fêmur.", allergies: "Lactose", status: "active" });

  const s1 = await storage.createStaff({ organizationId: org1.id, name: "Dra. Helena Costa", role: "enfermeiro", coren: "COREN-SP 123456", shift: "manhã", phone: "(11) 91111-1111", admissionDate: "2022-01-01", active: true });
  const s2 = await storage.createStaff({ organizationId: org1.id, name: "Carlos Ferreira", role: "cuidador", shift: "tarde", phone: "(11) 92222-2222", admissionDate: "2022-03-15", active: true });
  await storage.createStaff({ organizationId: org1.id, name: "Luciana Dias", role: "tecnico_enfermagem", coren: "COREN-SP 654321", shift: "noite", phone: "(11) 93333-3333", admissionDate: "2023-02-01", active: true });
  await storage.createStaff({ organizationId: org1.id, name: "Roberto Alves", role: "fisioterapeuta", specialty: "Fisioterapia Motora", shift: "manhã", phone: "(11) 94444-4444", admissionDate: "2023-06-01", active: true });

  await storage.createComorbidity({ organizationId: org1.id, residentId: r1.id, name: "Hipertensão Arterial Sistêmica", icd10: "I10", severity: "moderate", active: true });
  await storage.createComorbidity({ organizationId: org1.id, residentId: r1.id, name: "Diabetes Mellitus Tipo 2", icd10: "E11", severity: "moderate", active: true });
  await storage.createComorbidity({ organizationId: org1.id, residentId: r2.id, name: "Doença de Alzheimer", icd10: "G30", severity: "moderate", active: true });

  await storage.createFamilyMember({ organizationId: org1.id, residentId: r1.id, name: "João Silva", relationship: "Filho", phone: "(11) 99999-1234", email: "joao.silva@email.com", isPrimary: true, portalAccess: false });
  await storage.createFamilyMember({ organizationId: org1.id, residentId: r1.id, name: "Carla Silva", relationship: "Neta", phone: "(11) 99888-4321", email: "carla.silva@email.com", isPrimary: false, portalAccess: false });
  await storage.createFamilyMember({ organizationId: org1.id, residentId: r2.id, name: "Ana Santos", relationship: "Filha", phone: "(11) 98888-5678", email: "ana.santos@email.com", isPrimary: true, portalAccess: false });

  const today = new Date().toISOString().split("T")[0];
  await storage.createMedicalRecord({ organizationId: org1.id, residentId: r1.id, date: today, type: "evolution", title: "Evolução diária", content: "Paciente em bom estado geral. Pressão arterial controlada: 130/80 mmHg. Glicemia jejum: 118 mg/dL. Humor estável. Alimentação adequada. Sem intercorrências.", visibility: "shared", bloodPressure: "130/80", heartRate: 72, temperature: 36.4, oxygenSat: 97, mood: "bom" });
  await storage.createMedicalRecord({ organizationId: org1.id, residentId: r2.id, date: today, type: "evolution", title: "Evolução diária", content: "Paciente com episódio de confusão matinal. Reorientado pela equipe. Alimentação com assistência. Sem agressividade. Família informada.", visibility: "internal", mood: "regular" });

  await storage.createMedication({ organizationId: org1.id, residentId: r1.id, name: "Losartana", dosage: "50mg", frequency: "12h/12h", route: "oral", scheduleTime: "08:00, 20:00", prescribedBy: "Dr. Roberto Mendes", status: "active" });
  await storage.createMedication({ organizationId: org1.id, residentId: r1.id, name: "Metformina", dosage: "850mg", frequency: "Após almoço", route: "oral", scheduleTime: "12:00", prescribedBy: "Dr. Roberto Mendes", status: "active" });
  await storage.createMedication({ organizationId: org1.id, residentId: r2.id, name: "Donepezila", dosage: "10mg", frequency: "Noite", route: "oral", scheduleTime: "21:00", prescribedBy: "Dra. Claudia Reis", status: "active" });
  await storage.createMedication({ organizationId: org1.id, residentId: r3.id, name: "Calcitrin D3", dosage: "600mg/400UI", frequency: "Manhã", route: "oral", scheduleTime: "08:00", prescribedBy: "Dr. Paulo Braga", status: "active" });

  await storage.createOccurrence({ organizationId: org1.id, residentId: r2.id, type: "Comportamento", description: "Agitação noturna, acalmado após conversa com equipe.", severity: "low", status: "resolved", resolution: "Técnica de reorientação aplicada com sucesso." });
  await storage.createOccurrence({ organizationId: org1.id, residentId: r3.id, type: "Saúde", description: "Queixa de dor localizada após sessão de fisioterapia.", severity: "low", status: "open" });

  const c1 = await storage.createContract({ organizationId: org1.id, residentId: r1.id, plan: "premium", monthlyValue: 4500, startDate: "2023-01-10", paymentDay: 5, paymentMethod: "pix", status: "active", notes: "Contrato com pacote premium - quarto privativo, fisioterapia 3x/semana." });
  const c2 = await storage.createContract({ organizationId: org1.id, residentId: r2.id, plan: "standard", monthlyValue: 3200, startDate: "2023-05-20", paymentDay: 10, paymentMethod: "boleto", status: "active" });
  await storage.createContract({ organizationId: org1.id, residentId: r3.id, plan: "standard", monthlyValue: 3200, startDate: "2024-02-15", paymentDay: 10, paymentMethod: "boleto", status: "active" });

  const prevMonth = new Date(); prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const currMonth = new Date();
  const currMonthStr = `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}`;

  await storage.createMonthlyFee({ organizationId: org1.id, contractId: c1.id, residentId: r1.id, referenceMonth: prevMonthStr, dueDate: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-05`, amount: 4500, status: "paid", paidAt: new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 4), paymentMethod: "pix", receiptNumber: "PIX-001" });
  await storage.createMonthlyFee({ organizationId: org1.id, contractId: c1.id, residentId: r1.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-05`, amount: 4500, status: "pending" });
  await storage.createMonthlyFee({ organizationId: org1.id, contractId: c2.id, residentId: r2.id, referenceMonth: prevMonthStr, dueDate: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-10`, amount: 3200, status: "overdue" });
  await storage.createMonthlyFee({ organizationId: org1.id, contractId: c2.id, residentId: r2.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-10`, amount: 3200, status: "pending" });

  const today7 = new Date(new Date().setHours(7, 0, 0, 0));
  const today19 = new Date(new Date().setHours(19, 0, 0, 0));
  const tomorrow7 = new Date(new Date(today7).setDate(today7.getDate() + 1));
  await storage.createShiftAssignment({ organizationId: org1.id, staffId: s1.id, residentId: null, shiftType: "12h_manha", startTime: today7, endTime: today19, notes: "Plantão manhã" } as any);
  await storage.createShiftAssignment({ organizationId: org1.id, staffId: s2.id, residentId: null, shiftType: "12h_noite", startTime: today19, endTime: tomorrow7, notes: "Plantão noite" } as any);

  // === ORG 2 ===
  const r4 = await storage.createResident({ organizationId: org2.id, name: "Benedita Rocha", birthDate: "1942-06-10", gender: "F", bloodType: "A-", mobilityStatus: "assistido", cognitiveStatus: "preservado", contactName: "Cláudia Rocha", contactPhone: "(19) 96666-1234", contactRelationship: "Filha", admissionDate: "2024-01-05", roomNumber: "01-A", healthNotes: "Insuficiência cardíaca leve.", allergies: "Penicilina", status: "active" });
  const r5 = await storage.createResident({ organizationId: org2.id, name: "Geraldo Moraes", birthDate: "1936-09-25", gender: "M", bloodType: "B+", mobilityStatus: "assistido", cognitiveStatus: "comprometimento leve", contactName: "Ricardo Moraes", contactPhone: "(19) 95555-4321", contactRelationship: "Filho", admissionDate: "2023-08-12", roomNumber: "02-B", healthNotes: "Parkinson fase 2. Apoio para locomoção.", allergies: "Nenhuma", status: "active" });

  const s3 = await storage.createStaff({ organizationId: org2.id, name: "Enfª. Patrícia Lima", role: "enfermeiro", coren: "COREN-SP 789012", shift: "manhã", phone: "(19) 91234-5678", active: true });
  const s4 = await storage.createStaff({ organizationId: org2.id, name: "Marcos Souza", role: "cuidador", shift: "noite", phone: "(19) 98765-4321", active: true });

  await storage.createComorbidity({ organizationId: org2.id, residentId: r4.id, name: "Insuficiência Cardíaca", icd10: "I50", severity: "mild", active: true });
  await storage.createComorbidity({ organizationId: org2.id, residentId: r5.id, name: "Doença de Parkinson", icd10: "G20", severity: "moderate", active: true });

  await storage.createMedication({ organizationId: org2.id, residentId: r4.id, name: "Enalapril", dosage: "10mg", frequency: "Manhã", route: "oral", scheduleTime: "08:00", status: "active" });
  await storage.createMedication({ organizationId: org2.id, residentId: r5.id, name: "Levodopa", dosage: "250mg", frequency: "8h/8h", route: "oral", scheduleTime: "08:00, 16:00, 00:00", status: "active" });

  await storage.createOccurrence({ organizationId: org2.id, residentId: r5.id, type: "Queda", description: "Episódio de queda ao levantar da cama. Sem lesões graves.", severity: "medium", status: "open" });

  const c3 = await storage.createContract({ organizationId: org2.id, residentId: r4.id, plan: "premium", monthlyValue: 4800, startDate: "2024-01-05", paymentDay: 1, paymentMethod: "boleto", status: "active" });
  await storage.createMonthlyFee({ organizationId: org2.id, contractId: c3.id, residentId: r4.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-01`, amount: 4800, status: "pending" });

  const t7 = new Date(new Date().setHours(7, 0, 0, 0));
  const t19 = new Date(new Date().setHours(19, 0, 0, 0));
  const tn7 = new Date(new Date(t7).setDate(t7.getDate() + 1));
  await storage.createShiftAssignment({ organizationId: org2.id, staffId: s3.id, residentId: null, shiftType: "12h_manha", startTime: t7, endTime: t19, notes: "Plantão dia" } as any);
  await storage.createShiftAssignment({ organizationId: org2.id, staffId: s4.id, residentId: null, shiftType: "12h_noite", startTime: t19, endTime: tn7, notes: "Plantão noite" } as any);

  console.log("Seed concluído com organizações e usuários de demonstração.");
}

async function seedNewModules() {
  // Find existing orgs to seed new modules (comorbidities, medical records, family, contracts, fees)
  const orgs = await storage.getOrganizations(true);
  if (orgs.length === 0) return;

  const org1 = orgs.find(o => o.name.includes("Bem Viver"));
  if (!org1) return;

  const residents = await storage.getResidents(org1.id);
  if (residents.length === 0) return;

  // Check if already seeded new modules (check comorbidities for first resident)
  const existingComorbidities = await storage.getComorbidities(org1.id, residents[0].id);
  if (existingComorbidities.length > 0) return; // Already seeded

  console.log("Seeding new modules (comorbidities, medical records, family, contracts, fees)...");

  const today = new Date().toISOString().split("T")[0];
  const currMonth = new Date();
  const currMonthStr = `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = new Date(); prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

  for (const resident of residents) {
    if (resident.name.includes("Maria")) {
      await storage.createComorbidity({ organizationId: org1.id, residentId: resident.id, name: "Hipertensão Arterial Sistêmica", icd10: "I10", severity: "moderate", active: true });
      await storage.createComorbidity({ organizationId: org1.id, residentId: resident.id, name: "Diabetes Mellitus Tipo 2", icd10: "E11", severity: "moderate", active: true });
      await storage.createFamilyMember({ organizationId: org1.id, residentId: resident.id, name: "João Silva", relationship: "Filho", phone: "(11) 99999-1234", email: "joao.silva@email.com", isPrimary: true, portalAccess: true, portalUsername: "joao.silva", portalPassword: "familia123" });
      await storage.createFamilyMember({ organizationId: org1.id, residentId: resident.id, name: "Carla Silva", relationship: "Neta", phone: "(11) 99888-4321", isPrimary: false, portalAccess: false, portalUsername: null, portalPassword: null });
      await storage.createMedicalRecord({ organizationId: org1.id, residentId: resident.id, date: today, type: "evolution", title: "Evolução diária", content: "Paciente em bom estado geral. Pressão arterial controlada: 130/80 mmHg. Glicemia jejum: 118 mg/dL. Humor estável. Alimentação adequada. Sem intercorrências.", visibility: "shared", bloodPressure: "130/80", heartRate: 72, temperature: 36.4, oxygenSat: 97, mood: "bom" });
      const c = await storage.createContract({ organizationId: org1.id, residentId: resident.id, plan: "premium", monthlyValue: 4500, startDate: "2023-01-10", paymentDay: 5, paymentMethod: "pix", status: "active", notes: "Contrato premium - quarto privativo, fisioterapia 3x/semana." });
      await storage.createMonthlyFee({ organizationId: org1.id, contractId: c.id, residentId: resident.id, referenceMonth: prevMonthStr, dueDate: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-05`, amount: 4500, status: "paid", paidAt: new Date(), paymentMethod: "pix", receiptNumber: "PIX-001" });
      await storage.createMonthlyFee({ organizationId: org1.id, contractId: c.id, residentId: resident.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-05`, amount: 4500, status: "pending" });
    } else if (resident.name.includes("Antônio") || resident.name.includes("Antonio")) {
      await storage.createComorbidity({ organizationId: org1.id, residentId: resident.id, name: "Doença de Alzheimer", icd10: "G30", severity: "moderate", active: true });
      await storage.createFamilyMember({ organizationId: org1.id, residentId: resident.id, name: "Ana Santos", relationship: "Filha", phone: "(11) 98888-5678", email: "ana.santos@email.com", isPrimary: true, portalAccess: true, portalUsername: "ana.santos", portalPassword: "familia123" });
      await storage.createMedicalRecord({ organizationId: org1.id, residentId: resident.id, date: today, type: "evolution", title: "Evolução diária", content: "Paciente com episódio de confusão matinal. Reorientado pela equipe. Alimentação com assistência. Sem agressividade.", visibility: "internal", mood: "regular" });
      const c2 = await storage.createContract({ organizationId: org1.id, residentId: resident.id, plan: "standard", monthlyValue: 3200, startDate: "2023-05-20", paymentDay: 10, paymentMethod: "boleto", status: "active" });
      await storage.createMonthlyFee({ organizationId: org1.id, contractId: c2.id, residentId: resident.id, referenceMonth: prevMonthStr, dueDate: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-10`, amount: 3200, status: "overdue" });
    } else if (resident.name.includes("Josefa")) {
      await storage.createComorbidity({ organizationId: org1.id, residentId: resident.id, name: "Fratura de Fêmur (pós-operatório)", icd10: "S72", severity: "mild", active: true });
      await storage.createFamilyMember({ organizationId: org1.id, residentId: resident.id, name: "Pedro Oliveira", relationship: "Sobrinho", phone: "(11) 97777-4321", isPrimary: true, portalAccess: false });
      const c3 = await storage.createContract({ organizationId: org1.id, residentId: resident.id, plan: "standard", monthlyValue: 3200, startDate: "2024-02-15", paymentDay: 10, paymentMethod: "boleto", status: "active" });
      await storage.createMonthlyFee({ organizationId: org1.id, contractId: c3.id, residentId: resident.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-10`, amount: 3200, status: "pending" });
    }
  }

  // Org 2
  const org2 = orgs.find(o => o.name.includes("Esperança"));
  if (org2) {
    const r2List = await storage.getResidents(org2.id);
    for (const r of r2List) {
      if (r.name.includes("Benedita")) {
        await storage.createComorbidity({ organizationId: org2.id, residentId: r.id, name: "Insuficiência Cardíaca", icd10: "I50", severity: "mild", active: true });
        await storage.createFamilyMember({ organizationId: org2.id, residentId: r.id, name: "Cláudia Rocha", relationship: "Filha", phone: "(19) 96666-1234", isPrimary: true, portalAccess: true, portalUsername: "claudia.rocha", portalPassword: "familia123" });
        const c4 = await storage.createContract({ organizationId: org2.id, residentId: r.id, plan: "premium", monthlyValue: 4800, startDate: "2024-01-05", paymentDay: 1, paymentMethod: "boleto", status: "active" });
        await storage.createMonthlyFee({ organizationId: org2.id, contractId: c4.id, residentId: r.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-01`, amount: 4800, status: "pending" });
      } else if (r.name.includes("Geraldo")) {
        await storage.createComorbidity({ organizationId: org2.id, residentId: r.id, name: "Doença de Parkinson", icd10: "G20", severity: "moderate", active: true });
        await storage.createFamilyMember({ organizationId: org2.id, residentId: r.id, name: "Ricardo Moraes", relationship: "Filho", phone: "(19) 95555-4321", isPrimary: true, portalAccess: true, portalUsername: "ricardo.moraes", portalPassword: "familia123" });
        const c5 = await storage.createContract({ organizationId: org2.id, residentId: r.id, plan: "standard", monthlyValue: 3800, startDate: "2023-08-12", paymentDay: 15, paymentMethod: "pix", status: "active" });
        await storage.createMonthlyFee({ organizationId: org2.id, contractId: c5.id, residentId: r.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-15`, amount: 3800, status: "pending" });
      }
    }
  }

  console.log("Novos módulos semeados com sucesso!");
}

async function seedPortalCredentials() {
  // Update existing family members with portal credentials if missing
  const portalMap: Record<string, { username: string; password: string }> = {
    "João Silva":    { username: "joao.silva",    password: "familia123" },
    "Ana Santos":    { username: "ana.santos",    password: "familia123" },
    "Cláudia Rocha": { username: "claudia.rocha", password: "familia123" },
    "Ricardo Moraes":{ username: "ricardo.moraes",password: "familia123" },
  };

  const orgs = await storage.getOrganizations(true);
  for (const org of orgs) {
    const residents = await storage.getResidents(org.id);
    for (const resident of residents) {
      const members = await storage.getFamilyMembers(org.id, resident.id);
      for (const member of members) {
        const creds = portalMap[member.name];
        if (creds && !member.portalUsername) {
          await storage.updateFamilyMember(org.id, member.id, {
            portalAccess: true,
            portalUsername: creds.username,
            portalPassword: creds.password,
          });
          console.log(`Portal credentials updated for family member ${member.id}.`);
        }
      }
    }
  }
}
