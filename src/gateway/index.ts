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
import { MODEL_CATALOG, findProvider, findModel, recommendedModel } from '../models/catalog';
import { getCostTracker, getUserDailyBudgetUsd, CostTracker } from '../intelligence/cost-tracker';

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

  private getDefaultModel(): string {
    const p = config.models.defaultProvider;
    const providerModels: Record<string, string | undefined> = {
      openai: config.models.openai.model,
      anthropic: 'claude-sonnet-4-20250514',
      google: config.models.google.model,
      groq: config.models.groq.model,
      mistral: config.models.mistral.model,
      deepseek: config.models.deepseek.model,
      ollama: config.models.ollama.model,
    };
    return providerModels[p] ?? 'unknown';
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

      if (req.url?.startsWith('/health')) {
        const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
        const deep = url.searchParams.get('deep') === '1';
        if (!deep) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            version: '4.0.5',
            clients: this.clients.size,
            uptime: process.uptime(),
          }));
          return;
        }
        // Deep probe: check provider reachability.
        this.runDeepHealth().then((deepResult) => {
          const httpStatus = deepResult.status === 'ok' ? 200 : 503;
          res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(deepResult));
        }).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: err?.message ?? 'unknown' }));
        });
        return;
      }

      // Prometheus metrics endpoint.
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(this.renderPrometheus());
        return;
      }

      // Usage / cost endpoint.
      if (req.url?.startsWith('/api/usage')) {
        const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
        const userId = url.searchParams.get('userId');
        const tracker = getCostTracker();
        if (userId) {
          const u = tracker.getUserUsage(userId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            user: u,
            today_spend_usd: tracker.getTodaySpend(userId),
            budget: tracker.checkBudget(userId, getUserDailyBudgetUsd()),
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            global: tracker.getGlobalUsage(),
            recent: tracker.getRecent(50),
            budget_per_user_usd: getUserDailyBudgetUsd(),
          }));
        }
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

      // ─── Providers / Models catalog ───
      if (req.url === '/api/providers' && req.method === 'GET') {
        const router = this.agent.getRouter();
        const registered = new Set(router.getAvailableProviders());
        const activeProvider = router.getDefaultProviderName();
        const payload = {
          active_provider: activeProvider,
          active_model: activeProvider ? router.getProviderModel(activeProvider) : null,
          providers: MODEL_CATALOG.map(p => ({
            id: p.id,
            label: p.label,
            envKey: p.envKey,
            docsUrl: p.docsUrl,
            signupUrl: p.signupUrl,
            free: !!p.free,
            configured: registered.has(p.id),
            current_model: registered.has(p.id) ? router.getProviderModel(p.id) : null,
            models: p.models,
          })),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.url === '/api/providers/select' && req.method === 'POST') {
        this.handleSelectProvider(req, res);
        return;
      }

      // ─── Voice STT (audio upload → transcript) ───
      if (req.url === '/api/voice/stt' && req.method === 'POST') {
        this.handleVoiceSTT(req, res);
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

      // Send initial sync with metrics so the Hub has data immediately
      if (client.authenticated) {
        this.sendToClient(clientId, {
          type: 'event',
          channel: 'webchat',
          from: 'system',
          payload: {
            event: 'sync',
            metrics: missionControl.getCurrentMetrics(),
            provider: config.models.defaultProvider,
            model: this.getDefaultModel(),
            connectedAgents: this.clients.size,
            connectedChannels: this.getActiveChannels().length,
            syncStats: {
              sessions: crossAppSync.getStats().sessions,
              actions: crossAppSync.getStats().actions,
            },
          },
          timestamp: new Date().toISOString(),
        });
      }

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
            const messageText = typeof msg.payload === 'string'
              ? msg.payload
              : typeof msg.payload === 'object' && msg.payload !== null
                ? (msg.payload as any).text ?? JSON.stringify(msg.payload)
                : '';

            if (!messageText) {
              this.sendToClient(clientId, {
                type: 'response',
                channel: 'webchat',
                from: 'system',
                payload: { error: 'Empty message' },
                timestamp: new Date().toISOString(),
              });
              return;
            }

            const userId = client.info.user_id ?? `webchat:${clientId}`;
            const channel = client.info.channel;
            const startTime = Date.now();

            // Track in cross-app sync
            crossAppSync.addChannelToSession(userId, channel);
            crossAppSync.addMessage(userId, messageText, 'user', channel);
            missionControl.recordMessage();

            let response: unknown;
            try {
              response = await this.agent.process(userId, messageText);
            } catch (processErr) {
              console.error('[Gateway] agent.process error:', (processErr as Error).message);
              this.sendToClient(clientId, {
                type: 'event',
                channel: 'webchat',
                from: 'system',
                payload: { event: 'error', message: 'Agent processing failed' },
                timestamp: new Date().toISOString(),
              });
              return;
            }
            const durationMs = Date.now() - startTime;

            // Record in cross-app sync and mission control
            crossAppSync.addMessage(userId, typeof response === 'string' ? response : JSON.stringify(response), 'agent', channel);
            crossAppSync.recordAction('agent_response', messageText.substring(0, 100), channel, userId, durationMs, true);
            missionControl.recordResponseTime(durationMs);

            this.sendToClient(clientId, {
              type: 'response',
              channel: 'webchat',
              from: 'agent',
              payload: response,
              timestamp: new Date().toISOString(),
            });

            // If response contains a hub_control directive, broadcast it to all clients
            const agentResp = response as { hub_control?: { action: string; [key: string]: unknown } };
            if (agentResp?.hub_control) {
              this.broadcast({
                type: 'hub_control',
                channel: 'system',
                from: 'agent',
                payload: agentResp.hub_control,
                timestamp: new Date().toISOString(),
              });
            }

            // Send sync to ALL clients including the sender
            this.broadcastSyncToAll(channel);
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
            const systemPrompt = `You are PAW — a versatile AI assistant. Be natural and conversational. Match the user's tone: casual for casual, technical for technical. Help with anything — coding, writing, research, brainstorming, or just chatting. Be concise, warm, and real.

WHAT YOU ARE (runtime self-awareness):
- You are PAW Agents v4.x, a self-hosted, open-source AI agent framework running on the user's own machine right now as a Node.js process (gateway ws://127.0.0.1:18789, MCP :18790, REST :18791).
- You ARE the backend. There is no separate cloud service to build.
- You have built-in messaging channels for Telegram, Discord, Slack, LINE, Reddit, Matrix, Twitter, GitHub, Notion, Calendar, MQTT, RSS, and Desktop notifications. Each one only needs an API token / credential in the .env file to activate — no extra backend, no webhook server, no cloud hosting required.
- For Telegram: the user just sets TELEGRAM_BOT_TOKEN in .env and you handle polling, message routing, and replies automatically. Do NOT tell them to build a Flask/Express webhook server.
- For 24/7 uptime: pm2, systemd, launchd, Docker — but the "backend" itself is already you.
- Built-ins: multi-agent crews, workflow graphs, browser automation, vector memory, RAG, plugin system, Purp SCL compiler v2.2.0, Solana skills, profiler, daemon mode, dashboard, Electron desktop hub, mobile + browser-extension clients.
- When asked "how do I run you on X" or "can you do Y", check built-ins before suggesting infra-from-scratch.

You have tools for Solana, browser automation, file ops, and more — but only mention them when relevant to what the user asks. Never open by listing capabilities.`;

            crossAppSync.addChannelToSession(userId, channel);
            crossAppSync.addMessage(userId, String(msg.payload), 'user', channel);
            missionControl.recordMessage();

            // ─── Per-user daily USD budget enforcement ───
            const dailyBudget = getUserDailyBudgetUsd();
            if (dailyBudget > 0) {
              const check = getCostTracker().checkBudget(userId, dailyBudget);
              if (!check.allowed) {
                this.sendToClient(clientId, {
                  type: 'event',
                  channel: 'webchat',
                  from: 'system',
                  payload: {
                    event: 'error',
                    error: 'BUDGET_EXCEEDED',
                    message: `Daily LLM budget reached (spent $${check.spentTodayUsd.toFixed(4)} / $${check.budgetUsd.toFixed(2)}). Resets at ${check.resetAtUtc}.`,
                    budget: check,
                  },
                  timestamp: new Date().toISOString(),
                });
                return;
              }
            }

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
              // Record cost. Output tokens come from streaming counter via fullResponse length;
              // input tokens estimated from prompt + system prompt.
              try {
                const inTok = CostTracker.estimateTokens(systemPrompt) + CostTracker.estimateTokens(String(msg.payload));
                const outTok = CostTracker.estimateTokens(fullResponse);
                const provider = config.models.defaultProvider;
                const model = this.getDefaultModel();
                getCostTracker().record(userId, provider, model, inTok, outTok);
              } catch { /* tracking is best-effort */ }
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
    // Close all WebSocket clients
    for (const [, client] of this.clients) {
      client.ws.close();
    }
    this.clients.clear();
    this.wss?.close();
    // Properly close HTTP server with a promise
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
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

      case 'hub_control':
        // Broadcast hub control directive to all connected clients (Hub will act on it)
        this.broadcast({
          type: 'hub_control',
          channel: 'system',
          from: 'agent',
          payload: { action: payload.action, ...payload },
          timestamp: new Date().toISOString(),
        });
        this.sendToClient(clientId, {
          type: 'response',
          channel: 'webchat',
          from: 'system',
          payload: { event: 'hub_control_sent', action: payload.action },
          timestamp: new Date().toISOString(),
        });
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
    // Validate webhook secret from Authorization header only (never query params)
    const authHeader = req.headers['authorization'];
    const webhookSecret = config.gateway.authToken;

    if (webhookSecret) {
      const providedSecret = authHeader?.replace(/^Bearer\s+/i, '') ?? '';
      if (!this.safeCompare(providedSecret, webhookSecret)) {
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

  // ─── Provider switch handler ───
  private handleSelectProvider(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 4096;
    let exceeded = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        exceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Body too large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (exceeded) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { provider?: string; model?: string };
        const provider = String(body.provider ?? '').trim();
        const model = String(body.model ?? '').trim();
        if (!provider) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'provider is required' }));
          return;
        }
        const catalogProvider = findProvider(provider);
        if (!catalogProvider) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown provider "${provider}"` }));
          return;
        }
        const router = this.agent.getRouter();
        const setProv = router.setDefaultProvider(provider);
        if (!setProv.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: setProv.error }));
          return;
        }
        const targetModel = model || (recommendedModel(provider)?.id ?? '');
        if (targetModel) {
          // If user passed an unknown model, allow it but warn (provider may have new models not in catalog yet)
          const known = !!findModel(provider, targetModel);
          const setModel = router.setProviderModel(provider, targetModel);
          if (!setModel.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: setModel.error }));
            return;
          }
          // Mutate live config so syncs / cost tracking stay consistent
          (config.models as any).defaultProvider = provider;
          if ((config.models as any)[provider]) {
            (config.models as any)[provider].model = targetModel;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, provider, model: targetModel, known_model: known }));
        } else {
          (config.models as any).defaultProvider = provider;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, provider, model: router.getProviderModel(provider) ?? null }));
        }
        // Push a fresh sync to all clients so the UI updates
        this.broadcastSyncToAll('hub' as ChannelType);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    req.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request error' }));
    });
  }

  // ─── Voice STT handler (audio upload → transcript) ───
  private async handleVoiceSTT(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_AUDIO = 10 * 1024 * 1024; // 10MB cap
    let exceeded = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_AUDIO) {
        exceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Audio too large (max 10MB)' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (exceeded) return;
      const audio = Buffer.concat(chunks);
      if (audio.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Empty audio body' }));
        return;
      }
      const contentType = req.headers['content-type'] ?? 'audio/webm';
      try {
        const transcript = await this.transcribeAudio(audio, contentType);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, transcript }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    req.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upload error' }));
    });
  }

  // ─── Transcribe with OpenAI Whisper API first, fall back to local whisper CLI. ───
  private async transcribeAudio(audio: Buffer, contentType: string): Promise<string> {
    const openaiKey = config.models.openai?.apiKey;
    if (openaiKey) {
      try {
        const ext = contentType.includes('mp3') ? 'mp3'
          : contentType.includes('wav') ? 'wav'
          : contentType.includes('ogg') ? 'ogg'
          : contentType.includes('mp4') || contentType.includes('m4a') ? 'm4a'
          : 'webm';
        // Use OpenAI Whisper (cheap, fast, ~$0.006/min)
        const form = new FormData();
        const blob = new Blob([new Uint8Array(audio)], { type: contentType || 'audio/webm' });
        form.append('file', blob, `voice.${ext}`);
        form.append('model', 'whisper-1');
        const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}` },
          body: form,
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          throw new Error(`OpenAI Whisper API error ${resp.status}: ${errText.slice(0, 200)}`);
        }
        const data = await resp.json() as { text?: string };
        const text = (data.text ?? '').trim();
        if (text) return text;
        throw new Error('Empty transcript from Whisper API');
      } catch (err) {
        console.warn('[Voice STT] OpenAI Whisper failed, trying local whisper:', (err as Error).message);
      }
    }

    // Fallback: local whisper CLI via SpeechToText engine
    try {
      const { SpeechToText } = await import('../voice/stt');
      const stt = new SpeechToText();
      const ext = contentType.includes('mp3') ? 'mp3'
        : contentType.includes('wav') ? 'wav'
        : contentType.includes('ogg') ? 'ogg'
        : contentType.includes('m4a') ? 'm4a'
        : 'webm';
      const result = await stt.transcribeBuffer(audio, ext);
      return (result.text ?? '').trim() || '(no speech detected)';
    } catch (err) {
      throw new Error(
        'Voice STT unavailable. Add OPENAI_API_KEY to .env (Whisper API), or install local whisper: pip install openai-whisper. Detail: ' +
          (err as Error).message,
      );
    }
  }

  private getActiveChannels(): string[] {
    const channels = new Set<string>();
    for (const [, client] of this.clients) {
      channels.add(client.info.channel);
    }
    return Array.from(channels);
  }

  // ─── Deep health probe: contact configured providers, return per-component status. ───
  private async runDeepHealth(): Promise<{
    status: 'ok' | 'degraded' | 'error';
    version: string;
    uptime: number;
    clients: number;
    providers: Record<string, { ok: boolean; configured: boolean; latency_ms?: number; error?: string }>;
  }> {
    const providers: Record<string, { ok: boolean; configured: boolean; latency_ms?: number; error?: string }> = {};

    // Ollama: HTTP probe (only if listed in models config or default).
    const ollamaUrl = (config.models.ollama?.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    {
      const t0 = Date.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const r = await fetch(`${ollamaUrl}/api/tags`, { signal: ctrl.signal });
        clearTimeout(timer);
        providers.ollama = { ok: r.ok, configured: true, latency_ms: Date.now() - t0 };
        if (!r.ok) providers.ollama.error = `HTTP ${r.status}`;
      } catch (err: any) {
        providers.ollama = { ok: false, configured: true, latency_ms: Date.now() - t0, error: err?.message ?? 'unreachable' };
      }
    }

    // OpenAI: only verify presence of API key (do not burn quota on every health check).
    providers.openai = {
      ok: Boolean(config.models.openai?.apiKey),
      configured: Boolean(config.models.openai?.apiKey),
    };
    if (!providers.openai.ok) providers.openai.error = 'no api key';

    // Anthropic / Google / Groq / Mistral / DeepSeek — same pattern.
    for (const p of ['anthropic', 'google', 'groq', 'mistral', 'deepseek'] as const) {
      const cfg = (config.models as any)[p];
      const ok = Boolean(cfg?.apiKey);
      providers[p] = { ok, configured: ok };
      if (!ok) providers[p].error = 'no api key';
    }

    const defaultProv = config.models.defaultProvider;
    const defaultOk = providers[defaultProv]?.ok ?? false;
    const status: 'ok' | 'degraded' | 'error' = defaultOk ? 'ok' : 'degraded';

    return {
      status,
      version: '4.0.5',
      uptime: process.uptime(),
      clients: this.clients.size,
      providers,
    };
  }

  // ─── Render Prometheus exposition (counters + gauges from live state). ───
  private renderPrometheus(): string {
    const lines: string[] = [];
    const metrics = missionControl.getCurrentMetrics();
    const totalMsgs = (metrics as any).total_messages ?? (metrics as any).message_count ?? 0;
    const avgRt = (metrics as any).avg_response_time_ms ?? 0;
    const memMb = (metrics as any).memory_usage_mb ?? Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const cpuPct = (metrics as any).cpu_usage_pct ?? 0;

    lines.push('# HELP paw_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE paw_uptime_seconds gauge');
    lines.push(`paw_uptime_seconds ${process.uptime()}`);

    lines.push('# HELP paw_connected_clients Number of currently connected gateway clients.');
    lines.push('# TYPE paw_connected_clients gauge');
    lines.push(`paw_connected_clients ${this.clients.size}`);

    lines.push('# HELP paw_messages_total Total messages processed by the agent.');
    lines.push('# TYPE paw_messages_total counter');
    lines.push(`paw_messages_total ${totalMsgs}`);

    lines.push('# HELP paw_avg_response_ms Average response time in milliseconds.');
    lines.push('# TYPE paw_avg_response_ms gauge');
    lines.push(`paw_avg_response_ms ${avgRt}`);

    lines.push('# HELP paw_memory_usage_mb Process heap memory in MiB.');
    lines.push('# TYPE paw_memory_usage_mb gauge');
    lines.push(`paw_memory_usage_mb ${memMb}`);

    lines.push('# HELP paw_cpu_usage_pct Process CPU usage percent (0-100).');
    lines.push('# TYPE paw_cpu_usage_pct gauge');
    lines.push(`paw_cpu_usage_pct ${cpuPct}`);

    return lines.join('\n') + '\n' + getCostTracker().toPrometheus();
  }

  // ─── Broadcast sync state to all other clients ───
  private broadcastSync(excludeClientId: string, sourceChannel: ChannelType): void {
    const syncStats = crossAppSync.getStats();
    const syncPayload: GatewayMessage = {
      type: 'event',
      channel: sourceChannel,
      from: 'system',
      payload: {
        event: 'sync',
        metrics: missionControl.getCurrentMetrics(),
        provider: config.models.defaultProvider || 'not configured',
        model: config.models.defaultProvider ? this.getDefaultModel() : 'none',
        connectedAgents: this.clients.size,
        connectedChannels: this.getActiveChannels().length,
        syncStats: {
          sessions: syncStats.sessions,
          actions: syncStats.actions,
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

  // ─── Broadcast sync to ALL clients including sender ───
  private broadcastSyncToAll(sourceChannel: ChannelType): void {
    const syncStats = crossAppSync.getStats();
    const syncPayload: GatewayMessage = {
      type: 'event',
      channel: sourceChannel,
      from: 'system',
      payload: {
        event: 'sync',
        metrics: missionControl.getCurrentMetrics(),
        provider: config.models.defaultProvider || 'not configured',
        model: config.models.defaultProvider ? this.getDefaultModel() : 'none',
        connectedAgents: this.clients.size,
        connectedChannels: this.getActiveChannels().length,
        syncStats: {
          sessions: syncStats.sessions,
          actions: syncStats.actions,
        },
      },
      timestamp: new Date().toISOString(),
    };

    for (const [, client] of this.clients) {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(syncPayload));
      }
    }
  }

  // ─── Timing-safe string comparison ───
  private safeCompare(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    // Use fixed-length buffers (256 bytes) to prevent timing attacks from length differences
    const fixedLen = 256;
    const bufA = Buffer.alloc(fixedLen);
    const bufB = Buffer.alloc(fixedLen);
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    bufA.set(aBuf, 0);
    bufB.set(bBuf, 0);
    // Always use timingSafeEqual regardless of length to prevent timing leaks
    try {
      return timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }
}
