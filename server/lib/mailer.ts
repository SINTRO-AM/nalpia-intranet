import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "../config.js";
import { escapeHtml } from "./util.js";
import { tr } from "./i18n.js";

/**
 * System emails (invitation, password reset) via SMTP – optional.
 * Without SMTP configuration, the admin UI shows the links for copying.
 */
export class SystemMailer {
  private transport: Transporter | null = null;
  public sent: { to: string; subject: string; text: string }[] = []; // for tests/demo
  constructor(private config: Config) {
    if (config.smtpEnabled) {
      this.transport = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        auth: { user: config.SMTP_USER!, pass: config.SMTP_PASS! },
      });
    }
  }

  get enabled() {
    return this.transport !== null;
  }

  async send(to: string, subject: string, lines: string[], cta?: { label: string; url: string }) {
    const text = [...lines, ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), "", "– " + this.config.APP_NAME].join("\n");
    if (!this.transport) {
      this.sent.push({ to, subject, text });
      return false;
    }
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#0F1B2D;max-width:520px">
${lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join("")}
${
  cta
    ? `<p style="margin:20px 0"><a href="${escapeHtml(cta.url)}" style="background:#0C2A57;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:600">${escapeHtml(cta.label)}</a></p>
<p style="margin:0 0 12px;color:#56667C;font-size:13px">${tr("Or copy this link", "Oder kopiere diesen Link")}: ${escapeHtml(cta.url)}</p>`
    : ""
}
<p style="margin:24px 0 0;color:#56667C;font-size:13px">${escapeHtml(this.config.APP_NAME)}</p></div>`;
    await this.transport.sendMail({ from: this.config.SMTP_FROM || this.config.SMTP_USER, to, subject, text, html });
    return true;
  }
}
