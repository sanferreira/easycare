function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, payload] = dataUrl.split(",");
  if (!metadata || !payload || !metadata.startsWith("data:")) {
    throw new Error("Arquivo inválido.");
  }

  const mimeMatch = metadata.match(/^data:([^;]+)(;base64)?$/);
  const mimeType = mimeMatch?.[1] || "application/octet-stream";
  const isBase64 = Boolean(mimeMatch?.[2]);
  const binary = isBase64 ? window.atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export function openDataUrlFile(dataUrl: string): boolean {
  try {
    const blob = dataUrlToBlob(dataUrl);
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return Boolean(opened);
  } catch {
    return false;
  }
}

export function downloadDataUrlFile(dataUrl: string, filename: string): boolean {
  try {
    const blob = dataUrlToBlob(dataUrl);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "documento";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
