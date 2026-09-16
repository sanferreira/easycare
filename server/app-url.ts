import type { Request } from "express";

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local");
}

function isRemoteHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? !isLocalHost(url.hostname)
      : false;
  } catch {
    return false;
  }
}

/**
 * Prefer APP_PUBLIC_URL in production.
 * In development, if APP_PUBLIC_URL points to a remote/production host,
 * use the incoming request host so e-mail links stay usable locally.
 */
export function resolveAppPublicUrl(req?: Pick<Request, "protocol" | "get"> | null) {
  const configured = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "") || "";
  const isDev = (process.env.NODE_ENV || "development") !== "production";

  if (req) {
    const host = req.get("host")?.trim();
    if (host) {
      const requestUrl = trimTrailingSlash(`${req.protocol}://${host}`);
      if (isDev && configured && isRemoteHttpUrl(configured)) {
        return requestUrl;
      }
      if (!configured) return requestUrl;
    }
  }

  if (configured) return configured;
  return "http://localhost:5000";
}
