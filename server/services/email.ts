import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { logger } from '../lib/logger';
import { appConfig } from '../config';

// Gemini MEDIUM #7: Escape HTML to prevent XSS in email templates
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private resend: Resend | null = null;
  private emailMethod: 'smtp' | 'resend' | 'console' = 'console';

  constructor() {
    this.initializeEmailService();
  }

  private initializeEmailService() {
    const resendApiKey = appConfig.email.resendApiKey;

    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
      this.emailMethod = 'resend';
      return;
    }

    if (appConfig.email.smtp?.user && appConfig.email.smtp?.pass) {
      this.transporter = nodemailer.createTransport({
        host: appConfig.email.smtp.host || 'smtp.gmail.com',
        port: appConfig.email.smtp.port || 587,
        secure: false,
        auth: {
          user: appConfig.email.smtp.user,
          pass: appConfig.email.smtp.pass,
        },
      });
      this.emailMethod = 'smtp';
    }
  }

  async sendWelcomeEmail(
    to: string,
    fullName: string,
    temporaryPassword: string
  ): Promise<boolean> {
    try {
      if (this.emailMethod === 'console') {
        return true;
      }

      const subject = 'Welcome to 01 Academy CRM';
      const html = `
        <h2>Welcome to 01 Academy CRM</h2>
        <p>Hello ${escapeHtml(fullName)},</p>
        <p>Your account has been created for the 01 Academy CRM. Here are your login credentials:</p>
        <ul>
          <li><strong>Email:</strong> ${escapeHtml(to)}</li>
          <li><strong>Temporary Password:</strong> ${escapeHtml(temporaryPassword)}</li>
        </ul>
        <p><strong>Important:</strong> Please change your password after your first login for security purposes.</p>
        <p>You can access the platform at: ${appConfig.server.appUrl}</p>
      `;

      return await this.sendEmail(to, subject, html, fullName);
    } catch (error) {
      logger.error('Failed to send welcome email', { error });
      return false;
    }
  }

  private async sendEmail(to: string, subject: string, html: string, fullName?: string): Promise<boolean> {
    try {
      if (this.emailMethod === 'resend' && this.resend) {
        const testDomains = ['example.com', 'test.com', 'localhost'];
        const isTestDomain = testDomains.some(domain => to.includes(domain));

        if (isTestDomain) {
          logger.info('Test email skipped', { to });
          return true;
        }

        const { data, error } = await this.resend.emails.send({
          from: '01 Academy CRM <noreply@resend.dev>',
          to: [to],
          subject,
          html,
        });

        if (error) {
          logger.error('Resend API error', { error, to });
          const anyErr = error as { statusCode?: number; message?: string };
          if (anyErr.statusCode === 403 && anyErr.message?.includes('testing emails')) {
            logger.info('Test email skipped because Resend account is in testing mode', { to });
            return true;
          }
          return false;
        }

        if (data?.id) {
          logger.info('Email sent', { id: data.id, to, fullName });
        }

        return true;
      }

      if (this.emailMethod === 'smtp' && this.transporter) {
        await this.transporter.sendMail({
          from: appConfig.email.smtp?.from || appConfig.email.smtp?.user,
          to,
          subject,
          html,
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to send email', { error, to });
      return false;
    }
  }
}

export const emailService = new EmailService();
