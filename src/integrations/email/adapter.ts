// ─── Email Channel Adapter ───
// IMAP inbox monitoring + SMTP sending via nodemailer.

import type { ChannelAdapter, ChannelType } from '../../core/types';

export interface EmailConfig {
  imap: {
    host: string;
    port: number;
    user: string;
    password: string;
    tls: boolean;
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    password: string;
    secure: boolean;
  };
  fromAddress: string;
  pollIntervalMs?: number;
}

interface PendingReply {
  to: string;
  subject: string;
}

export class EmailAdapter implements ChannelAdapter {
  readonly name: ChannelType = 'email';
  private config: EmailConfig;
  private handler: ((userId: string, message: string, channel: ChannelType) => Promise<void>) | null = null;
  private polling: ReturnType<typeof setInterval> | null = null;
  private pendingReplies: Map<string, PendingReply> = new Map();

  constructor(config: EmailConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    // Start IMAP polling
    const interval = this.config.pollIntervalMs ?? 30_000;
    this.polling = setInterval(() => this.checkInbox(), interval);
    console.log(`[EMAIL] Adapter started, polling every ${interval / 1000}s`);
  }

  async stop(): Promise<void> {
    if (this.polling) {
      clearInterval(this.polling);
      this.polling = null;
    }
  }

  onMessage(handler: (userId: string, message: string, channel: ChannelType) => Promise<void>): void {
    this.handler = handler;
  }

  async send(userId: string, message: string): Promise<void> {
    const pending = this.pendingReplies.get(userId);
    const to = pending?.to ?? userId;
    const subject = pending ? `Re: ${pending.subject}` : 'PAW Agent Response';

    try {
      const nodemailer = await import('nodemailer' as string);
      const transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        auth: {
          user: this.config.smtp.user,
          pass: this.config.smtp.password,
        },
      });

      const safeHtml = message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      await transporter.sendMail({
        from: this.config.fromAddress,
        to,
        subject,
        text: message,
        html: `<div style="font-family: sans-serif; padding: 16px;">
          <h3 style="color: #7c3aed;">🐾 PAW Agent</h3>
          <div style="white-space: pre-wrap;">${safeHtml}</div>
        </div>`,
      });

      this.pendingReplies.delete(userId);
    } catch (error) {
      console.error('[EMAIL] Send failed:', error);
    }
  }

  private async checkInbox(): Promise<void> {
    // Uses IMAP to check for new messages
    try {
      const Imap = (await import('imap' as string)).default;
      const imap = new Imap({
        user: this.config.imap.user,
        password: this.config.imap.password,
        host: this.config.imap.host,
        port: this.config.imap.port,
        tls: this.config.imap.tls,
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (_err: Error | null, _box: unknown) => {
          // Search for unseen messages
          imap.search(['UNSEEN'], (err: Error | null, results: number[]) => {
            if (err || !results.length) {
              imap.end();
              return;
            }

            const fetch = imap.fetch(results, { bodies: ['HEADER.FIELDS (FROM SUBJECT)', 'TEXT'], markSeen: true });
            fetch.on('message', (msg: Record<string, Function>) => {
              let from = '';
              let subject = '';
              let body = '';

              msg.on('body', (stream: Record<string, Function>, info: Record<string, string>) => {
                let data = '';
                stream.on('data', (chunk: Buffer) => { data += chunk.toString('utf-8'); });
                stream.on('end', () => {
                  if (info.which === 'TEXT') {
                    body = data.slice(0, 2000); // Limit body size
                  } else {
                    const fromMatch = data.match(/From:\s*(.+)/i);
                    const subjectMatch = data.match(/Subject:\s*(.+)/i);
                    if (fromMatch) from = fromMatch[1].trim();
                    if (subjectMatch) subject = subjectMatch[1].trim();
                  }
                });
              });

              msg.on('end', () => {
                if (from && body && this.handler) {
                  const userId = from.replace(/.*<(.+)>.*/, '$1');
                  this.pendingReplies.set(userId, { to: userId, subject });
                  this.handler(userId, body, 'email').catch((err) => {
                    console.error('[EMAIL] Handler error:', err);
                  });
                }
              });
            });

            fetch.once('end', () => imap.end());
          });
        });
      });

      imap.connect();
    } catch {
      // IMAP not available — skip
    }
  }
}
