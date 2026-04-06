// ─── SMS Channel Adapter (Twilio) ───
// Sends and receives SMS via Twilio API.

import type { ChannelAdapter, ChannelType } from '../../core/types';
import * as http from 'http';
import * as https from 'https';

export interface SMSConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  webhookPort?: number;
}

export class SMSAdapter implements ChannelAdapter {
  readonly name: ChannelType = 'sms';
  private config: SMSConfig;
  private handler: ((userId: string, message: string, channel: ChannelType) => Promise<void>) | null = null;
  private webhookServer: http.Server | null = null;

  constructor(config: SMSConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const port = this.config.webhookPort ?? 3100;

    this.webhookServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/sms') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const from = params.get('From') ?? '';
          const text = params.get('Body') ?? '';

          if (from && text && this.handler) {
            this.handler(from, text, 'sms')
              .then(() => {
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                res.end(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
              })
              .catch(() => {
                res.writeHead(500);
                res.end();
              });
          } else {
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.webhookServer.listen(port, () => {
      console.log(`[SMS] Webhook server listening on port ${port}`);
    });
  }

  async stop(): Promise<void> {
    if (this.webhookServer) {
      this.webhookServer.close();
      this.webhookServer = null;
    }
  }

  onMessage(handler: (userId: string, message: string, channel: ChannelType) => Promise<void>): void {
    this.handler = handler;
  }

  async send(userId: string, message: string): Promise<void> {
    const to = userId;
    const body = `Body=${encodeURIComponent(message)}&From=${encodeURIComponent(this.config.fromNumber)}&To=${encodeURIComponent(to)}`;

    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.twilio.com',
          path: `/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
            'Authorization': `Basic ${auth}`,
          },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`Twilio API returned ${res.statusCode}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
