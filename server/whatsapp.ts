import { storage } from "./storage";

const DEFAULT_WHATSAPP_TYPES = [
  "time_clock_punch_registered",
  "time_clock_entry_pending_approval",
  "time_clock_entry_reviewed",
  "time_clock_adjustment_pending",
  "time_clock_adjustment_reviewed",
  "time_clock_break_reminder",
  "time_clock_break_overdue",
  "time_clock_clock_out_missing",
] as const;

type WhatsappNotification = Awaited<ReturnType<typeof storage.getDueWhatsappNotifications>>[number];

type WhatsappConfig = {
  enabled: boolean;
  apiVersion: string;
  token: string;
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
  messageMode: "template" | "text";
  defaultCountryCode: string;
  intervalSeconds: number;
  batchSize: number;
  maxAttempts: number;
  lookbackMinutes: number;
  allowedTypes: string[];
};

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

function parseAllowedTypes(value: string | undefined): string[] {
  if (!value || !value.trim()) return [...DEFAULT_WHATSAPP_TYPES];
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : [...DEFAULT_WHATSAPP_TYPES];
}

function loadWhatsappConfig(): WhatsappConfig {
  const messageMode = process.env.WHATSAPP_MESSAGE_MODE?.trim().toLowerCase() === "text" ? "text" : "template";
  return {
    enabled: parseBoolean(process.env.WHATSAPP_NOTIFICATIONS_ENABLED, false),
    apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v23.0",
    token: process.env.WHATSAPP_META_TOKEN?.trim() || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "",
    templateName: process.env.WHATSAPP_TEMPLATE_NAME?.trim() || "easycare_alerta",
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "pt_BR",
    messageMode,
    defaultCountryCode: (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() || "55").replace(/\D/g, "") || "55",
    intervalSeconds: parseInteger(process.env.WHATSAPP_WORKER_INTERVAL_SECONDS, 60, 15, 3600),
    batchSize: parseInteger(process.env.WHATSAPP_WORKER_BATCH_SIZE, 25, 1, 100),
    maxAttempts: parseInteger(process.env.WHATSAPP_MAX_ATTEMPTS, 3, 1, 10),
    lookbackMinutes: parseInteger(process.env.WHATSAPP_LOOKBACK_MINUTES, 1440, 1, 60 * 24 * 30),
    allowedTypes: parseAllowedTypes(process.env.WHATSAPP_NOTIFICATION_TYPES),
  };
}

function normalizeWhatsappPhone(rawPhone: string | null | undefined, defaultCountryCode: string): string | null {
  const digits = String(rawPhone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith(defaultCountryCode) && digits.length >= 12 && digits.length <= 14) return digits;
  if ((digits.length === 10 || digits.length === 11) && defaultCountryCode === "55") return `${defaultCountryCode}${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

function buildMessageText(notification: WhatsappNotification): string {
  const organization = notification.organizationName ? `${notification.organizationName}\n` : "";
  return `${organization}${notification.title}\n${notification.message}`.slice(0, 1000);
}

async function sendMetaCloudMessage(
  to: string,
  notification: WhatsappNotification,
  config: WhatsappConfig,
): Promise<string | null> {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  const body = config.messageMode === "text"
    ? {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: buildMessageText(notification) },
    }
    : {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: config.templateName,
        language: { code: config.templateLanguage },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: notification.title.slice(0, 250) },
              { type: "text", text: notification.message.slice(0, 750) },
            ],
          },
        ],
      },
    };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || response.statusText;
    throw new Error(`WhatsApp ${response.status}: ${message}`);
  }
  return payload?.messages?.[0]?.id ?? null;
}

async function dispatchDueWhatsappNotifications(config: WhatsappConfig) {
  if (running) return;
  running = true;
  try {
    const notifications = await storage.getDueWhatsappNotifications({
      limit: config.batchSize,
      lookbackMinutes: config.lookbackMinutes,
      maxAttempts: config.maxAttempts,
      sourceModule: "time_clock",
      types: config.allowedTypes,
    });

    for (const notification of notifications) {
      const phone = normalizeWhatsappPhone(
        notification.userPhone || notification.staffPhone,
        config.defaultCountryCode,
      );
      if (!phone) {
        await storage.markNotificationWhatsappSkipped(notification.id, "Usuário sem telefone válido para WhatsApp.");
        continue;
      }

      try {
        const messageId = await sendMetaCloudMessage(phone, notification, config);
        await storage.markNotificationWhatsappSent(notification.id, messageId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido ao enviar WhatsApp.";
        await storage.markNotificationWhatsappFailed(notification.id, message);
      }
    }
  } catch (error) {
    console.error("[whatsapp] erro no worker de notificações", error);
  } finally {
    running = false;
  }
}

export function startWhatsappNotificationWorker() {
  if (started) return;
  started = true;
  const config = loadWhatsappConfig();
  if (!config.enabled) {
    console.log("[whatsapp] notificações desabilitadas");
    return;
  }
  if (!config.token || !config.phoneNumberId) {
    console.warn("[whatsapp] WHATSAPP_META_TOKEN ou WHATSAPP_PHONE_NUMBER_ID ausente; worker desabilitado");
    return;
  }

  console.log(`[whatsapp] notificações habilitadas | modo=${config.messageMode} | intervalo=${config.intervalSeconds}s`);
  void dispatchDueWhatsappNotifications(config);
  timer = setInterval(() => {
    void dispatchDueWhatsappNotifications(config);
  }, config.intervalSeconds * 1000);
}

export function stopWhatsappNotificationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  running = false;
}
