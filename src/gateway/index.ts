// ─── PAW Gateway ───
// WebSocket-based control plane for real-time agent communication.
// Supports multi-client connections, authentication, and channel routing.

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';
import { timingSafeEqual } from 'crypto';
import { config } from '../core/config';
import { GatewayClient, GatewayMessage, ChannelType } from '../core/types';
import { PawAgent } from '../agent/loop';
import { getDashboardHTML } from '../dashboard/index';
import { missionControl } from '../mission-control/index';
import { crossAppSync } from '../sync/cross-app';
import { StreamingEngine, StreamChunk } from '../models/streaming';

interface ConnectedClient {
  ws: WebSocket;
  info: GatewayClient;
  authenticated: boolean;
}

export class PawGateway {
  private wss: WebSocketServer | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private clients = new Map<string, ConnectedClient>();
  private agent: PawAgent;
  private streaming: StreamingEngine;

  constructor(agent: PawAgent) {
    this.agent = agent;
    this.streaming = new StreamingEngine();
  }

  async start(): Promise<void> {
    const { port, host, corsOrigins } = config.gateway;

    // HTTP server for health checks + webhook endpoints
    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      // CORS headers
      const origin = req.headers.origin ?? '';
      if (corsOrigins.includes('*')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      } else if (origin && corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          version: '3.6.0',
          clients: this.clients.size,
          uptime: process.uptime(),
        }));
        return;
      }

      // Serve dashboard at root
      if (req.url === '/' || req.url === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML());
        return;
      }

      // Serve logo asset
      if (req.url === '/assets/logo-transparent.png') {
        try {
          const logoPath = join(__dirname, '..', '..', 'assets', 'logo-transparent.png');
          const data = readFileSync(logoPath);
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end();
        }
        return;
      }

      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          agent: 'online',
          channels: this.getActiveChannels(),
          clients: this.clients.size,
          mode: config.agent.mode,
        }));
        return;
      }

      // Mission Control state
      if (req.url === '/api/mission-control') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(missionControl.getState()));
        return;
      }

      // Action history
      if (req.url?.startsWith('/api/actions')) {
        const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
        const channel = url.searchParams.get('channel') as ChannelType | null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(crossAppSync.getActionHistory(limit, channel ?? undefined)));
        return;
      }

      // Sync stats
      if (req.url === '/api/sync/stats') {
        const stats = crossAppSync.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sessions: stats.sessions,
          memories: stats.memories,
          actions: stats.actions,
          channels: Array.from(stats.channels),
        }));
        return;
      }

      // Webhook endpoint for external triggers
      if (req.url?.startsWith('/webhook/') && req.method === 'POST') {
        this.handleWebhook(req, res);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    // WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: 65536 });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const clientId = uuid();
      const client: ConnectedClient = {
        ws,
        info: {
          id: clientId,
          channel: 'webchat' as ChannelType,
          connected_at: new Date().toISOString(),
          session_id: uuid(),
        },
        authenticated: !config.gateway.authToken, // If no auth token set, auto-auth
      };

      this.clients.set(clientId, client);
      console.log(`[Gateway] Client connected: ${clientId}`);

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'event',
        channel: 'webchat',
        from: 'system',
        payload: { event: 'connected', client_id: clientId, requires_auth: !!config.gateway.authToken },
        timestamp: new Date().toISOString(),
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as GatewayMessage & { auth_token?: string };

          // Handle auth — accept auth_token on any message type
          if (!client.authenticated) {
            if (this.safeCompare(msg.auth_token ?? '', config.gateway.authToken)) {
              client.authenticated = true;
              this.sendToClient(clientId, {
                type: 'event',
                channel: 'webchat',
                from: 'system',
                payload: { event: 'authenticated' },
                timestamp: new Date().toISOString(),
              });
              // Fall through to process the message if it has content
              if (msg.type !== 'message' && msg.type !== 'command') return;
            } else {
              this.sendToClient(clientId, {
                type: 'event',
                channel: 'webchat',
                from: 'system',
                payload: { event: 'auth_required' },
                timestamp: new Date().toISOString(),
              });
              return;
            }
          }

          // Route message to agent
          if (msg.type === 'message') {
            const userId = client.info.user_id ?? `webchat:${clientId}`;
            const channel = client.info.channel;
            const startTime = Date.now();

            // Track in cross-app sync
            crossAppSync.addChannelToSession(userId, channel);
            crossAppSync.addMessage(userId, String(msg.payload), 'user', channel);
            missionControl.recordMessage();

            const response = await this.agent.process(userId, String(msg.payload));
            const durationMs = Date.now() - startTime;

            // Record in cross-app sync and mission control
            crossAppSync.addMessage(userId, typeof response === 'string' ? response : JSON.stringify(response), 'agent', channel);
            crossAppSync.recordAction('agent_response', String(msg.payload).substring(0, 100), channel, userId, durationMs, true);
            missionControl.recordResponseTime(durationMs);

            this.sendToClient(clientId, {
              type: 'response',
              channel: 'webchat',
              from: 'agent',
              payload: response,
              timestamp: new Date().toISOString(),
            });

            // Broadcast sync event to all other clients
            this.broadcastSync(clientId, channel);
          }

          // Handle commands
          if (msg.type === 'command') {
            await this.handleCommand(clientId, msg);
          }

          // Handle streaming requests — token-by-token via WebSocket
          if (msg.type === 'stream' || ((msg as any).stream === true && msg.type === 'message')) {
            const userId = client.info.user_id ?? `webchat:${clientId}`;
            const channel = client.info.channel;
            const startTime = Date.now();
            const systemPrompt = 'You are PAW, an autonomous AI agent. Be helpful, concise, and accurate.';

            crossAppSync.addChannelToSession(userId, channel);
            crossAppSync.addMessage(userId, String(msg.payload), 'user', channel);
            missionControl.recordMessage();

            try {
              const fullResponse = await this.streaming.stream(
                systemPrompt,
                String(msg.payload),
                (chunk: StreamChunk) => {
                  this.sendToClient(clientId, {
                    type: 'stream' as any,
                    channel: 'webchat',
                    from: 'agent',
                    payload: {
                      text: chunk.text,
                      done: chunk.done,
                      provider: chunk.provider,
                      model: chunk.model,
                      token_count: chunk.token_count,
                    },
                    timestamp: new Date().toISOString(),
                  });
                }
              );

              const durationMs = Date.now() - startTime;
              crossAppSync.addMessage(userId, fullResponse, 'agent', channel);
              crossAppSync.recordAction('agent_stream_response', String(msg.payload).substring(0, 100), channel, userId, durationMs, true);
              missionControl.recordResponseTime(durationMs);
            } catch (err) {
              this.sendToClient(clientId, {
                type: 'event',
                channel: 'webchat',
                from: 'system',
                payload: { event: 'error', message: 'Streaming failed' },
                timestamp: new Date().toISOString(),
              });
            }
          }
        } catch (err) {
          this.sendToClient(clientId, {
            type: 'event',
            channel: 'webchat',
            from: 'system',
            payload: { event: 'error', message: 'Invalid message format' },
            timestamp: new Date().toISOString(),
          });
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[Gateway] Client disconnected: ${clientId}`);
      });

      ws.on('error', (err: Error) => {
        console.error(`[Gateway] Client error ${clientId}:`, err.message);
        this.clients.delete(clientId);
      });
    });

    this.httpServer.listen(port, host, () => {
      console.log(`[PAW:Gateway] 🌐 Gateway running on ws://${host}:${port}`);
      console.log(`[PAW:Gateway] 🏥 Health check: http://${host}:${port}/health`);
    });
  }

  async stop(): Promise<void> {
    for (const [, client] of this.clients) {
      client.ws.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.httpServer?.close();
  }

  // ─── Send message to a specific client ───
  private sendToClient(clientId: string, msg: GatewayMessage): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  // ─── Broadcast to all authenticated clients ───
  broadcast(msg: GatewayMessage): void {
    for (const [, client] of this.clients) {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(msg));
      }
    }
  }

  // ─── Handle gateway commands ───
  private async handleCommand(clientId: string, msg: GatewayMessage): Promise<void> {
    const payload = msg.payload as { command?: string; [key: string]: unknown };
    const command = payload?.command;

    switch (command) {
      case 'status':
        this.sendToClient(clientId, {
          type: 'response',
          channel: 'webchat',
          from: 'system',
          payload: {
            clients: this.clients.size,
            mode: config.agent.mode,
            channels: this.getActiveChannels(),
          },
          timestamp: new Date().toISOString(),
        });
        break;

      case 'set_mode':
        const mode = payload.mode as string;
        if (mode === 'autonomous' || mode === 'supervised' || mode === 'free') {
          const userId = `webchat:${clientId}`;
          this.agent.setUserMode(userId, mode);
          this.sendToClient(clientId, {
            type: 'response',
            channel: 'webchat',
            from: 'system',
            payload: { event: 'mode_changed', mode },
            timestamp: new Date().toISOString(),
          });
        }
        break;

      default:
        this.sendToClient(clientId, {
          type: 'response',
          channel: 'webchat',
          from: 'system',
          payload: { error: 'Unknown command' },
          timestamp: new Date().toISOString(),
        });
    }
  }

  // ─── Handle webhook requests ───
  private handleWebhook(req: IncomingMessage, res: ServerResponse): void {
    // Validate webhook secret from Authorization header or query param
    const authHeader = req.headers['authorization'];
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const querySecret = url.searchParams.get('secret');
    const webhookSecret = config.gateway.authToken;

    if (webhookSecret) {
      const providedSecret = authHeader?.replace(/^Bearer\s+/i, '') ?? querySecret;
      if (!this.safeCompare(providedSecret ?? '', webhookSecret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    const chunks: Buffer[] = [];
    let bodySize = 0;
    const MAX_BODY_SIZE = 1_048_576; // 1MB
    let exceeded = false;
    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        exceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (exceeded) return;
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        const data = JSON.parse(body);
        const webhookId = req.url?.split('/webhook/')[1]?.split('?')[0] ?? '';

        // Validate webhook ID format (alphanumeric, hyphens, underscores only)
        if (!webhookId || !/^[a-zA-Z0-9_-]+$/.test(webhookId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid webhook ID' }));
          return;
        }

        // Process the webhook as a system message
        const response = await this.agent.process(
          `webhook:${webhookId}`,
          `Webhook trigger: ${JSON.stringify(data)}`
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  }

  private getActiveChannels(): string[] {
    const channels = new Set<string>();
    for (const [, client] of this.clients) {
      channels.add(client.info.channel);
    }
    return Array.from(channels);
  }

  // ─── Broadcast sync state to all other clients ───
  private broadcastSync(excludeClientId: string, sourceChannel: ChannelType): void {
    const syncPayload: GatewayMessage = {
      type: 'event',
      channel: sourceChannel,
      from: 'system',
      payload: {
        event: 'sync',
        metrics: missionControl.getCurrentMetrics(),
        syncStats: {
          sessions: crossAppSync.getStats().sessions,
          actions: crossAppSync.getStats().actions,
        },
      },
      timestamp: new Date().toISOString(),
    };

    for (const [id, client] of this.clients) {
      if (id !== excludeClientId && client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(syncPayload));
      }
    }
  }

  // ─── Timing-safe string comparison ───
  private safeCompare(a: string, b: string): boolean {
    if (!a || !b) return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    const maxLen = Math.max(bufA.length, bufB.length);
    const paddedA = Buffer.alloc(maxLen, 0);
    const paddedB = Buffer.alloc(maxLen, 0);
    bufA.copy(paddedA, 0, 0, bufA.length);
    bufB.copy(paddedB, 0, 0, bufB.length);
    const equal = timingSafeEqual(paddedA, paddedB);
    return equal && bufA.length === bufB.length;
  }
}
