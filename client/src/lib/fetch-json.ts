export async function fetchJsonOrThrow<T>(
  path: string,
  fallbackMessage: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
  });

  const rawBody = await response.text();
  let payload: unknown = null;

  if (rawBody.trim().length > 0) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Sem permissao para visualizar este conteudo.");
    }

    const apiMessage =
      payload && typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message?: unknown }).message ?? "")
        : "";

    if (apiMessage) {
      throw new Error(apiMessage);
    }

    if (rawBody.trim().startsWith("<!DOCTYPE")) {
      throw new Error("Resposta invalida do servidor. Verifique se a API foi atualizada.");
    }

    throw new Error(fallbackMessage);
  }

  if (payload === null && rawBody.trim().length > 0) {
    throw new Error("Resposta invalida do servidor.");
  }

  return payload as T;
}
