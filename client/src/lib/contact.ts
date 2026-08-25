const supportWhatsappNumber = import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER || "551941414404";

export const supportWhatsappDisplay =
  import.meta.env.VITE_SUPPORT_WHATSAPP_DISPLAY || "+55 19 4141-4404";

export function buildSupportWhatsappUrl(message: string) {
  const normalizedNumber = String(supportWhatsappNumber).replace(/\D/g, "");
  return `https://wa.me/${normalizedNumber}?text=${encodeURIComponent(message)}`;
}
