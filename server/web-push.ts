import webpush from "web-push";
import { storage } from "./storage";
import type { AppNotification, PushSubscriptionRecord } from "@shared/schema";

type WebPushConfig = {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  subject: string;
  intervalSeconds: number;
  batchSize: number;
  maxAttempts: number;
  lookbackMinutes: number;
};

let configured = false;
let started = false;
let timer: NodeJS.Timeout | null = null;
let running = false;

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "sim";
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value && value.trim() ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function loadWebPushConfig(): WebPushConfig {
  return {
    enabled: parseBoolean(process.env.WEB_PUSH_ENABLED, false),
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY?.trim() || "",
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY?.trim() || "",
    subject: process.env.WEB_PUSH_SUBJECT?.trim() || "mailto:suporte@easycare.local",
    intervalSeconds: parseInteger(process.env.WEB_PUSH_WORKER_INTERVAL_SECONDS, 30, 10, 3600),
    batchSize: parseInteger(process.env.WEB_PUSH_WORKER_BATCH_SIZE, 50, 1, 200),
    maxAttempts: parseInteger(process.env.WEB_PUSH_MAX_ATTEMPTS, 3, 1, 10),
    lookbackMinutes: parseInteger(process.env.WEB_PUSH_LOOKBACK_MINUTES, 1440, 1, 60 * 24 * 30),
  };
}

function configureWebPush(config = loadWebPushConfig()): boolean {
  if (!config.enabled || !config.publicKey || !config.privateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configured = true;
  }
  return true;
}

export function getWebPushPublicKey(): string {
  const config = loadWebPushConfig();
  return config.enabled && config.publicKey && config.privateKey ? config.publicKey : "";
}

export function isWebPushConfigured(): boolean {
  const config = loadWebPushConfig();
  return config.enabled && Boolean(config.publicKey && config.privateKey);
}

function notificationIsDue(notification: AppNotification, now = new Date()): boolean {
  if (!notification.scheduledFor) return true;
  const scheduledFor = notification.scheduledFor instanceof Date
    ? notification.scheduledFor
    : new Date(notification.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) return true;
  return scheduledFor.getTime() <= now.getTime();
}

function buildPushPayload(notification: AppNotification) {
  return JSON.stringify({
    id: notification.id,
    title: notification.title,
    body: notification.message,
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: `easycare-notification-${notification.id}`,
    url: notification.actionUrl || "/notificações",
    sourceModule: notification.sourceModule,
    severity: notification.severity,
    timestamp: Date.now(),
  });
}

function toWebPushSubscription(subscription: PushSubscriptionRecord): webpush.PushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
}

async function sendNotificationToSubscriptions(
  notification: AppNotification,
  subscriptions: PushSubscriptionRecord[],
) {
  if (subscriptions.length === 0) {
    await storage.markNotificationPushSkipped(notification.id, "Usuário sem inscrição Web Push ativa.");
    return;
  }

  const payload = buildPushPayload(notification);
  let sentCount = 0;
  const errors: string[] = [];

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(toWebPushSubscription(subscription), payload, { TTL: 60 * 60 });
      sentCount += 1;
    } catch (error) {
      const statusCode = typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : null;
      const message = error instanceof Error ? error.message : "Erro desconhecido ao enviar Web Push.";
      errors.push(message);
      if (statusCode === 404 || statusCode === 410) {
        await storage.deactivatePushSubscriptionByEndpoint(subscription.endpoint);
      }
    }
  }

  if (sentCount > 0) {
    await storage.markNotificationPushSent(notification.id);
    return;
  }

  await storage.markNotificationPushFailed(notification.id, errors.join(" | ") || "Nenhuma inscrição recebeu o push.");
}

export async function sendWebPushNotifications(notifications: AppNotification[]) {
  const config = loadWebPushConfig();
  if (!configureWebPush(config)) return;

  const dueNotifications = notifications.filter((notification) =>
    notification.userId && notificationIsDue(notification),
  );

  for (const notification of dueNotifications) {
    try {
      const subscriptions = await storage.getActivePushSubscriptions(notification.organizationId, Number(notification.userId));
      await sendNotificationToSubscriptions(notification, subscriptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao enviar Web Push.";
      await storage.markNotificationPushFailed(notification.id, message);
    }
  }
}

async function dispatchDueWebPushNotifications(config: WebPushConfig) {
  if (running || !configureWebPush(config)) return;
  running = true;
  try {
    const notifications = await storage.getDuePushNotifications({
      limit: config.batchSize,
      lookbackMinutes: config.lookbackMinutes,
      maxAttempts: config.maxAttempts,
    });
    await sendWebPushNotifications(notifications);
  } catch (error) {
    console.error("[web-push] erro no worker de notificações", error);
  } finally {
    running = false;
  }
}

export function startWebPushNotificationWorker() {
  if (started) return;
  started = true;
  const config = loadWebPushConfig();
  if (!config.enabled) {
    console.log("[web-push] notificações desabilitadas");
    return;
  }
  if (!config.publicKey || !config.privateKey) {
    console.warn("[web-push] WEB_PUSH_PUBLIC_KEY ou WEB_PUSH_PRIVATE_KEY ausente; worker desabilitado");
    return;
  }

  console.log(`[web-push] notificações habilitadas | intervalo=${config.intervalSeconds}s`);
  void dispatchDueWebPushNotifications(config);
  timer = setInterval(() => {
    void dispatchDueWebPushNotifications(config);
  }, config.intervalSeconds * 1000);
}

export function stopWebPushNotificationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  running = false;
}
