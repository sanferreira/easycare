export function printHtmlDocument(html: string): boolean {
  if (typeof document === "undefined") return false;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  try {
    document.body.appendChild(iframe);
    const printWindow = iframe.contentWindow;
    const printDocument = printWindow?.document;
    if (!printWindow || !printDocument) {
      iframe.remove();
      return false;
    }

    let didPrint = false;

    const cleanup = () => {
      window.setTimeout(() => iframe.remove(), 1000);
    };

    printWindow.onafterprint = cleanup;
    printDocument.open();
    printDocument.write(html);
    printDocument.close();

    const runPrint = () => {
      if (didPrint) return;
      didPrint = true;
      try {
        printWindow.focus();
        printWindow.print();
        window.setTimeout(cleanup, 30_000);
      } catch {
        cleanup();
      }
    };

    iframe.onload = () => window.setTimeout(runPrint, 250);
    window.setTimeout(runPrint, 500);
    return true;
  } catch {
    iframe.remove();
    return false;
  }
}
