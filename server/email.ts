import { Resend } from "resend";
import { resolveAppPublicUrl } from "./app-url";

export type SignupPaymentMethod = "stripe" | "manual_boleto";

export type SignupWelcomeEmailInput = {
  to: string;
  adminName: string;
  organizationName: string;
  cnpj: string;
  username: string;
  paymentMethod: SignupPaymentMethod;
  trialDays: number;
  trialEndsAt: Date;
  loginUrl: string;
  supportWhatsappDisplay?: string | null;
};

export type SignupCommercialEmailInput = {
  organizationName: string;
  cnpj: string;
  adminName: string;
  email: string;
  phone: string;
  username: string;
  paymentMethod: SignupPaymentMethod;
  trialDays: number;
  trialEndsAt: Date;
  adminUrl: string;
};

export type PasswordResetEmailInput = {
  to: string;
  name: string;
  organizationName?: string | null;
  username: string;
  resetUrl: string;
  expiresInMinutes: number;
};

export type TrialEndingEmailInput = {
  to: string;
  adminName: string;
  organizationName: string;
  paymentMethod: SignupPaymentMethod | string | null;
  trialEndsAt: Date;
  daysLeft: number;
  billingUrl: string;
  supportWhatsappDisplay?: string | null;
};

export type TrialEndingCommercialEmailInput = {
  organizationName: string;
  cnpj?: string | null;
  email?: string | null;
  phone?: string | null;
  paymentMethod: SignupPaymentMethod | string | null;
  trialEndsAt: Date;
  daysLeft: number;
  adminUrl: string;
};

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function getFromEmail() {
  return process.env.RESEND_FROM_EMAIL?.trim() || "EasyCare <onboarding@resend.dev>";
}

function getCommercialEmail() {
  return process.env.RESEND_COMMERCIAL_EMAIL?.trim()
    || process.env.VITE_COMMERCIAL_EMAIL?.trim()
    || "";
}

function getBrandLogoUrl() {
  const configured = process.env.EMAIL_LOGO_URL?.trim();
  if (configured) return configured;
  return `${resolveAppPublicUrl()}/brand/logo-easycare-header.png`;
}

function formatDatePtBr(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: process.env.TZ || "America/Sao_Paulo",
  });
}

function paymentMethodLabel(method: string | null | undefined) {
  if (method === "manual_boleto") return "Boleto manual (equipe EasyCare)";
  if (method === "stripe") return "Stripe (cartão ou boleto)";
  return method?.trim() || "Não informado";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailShell(title: string, bodyHtml: string) {
  const logoUrl = escapeHtml(getBrandLogoUrl());
  return `
    <div style="margin:0;padding:0;background:#F4F8FC;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F4F8FC;padding:24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;border:1px solid #D5E4F2;border-radius:12px;overflow:hidden;background:#ffffff;">
              <tr>
                <td style="background:linear-gradient(135deg,#050B1F 0%,#081337 48%,#0D1A40 100%);padding:28px 28px 24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td>
                        <img src="${logoUrl}" alt="EasyCare" width="168" style="display:block;width:168px;max-width:70%;height:auto;border:0;outline:none;text-decoration:none;" />
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top:18px;">
                        <p style="margin:0;color:#76DFFF;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">EasyCare</p>
                        <h1 style="margin:10px 0 0;color:#ffffff;font-size:22px;line-height:1.35;font-weight:800;">${escapeHtml(title)}</h1>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="height:4px;background:linear-gradient(90deg,#0B5CAB 0%,#11C5D9 52%,#5F5CFF 100%);font-size:0;line-height:0;">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding:28px;background:#ffffff;">
                  ${bodyHtml}
                  <p style="margin:28px 0 0;color:#93A3B7;font-size:12px;line-height:1.6;">
                    EasyCare — Tecnologia que organiza, cuidado que transforma.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendSignupWelcomeEmail(input: SignupWelcomeEmailInput) {
  const resend = getResendClient();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY não configurada. E-mail de boas-vindas ignorado.");
    return { sent: false as const, reason: "not_configured" as const };
  }

  const paymentLabel = paymentMethodLabel(input.paymentMethod);
  const trialEnds = formatDatePtBr(input.trialEndsAt);
  const paymentHint = input.paymentMethod === "manual_boleto"
    ? "No fim do teste, nossa equipe envia o boleto manual para manter o acesso."
    : "No fim do teste, ative a assinatura na Stripe. Lá você pode pagar com cartão ou boleto. Sem cobrança durante o período gratuito.";
  const supportLine = input.supportWhatsappDisplay
    ? `<p style="margin:16px 0 0;color:#405875;font-size:14px;line-height:1.6;">WhatsApp: <strong>${escapeHtml(input.supportWhatsappDisplay)}</strong></p>`
    : "";

  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to: input.to,
    subject: `Sua conta EasyCare está pronta — ${input.trialDays} dias grátis`,
    html: emailShell(`Olá, ${input.adminName}!`, `
      <p style="margin:16px 0 0;color:#405875;font-size:15px;line-height:1.7;">
        A instituição <strong>${escapeHtml(input.organizationName)}</strong> já está cadastrada.
        Seus <strong>${input.trialDays} dias de teste</strong> começaram agora e vão até <strong>${trialEnds}</strong>.
      </p>
      <div style="margin:20px 0;padding:16px;border-radius:10px;background:#F7FBFC;border:1px solid #D8E7F5;">
        <p style="margin:0;color:#53657A;font-size:13px;line-height:1.7;">
          <strong>CNPJ:</strong> ${escapeHtml(input.cnpj)}<br/>
          <strong>Usuário:</strong> ${escapeHtml(input.username)}<br/>
          <strong>Pagamento após o teste:</strong> ${escapeHtml(paymentLabel)}
        </p>
      </div>
      <p style="margin:0;color:#405875;font-size:14px;line-height:1.7;">${escapeHtml(paymentHint)}</p>
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(input.loginUrl)}" style="display:inline-block;background:#0B5CAB;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">
          Entrar no EasyCare
        </a>
      </p>
      ${supportLine}
    `),
  });

  if (error) {
    throw new Error(error.message || "Falha ao enviar e-mail de boas-vindas.");
  }

  return { sent: true as const };
}

export async function sendSignupCommercialAlertEmail(input: SignupCommercialEmailInput) {
  const resend = getResendClient();
  const commercialEmail = getCommercialEmail();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY não configurada. Alerta comercial ignorado.");
    return { sent: false as const, reason: "not_configured" as const };
  }
  if (!commercialEmail) {
    console.warn("[email] RESEND_COMMERCIAL_EMAIL não configurada. Alerta comercial ignorado.");
    return { sent: false as const, reason: "missing_recipient" as const };
  }

  const paymentLabel = paymentMethodLabel(input.paymentMethod);
  const trialEnds = formatDatePtBr(input.trialEndsAt);
  const boletoHint = input.paymentMethod === "manual_boleto"
    ? "<p style=\"margin:16px 0 0;color:#9A3412;font-size:14px;line-height:1.6;\"><strong>Ação:</strong> cliente escolheu boleto manual. Enviar cobrança pela equipe antes do fim do teste.</p>"
    : "<p style=\"margin:16px 0 0;color:#405875;font-size:14px;line-height:1.6;\">Cliente escolheu Stripe (cartão ou boleto no checkout). Pode ativar em Cobrança após o teste.</p>";

  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to: commercialEmail,
    subject: `Novo cadastro: ${input.organizationName}`,
    html: emailShell(input.organizationName, `
      <div style="margin:20px 0;padding:16px;border-radius:10px;background:#F7FBFC;border:1px solid #D8E7F5;">
        <p style="margin:0;color:#53657A;font-size:13px;line-height:1.8;">
          <strong>CNPJ:</strong> ${escapeHtml(input.cnpj)}<br/>
          <strong>Responsável:</strong> ${escapeHtml(input.adminName)}<br/>
          <strong>E-mail:</strong> ${escapeHtml(input.email)}<br/>
          <strong>WhatsApp:</strong> ${escapeHtml(input.phone)}<br/>
          <strong>Usuário:</strong> ${escapeHtml(input.username)}<br/>
          <strong>Pagamento:</strong> ${escapeHtml(paymentLabel)}<br/>
          <strong>Trial:</strong> ${input.trialDays} dias · até ${trialEnds}
        </p>
      </div>
      ${boletoHint}
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(input.adminUrl)}" style="display:inline-block;background:#0B5CAB;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">
          Abrir Admin
        </a>
      </p>
    `),
  });

  if (error) {
    throw new Error(error.message || "Falha ao enviar alerta comercial.");
  }

  return { sent: true as const };
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput) {
  const resend = getResendClient();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY não configurada. E-mail de redefinição ignorado.");
    return { sent: false as const, reason: "not_configured" as const };
  }

  const orgLine = input.organizationName
    ? `<p style="margin:16px 0 0;color:#405875;font-size:14px;line-height:1.7;">Instituição: <strong>${escapeHtml(input.organizationName)}</strong></p>`
    : "";

  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to: input.to,
    subject: "Redefinição de senha EasyCare",
    html: emailShell(`Olá, ${input.name}`, `
      <p style="margin:16px 0 0;color:#405875;font-size:15px;line-height:1.7;">
        Recebemos um pedido para redefinir a senha do usuário <strong>${escapeHtml(input.username)}</strong>.
      </p>
      ${orgLine}
      <p style="margin:16px 0 0;color:#405875;font-size:14px;line-height:1.7;">
        Este link vale por <strong>${input.expiresInMinutes} minutos</strong>. Se você não solicitou, ignore este e-mail.
      </p>
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#0B5CAB;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">
          Redefinir senha
        </a>
      </p>
    `),
  });

  if (error) {
    throw new Error(error.message || "Falha ao enviar e-mail de redefinição de senha.");
  }

  return { sent: true as const };
}

export async function sendTrialEndingEmail(input: TrialEndingEmailInput) {
  const resend = getResendClient();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY não configurada. Lembrete de trial ignorado.");
    return { sent: false as const, reason: "not_configured" as const };
  }

  const trialEnds = formatDatePtBr(input.trialEndsAt);
  const paymentLabel = paymentMethodLabel(input.paymentMethod);
  const paymentHint = input.paymentMethod === "manual_boleto"
    ? "Como você escolheu boleto manual, fale com o suporte EasyCare para receber a cobrança e manter o acesso."
    : "Ative a assinatura na Stripe (cartão ou boleto) em Cobrança para continuar sem interrupção.";
  const supportLine = input.supportWhatsappDisplay
    ? `<p style="margin:16px 0 0;color:#405875;font-size:14px;line-height:1.6;">WhatsApp: <strong>${escapeHtml(input.supportWhatsappDisplay)}</strong></p>`
    : "";

  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to: input.to,
    subject: `Seu teste EasyCare termina em ${input.daysLeft} dia${input.daysLeft === 1 ? "" : "s"}`,
    html: emailShell(`Olá, ${input.adminName}`, `
      <p style="margin:16px 0 0;color:#405875;font-size:15px;line-height:1.7;">
        O teste grátis de <strong>${escapeHtml(input.organizationName)}</strong> termina em
        <strong>${input.daysLeft} dia${input.daysLeft === 1 ? "" : "s"}</strong> (${trialEnds}).
      </p>
      <p style="margin:16px 0 0;color:#405875;font-size:14px;line-height:1.7;">
        Forma de pagamento escolhida: <strong>${escapeHtml(paymentLabel)}</strong>. ${escapeHtml(paymentHint)}
      </p>
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(input.billingUrl)}" style="display:inline-block;background:#0B5CAB;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">
          Abrir cobrança
        </a>
      </p>
      ${supportLine}
    `),
  });

  if (error) {
    throw new Error(error.message || "Falha ao enviar lembrete de fim de trial.");
  }

  return { sent: true as const };
}

export async function sendTrialEndingCommercialEmail(input: TrialEndingCommercialEmailInput) {
  const resend = getResendClient();
  const commercialEmail = getCommercialEmail();
  if (!resend || !commercialEmail) {
    return { sent: false as const, reason: !resend ? "not_configured" as const : "missing_recipient" as const };
  }

  const trialEnds = formatDatePtBr(input.trialEndsAt);
  const paymentLabel = paymentMethodLabel(input.paymentMethod);

  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to: commercialEmail,
    subject: `Trial vencendo (${input.daysLeft}d): ${input.organizationName}`,
    html: emailShell(input.organizationName, `
      <div style="margin:20px 0;padding:16px;border-radius:10px;background:#F7FBFC;border:1px solid #D8E7F5;">
        <p style="margin:0;color:#53657A;font-size:13px;line-height:1.8;">
          <strong>CNPJ:</strong> ${escapeHtml(input.cnpj || "-")}<br/>
          <strong>E-mail:</strong> ${escapeHtml(input.email || "-")}<br/>
          <strong>WhatsApp:</strong> ${escapeHtml(input.phone || "-")}<br/>
          <strong>Pagamento:</strong> ${escapeHtml(paymentLabel)}<br/>
          <strong>Termina em:</strong> ${input.daysLeft} dia(s) · ${trialEnds}
        </p>
      </div>
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(input.adminUrl)}" style="display:inline-block;background:#0B5CAB;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">
          Abrir Admin
        </a>
      </p>
    `),
  });

  if (error) {
    throw new Error(error.message || "Falha ao enviar alerta comercial de trial.");
  }

  return { sent: true as const };
}

export type CommercialDigestEmailInput = {
  needsAction: number;
  trialEnding: number;
  billingRisk: number;
  withoutPlan: number;
  churning: number;
  estimatedMrrFormatted?: string | null;
  adminUrl: string;
};

export async function sendCommercialDigestEmail(input: CommercialDigestEmailInput) {
  const resend = getResendClient();
  const commercialEmail = getCommercialEmail();
  if (!resend || !commercialEmail) {
    return { sent: false as const, reason: !resend ? "not_configured" as const : "missing_recipient" as const };
  }

  const { error } = await resend.emails.send({
    from: getFromEmail(),
    to: commercialEmail,
    subject: `Digest Contas EasyCare — ${input.needsAction} precisam de ação`,
    html: emailShell("Digest comercial", `
      <p style="margin:0 0 16px;color:#53657A;font-size:14px;line-height:1.6;">
        Resumo diário das contas EasyCare que pedem atenção.
      </p>
      <div style="margin:20px 0;padding:16px;border-radius:10px;background:#F7FBFC;border:1px solid #D8E7F5;">
        <p style="margin:0;color:#53657A;font-size:13px;line-height:1.8;">
          <strong>Precisam de ação:</strong> ${input.needsAction}<br/>
          <strong>Trial vencendo:</strong> ${input.trialEnding}<br/>
          <strong>Risco de cobrança:</strong> ${input.billingRisk}<br/>
          <strong>Sem plano:</strong> ${input.withoutPlan}<br/>
          <strong>Churn / cancelando:</strong> ${input.churning}<br/>
          ${input.estimatedMrrFormatted ? `<strong>MRR estimado (acordos):</strong> ${escapeHtml(input.estimatedMrrFormatted)}<br/>` : ""}
        </p>
      </div>
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(input.adminUrl)}" style="display:inline-block;background:#0B5CAB;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">
          Abrir Contas
        </a>
      </p>
    `),
  });

  if (error) {
    throw new Error(error.message || "Falha ao enviar digest comercial.");
  }

  return { sent: true as const };
}
