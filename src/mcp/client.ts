// ─── PAW MCP Client ───
// Connects to external MCP servers to discover and invoke their tools,
// making PAW a universal MCP-aware agent.

import { URL } from 'url';

export interface MCPServerConnection {
  url: string;
  name: string;
  serverInfo?: { name: string; version: string; description?: string };
  tools: MCPRemoteTool[];
  connected: boolean;
}

export interface MCPRemoteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverUrl: string;
}

interface MCPClientOptions {
  timeout?: number;
  retries?: number;
}

export class PawMCPClient {
  private connections = new Map<string, MCPServerConnection>();
  private timeout: number;
  private retries: number;

  constructor(options?: MCPClientOptions) {
    this.timeout = options?.timeout ?? 30_000;
    this.retries = options?.retries ?? 2;
  }

  // ─── Connect to MCP Server ───

  async connect(url: string, name?: string): Promise<MCPServerConnection> {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(`Unsupported protocol: ${parsedUrl.protocol}. Only http/https are allowed.`);
    }
    // Block SSRF to private/internal networks
    const hostname = parsedUrl.hostname;
    const blockedPatterns = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^169\.254\./, /^localhost$/i, /^\[::1\]$/];
    if (blockedPatterns.some(p => p.test(hostname))) {
      throw new Error(`Connection to private/internal addresses is not allowed: ${hostname}`);
    }

    // Initialize
    const initResponse = await this.rpc(url, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'paw-agents', version: '4.0.0' },
    });

    const serverInfo = (initResponse?.serverInfo ?? { name: name ?? 'unknown', version: '0.0.0' }) as { name: string; version: string; description?: string };

    // List tools
    const toolsResponse = await this.rpc(url, 'tools/list', {});
    const toolsArray = (Array.isArray(toolsResponse?.tools) ? toolsResponse.tools : []) as Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    const remoteTools: MCPRemoteTool[] = toolsArray.map(
      (t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        serverUrl: url,
      })
    );

    const connection: MCPServerConnection = {
      url,
      name: name ?? serverInfo.name,
      serverInfo,
      tools: remoteTools,
      connected: true,
    };

    this.connections.set(url, connection);
    console.log(`[MCP Client] Connected to ${connection.name} (${url}) — ${remoteTools.length} tools`);
    return connection;
  }

  // ─── Invoke Remote Tool ───

  async invokeTool(serverUrl: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const connection = this.connections.get(serverUrl);
    if (!connection?.connected) {
      throw new Error(`Not connected to MCP server: ${serverUrl}`);
    }

    const tool = connection.tools.find(t => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found on server ${connection.name}`);
    }

    const result = await this.rpc(serverUrl, 'tools/call', { name: toolName, arguments: args });
    return result;
  }

  // ─── Discover All Tools ───

  getAllTools(): MCPRemoteTool[] {
    const tools: MCPRemoteTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.connected) {
        tools.push(...conn.tools);
      }
    }
    return tools;
  }

  getConnections(): MCPServerConnection[] {
    return Array.from(this.connections.values());
  }

  // ─── Disconnect ───

  async disconnect(url: string): Promise<void> {
    const connection = this.connections.get(url);
    if (connection) {
      connection.connected = false;
      this.connections.delete(url);
      console.log(`[MCP Client] Disconnected from ${connection.name}`);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const url of this.connections.keys()) {
      await this.disconnect(url);
    }
  }

  // ─── JSON-RPC Transport ───

  private async rpc(url: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    });

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`MCP server returned ${response.status}: ${response.statusText}`);
        }

        const json = await response.json() as { result?: Record<string, unknown>; error?: { message?: unknown } };
        if (json.error) {
          throw new Error(`MCP error: ${typeof json.error.message === 'string' ? json.error.message : JSON.stringify(json.error)}`);
        }

        return (json.result ?? {}) as Record<string, unknown>;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error('MCP request failed');
  }
}
