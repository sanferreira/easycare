self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "EasyCare";
  const options = {
    body: payload.body || payload.message || "Nova notificacao recebida.",
    icon: payload.icon || "/favicon.png",
    badge: payload.badge || "/favicon.png",
    tag: payload.tag || `easycare-notification-${payload.id || Date.now()}`,
    data: {
      url: payload.url || "/notificacoes",
      notificationId: payload.id || null,
    },
    timestamp: payload.timestamp || Date.now(),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "/notificacoes",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const sameOriginClients = clients.filter((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      const existingClient = sameOriginClients[0];
      if (existingClient) {
        if ("navigate" in existingClient) {
          return existingClient.navigate(targetUrl).then((client) => client?.focus());
        }
        return existingClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
