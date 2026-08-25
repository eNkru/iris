import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { getEnv, logger } from "@iris/utils";

let transporter: Transporter | null = null;

/**
 * Lazily created nodemailer transporter. SMTP transport is required for
 * magic-link login emails; the same transport will back the future email
 * alert channel (R12).
 */
export function getSmtpTransporter(): Transporter {
  if (!transporter) {
    const env = getEnv();
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER !== ""
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

export interface SendMagicLinkParams {
  email: string;
  url: string;
}

/**
 * Escape a string for safe insertion into HTML text content or attribute values.
 * Escapes `& < > " '` so a URL with query delimiters or stray markup can't break
 * out of the `<a href="...">`/text node in the magic-link email body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendMagicLinkEmail(params: SendMagicLinkParams): Promise<void> {
  const env = getEnv();
  const safeUrl = escapeHtml(params.url);

  try {
    await getSmtpTransporter().sendMail({
      from: env.SMTP_FROM,
      to: params.email,
      subject: "Sign in to Iris",
      text: `Sign in to Iris using this link: ${params.url}`,
      html: `<p>Sign in to Iris using this link:</p><p><a href="${safeUrl}">${safeUrl}</a></p>`,
    });
  } catch (error) {
    // Structured context only — no secrets (SMTP password is never held here,
    // and the link URL/HTML body are intentionally excluded). Rethrow so the
    // caller still surfaces the magic-link send failure to the user.
    logger.error("Magic link email send failed", {
      to: params.email,
      from: env.SMTP_FROM,
      subject: "Sign in to Iris",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  logger.info("Magic link email sent", { email: params.email });
}
