// ─── REST API Channel Adapter ───
// Exposes PAW as a REST API endpoint so users can hit PAW via HTTP.
// Lightweight HTTP server alongside the WebSocket gateway.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { config } from '../../core/config';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

interface PendingResponse {
  res: ServerResponse;
  timeout: NodeJS.Timeout;
}

export class RestApiAdapter implements ChannelAdapter {
  name: ChannelType = 'rest';
  private handler: MessageHandler | null = null;
  private server: ReturnType<typeof createServer> | null = null;
  private port: number;
  private pendingResponses = new Map<string, PendingResponse>();

  constructor() {
    this.port = parseInt(process.env.REST_API_PORT ?? '18791', 10);
  }

  async start(): Promise<void> {
    if (!this.port) {
      console.log('[PAW:REST] No REST_API_PORT configured, skipping.');
      return;
    }

    this.server = createServer((req, res) => this.handleRequest(req, res));

    this.server.listen(this.port, '127.0.0.1', () => {
      console.log(`[PAW:REST] 🌐 REST API listening on http://127.0.0.1:${this.port}`);
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    // Clean up pending responses
    for (const [, pending] of this.pendingResponses) {
      clearTimeout(pending.timeout);
      pending.res.writeHead(503);
      pending.res.end(JSON.stringify({ error: 'Server shutting down' }));
    }
    this.pendingResponses.clear();
  }

  async send(userId: string, message: string): Promise<void> {
    // Check if there's a pending HTTP response for this user
    const pending = this.pendingResponses.get(userId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingResponses.delete(userId);
      pending.res.writeHead(200, { 'Content-Type': 'application/json' });
      pending.res.end(JSON.stringify({ success: true, message }));
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS — use gateway config origins
    const allowedOrigin = config.gateway.corsOrigins.includes('*') ? '*' : config.gateway.corsOrigins[0] ?? '';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', channel: 'rest-api' }));
      return;
    }

    // Main message endpoint
    if (req.url === '/api/message' && req.method === 'POST') {
      try {
        const body = await this.readBody(req);
        const { message, user_id } = JSON.parse(body) as { message?: string; user_id?: string };

        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "message" field' }));
          return;
        }

        const userId = `rest:${user_id ?? 'anonymous'}`;

        // Store pending response (30 second timeout)
        const timeout = setTimeout(() => {
          this.pendingResponses.delete(userId);
          res.writeHead(408, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request timeout' }));
        }, 30000);

        this.pendingResponses.set(userId, { res, timeout });

        if (this.handler) {
          await this.handler(userId, message, 'api');
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const maxSize = 1024 * 1024; // 1MB limit

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxSize) {
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }
}
