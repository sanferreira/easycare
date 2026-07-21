import { useCallback, useEffect, useState } from "react";

type BrowserNotificationPermission = NotificationPermission | "unsupported" | "insecure";

type PublicKeyResponse = {
  enabled: boolean;
  publicKey: string | null;
};

const SERVICE_WORKER_URL = "/easycare-sw.js";

function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return Notification.permission;
}

function pushIsSupported() {
  return (
    typeof window !== "undefined"
    && window.isSecureContext
    && "Notification" in window
    && "serviceWorker" in navigator
    && "PushManager" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function arraysAreEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function subscriptionUsesPublicKey(subscription: PushSubscription, publicKey: string): boolean {
  const subscriptionKey = subscription.options.applicationServerKey;
  if (!subscriptionKey) return true;
  return arraysAreEqual(new Uint8Array(subscriptionKey), urlBase64ToUint8Array(publicKey));
}

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(typeof data?.message === "string" ? data.message : fallback);
  }
  return data as T;
}

export function useBrowserNotifications() {
  const [permission, setPermission] = useState<BrowserNotificationPermission>(() => getBrowserNotificationPermission());
  const [webPushConfigured, setWebPushConfigured] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isLoadingPush, setIsLoadingPush] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const loadPublicKey = useCallback(async () => {
    const res = await fetch("/api/push-notifications/public-key", { credentials: "include" });
    const data = await parseJson<PublicKeyResponse>(res, "Erro ao carregar chave Web Push.");
    setWebPushConfigured(Boolean(data.enabled && data.publicKey));
    return data.enabled && data.publicKey ? data.publicKey : null;
  }, []);

  const getRegistration = useCallback(async () => {
    const existing = await navigator.serviceWorker.getRegistration("/");
    return existing ?? navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  }, []);

  const saveSubscription = useCallback(async (subscription: PushSubscription) => {
    await parseJson<{ id: number; enabled: boolean }>(
      await fetch("/api/push-notifications/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      }),
      "Erro ao salvar inscricao Web Push.",
    );
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return "unsupported" as const;
    }
    if (!window.isSecureContext) {
      setPermission("insecure");
      return "insecure" as const;
    }

    const nextPermission = await Notification.requestPermission();
    setPermission(nextPermission);
    return nextPermission;
  }, []);

  const enablePushNotifications = useCallback(async () => {
    setPushError(null);
    if (!pushIsSupported()) {
      const nextPermission = getBrowserNotificationPermission();
      setPermission(nextPermission);
      setPushError(nextPermission === "insecure"
        ? "Notificacoes push exigem HTTPS."
        : "Este navegador nao suporta Web Push.");
      return false;
    }

    setIsLoadingPush(true);
    try {
      const nextPermission = await requestPermission();
      if (nextPermission !== "granted") {
        setPushEnabled(false);
        setPushError(nextPermission === "denied"
          ? "Permissao de notificacao bloqueada no navegador."
          : "Permissao de notificacao nao concedida.");
        return false;
      }

      const publicKey = await loadPublicKey();
      if (!publicKey) {
        setPushEnabled(false);
        setPushError("Web Push ainda nao foi configurado no servidor.");
        return false;
      }

      const registration = await getRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !subscriptionUsesPublicKey(subscription, publicKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      await saveSubscription(subscription);
      setPushEnabled(true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao ativar Web Push.";
      setPushError(message);
      setPushEnabled(false);
      return false;
    } finally {
      setIsLoadingPush(false);
    }
  }, [getRegistration, loadPublicKey, requestPermission, saveSubscription]);

  const sendTestPushNotification = useCallback(async () => {
    setPushError(null);
    try {
      await parseJson<{ success: boolean; notificationId: number; subscriptions: number }>(
        await fetch("/api/push-notifications/test", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        }),
        "Erro ao enviar teste de Push.",
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao enviar teste de Push.";
      setPushError(message);
      return false;
    }
  }, []);

  const disablePushNotifications = useCallback(async () => {
    if (!pushIsSupported()) return false;
    setPushError(null);
    setIsLoadingPush(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push-notifications/subscriptions", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao desativar Web Push.";
      setPushError(message);
      return false;
    } finally {
      setIsLoadingPush(false);
    }
  }, []);

  const showNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (typeof window === "undefined" || !("Notification" in window)) return null;
    if (Notification.permission !== "granted") return null;
    return new Notification(title, options);
  }, []);

  useEffect(() => {
    setPermission(getBrowserNotificationPermission());
    if (!pushIsSupported()) return;

    let cancelled = false;
    loadPublicKey()
      .then(async (publicKey) => {
        if (!publicKey || cancelled) return;
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) {
          if (!cancelled) setPushEnabled(false);
          return;
        }
        if (!subscriptionUsesPublicKey(subscription, publicKey)) {
          if (!cancelled) {
            setPushEnabled(false);
            setPushError("Ativacao antiga detectada. Toque em ativar novamente neste dispositivo.");
          }
          return;
        }
        await saveSubscription(subscription);
        if (!cancelled) setPushEnabled(true);
      })
      .catch((error) => {
        if (!cancelled) {
          setWebPushConfigured(false);
          setPushError(error instanceof Error ? error.message : "Erro ao verificar Web Push.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadPublicKey, saveSubscription]);

  return {
    permission,
    supported: permission !== "unsupported" && permission !== "insecure",
    canNotify: permission === "granted",
    pushSupported: pushIsSupported(),
    webPushConfigured,
    pushEnabled,
    isLoadingPush,
    pushError,
    requestPermission,
    enablePushNotifications,
    disablePushNotifications,
    sendTestPushNotification,
    showNotification,
  };
}
