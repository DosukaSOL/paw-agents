// ─── LINE Channel Adapter ───
// Connects PAW Agents to LINE via the Messaging API using native HTTP.

import * as http from 'http';
import * as crypto from 'crypto';
import { ChannelAdapter, ChannelType } from '../../core/types';
import { config } from '../../core/config';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

const LINE_API = 'https://api.line.me/v2/bot';

export class LINEAdapter implements ChannelAdapter {
  name: ChannelType = 'line';
  private handler: MessageHandler | null = null;
  private accessToken = '';
  private channelSecret = '';
  private server: http.Server | null = null;

  async start(): Promise<void> {
    this.accessToken = config.line.channelAccessToken;
    this.channelSecret = config.line.channelSecret;

    if (!this.accessToken || !this.channelSecret) {
      console.log('[PAW:LINE] No LINE_CHANNEL_ACCESS_TOKEN configured, skipping LINE channel.');
      return;
    }

    const port = parseInt(process.env.LINE_WEBHOOK_PORT ?? '18790', 10);

    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/line/webhook') {
        res.writeHead(404);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const signature = req.headers['x-line-signature'] as string;

        // Verify webhook signature
        const expected = crypto.createHmac('SHA256', this.channelSecret).update(body).digest('base64');
        if (signature !== expected) {
          res.writeHead(403);
          res.end();
          return;
        }

        try {
          const parsed = JSON.parse(body.toString()) as {
            events: Array<{ type: string; source: { userId: string }; message: { type: string; text: string } }>;
          };
          for (const event of parsed.events) {
            if (event.type === 'message' && event.message?.type === 'text') {
              const userId = `line:${event.source.userId}`;
              if (this.handler) {
                this.handler(userId, event.message.text, 'line').catch(err =>
                  console.error('[PAW:LINE] Handler error:', (err as Error).message)
                );
              }
            }
          }
        } catch {
          console.error('[PAW:LINE] Failed to parse webhook body');
        }

        res.writeHead(200);
        res.end();
      });
    });

    this.server.listen(port, () => {
      console.log(`[PAW:LINE] 💬 LINE webhook listening on port ${port}`);
    });
  }

  async stop(): Promise<void> {
    if (this.server) this.server.close();
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.accessToken) return;
    const lineId = userId.replace('line:', '');
    try {
      await fetch(`${LINE_API}/message/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({ to: lineId, messages: [{ type: 'text', text: message }] }),
      });
    } catch (err) {
      console.error('[PAW:LINE] Send failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
