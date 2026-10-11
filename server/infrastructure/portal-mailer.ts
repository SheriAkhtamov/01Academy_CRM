import nodemailer, { type Transporter } from 'nodemailer';
import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import type { AppConfig } from '../config';
import type { PortalIdentityMailDelivery } from '../modules/portal-identity';
import { t } from '../lib/i18n';

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const templates = {
  invitation: ['portalEmailInvitationSubject', 'portalEmailInvitationBody', 'portalEmailInvitationAction'],
  recovery: ['portalEmailRecoverySubject', 'portalEmailRecoveryBody', 'portalEmailRecoveryAction'],
  email_change: ['portalEmailVerifySubject', 'portalEmailVerifyBody', 'portalEmailVerifyAction'],
  email_changed: ['portalEmailChangedSubject', 'portalEmailChangedBody'],
} as const;
export class PortalMailer {
  private readonly smtp: Transporter | null;
  private readonly resend: Resend | null;
  private readonly pending = new Set<AbortController>();
  private closed = false;
  constructor(private readonly config: AppConfig) {
    const email = config.email, production = config.server.environment === 'production';
    this.resend = email.resendApiKey ? new Resend(email.resendApiKey) : null;
    this.smtp = email.smtp?.host && email.smtp.user && email.smtp.pass && email.smtp.from ? nodemailer.createTransport({
      host: email.smtp.host, port: email.smtp.port ?? 587, secure: email.smtp.port === 465, requireTLS: production && email.smtp.port !== 465,
      auth: { user: email.smtp.user, pass: email.smtp.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: production },
    }) : null;
  }
  private async send(recipient: string, subject: string, text: string, action?: { label: string; url: string }, deliveryKey?: string) {
    if(this.closed)return false;
    if (action) {
      const url = new URL(action.url);
      if (url.origin !== new URL(this.config.server.appUrl).origin || url.username || url.password) return false;
    }
    const html = `<p>${escape(text)}</p>${action ? `<p><a href="${escape(action.url)}">${escape(action.label)}</a></p>` : ''}`;
    const idempotencyKey=deliveryKey ? `portal-mail-${createHash('sha256').update(deliveryKey).digest('hex')}`:undefined;
    try {
      if (this.smtp) { await this.smtp.sendMail({ from: this.config.email.smtp!.from, to: recipient, subject, text: `${text}${action ? `\n\n${action.url}` : ''}`, html,
        ...(idempotencyKey ? {messageId:`<${idempotencyKey}@${new URL(this.config.server.appUrl).hostname}>`}: {}) }); return true; }
      if (this.resend && this.config.email.smtp?.from) {
        const controller=new AbortController();this.pending.add(controller);
        const timeout=setTimeout(()=>controller.abort(),25000);timeout.unref();
        try {
          // The locked SDK forwards request options to fetch, including AbortSignal.
          const options={idempotencyKey,signal:controller.signal};
          const result = await this.resend.emails.send({ from: this.config.email.smtp.from, to: [recipient], subject, html, text:`${text}${action ? `\n\n${action.url}` : ''}` },options);
          return !result.error && Boolean(result.data?.id);
        } finally {clearTimeout(timeout);this.pending.delete(controller);}
      }
    } catch { return false; }
    return false;
  }
  async identity(delivery: PortalIdentityMailDelivery) {
    const keys = templates[delivery.template], label = keys[2];
    return this.send(delivery.recipient, t(keys[0], delivery.locale), t(keys[1], delivery.locale), delivery.url && label ? { label: t(label, delivery.locale), url: delivery.url } : undefined,delivery.deliveryKey);
  }
  async notification(delivery: { recipient: string; locale: 'ru' | 'en'; text: string; href?: string | null;deliveryKey?:string }) {
    return this.send(delivery.recipient, t('portalEmailNotificationSubject', delivery.locale), delivery.text,
      { label: t('portalEmailNotificationAction', delivery.locale), url: new URL(delivery.href ?? '/learn', this.config.server.appUrl).toString() },delivery.deliveryKey);
  }
  close() { this.closed=true;for(const controller of this.pending)controller.abort();this.smtp?.close(); }
}
