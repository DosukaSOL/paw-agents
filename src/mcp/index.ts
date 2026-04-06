// ─── MCP Client (Model Context Protocol) ───
// Connects PAW to external MCP tool servers.
// Supports: tool discovery, invocation, streaming, server management.

import * as http from 'http';
import * as https from 'https';

export interface MCPServer {
  name: string;
  url: string;
  apiKey?: string;
  tools: MCPTool[];
  status: 'connected' | 'disconnected' | 'error';
  lastPing: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  server: string;
}

export interface MCPToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration_ms: number;
}

export class MCPClient {
  private servers: Map<string, MCPServer> = new Map();
  private toolIndex: Map<string, MCPTool> = new Map();

  // ─── Connect to an MCP server ───
  async connect(name: string, url: string, apiKey?: string): Promise<MCPServer> {
    // Validate URL
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('MCP server URL must use http or https protocol');
    }

    // Discover tools
    const tools = await this.discoverTools(url, apiKey);

    const server: MCPServer = {
      name,
      url,
      apiKey,
      tools,
      status: 'connected',
      lastPing: Date.now(),
    };

    this.servers.set(name, server);

    // Index tools
    for (const tool of tools) {
      this.toolIndex.set(`${name}/${tool.name}`, tool);
    }

    return server;
  }

  // ─── Discover tools from server ───
  private async discoverTools(baseUrl: string, apiKey?: string): Promise<MCPTool[]> {
    try {
      const response = await this.httpRequest(`${baseUrl}/tools`, 'GET', undefined, apiKey);
      const data = JSON.parse(response);
      if (Array.isArray(data.tools)) {
        return data.tools.map((t: Record<string, unknown>) => ({
          name: String(t.name ?? ''),
          description: String(t.description ?? ''),
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
          server: baseUrl,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  // ─── Invoke a tool ───
  async invoke(serverName: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const server = this.servers.get(serverName);
    if (!server) {
      return { success: false, output: null, error: `Server '${serverName}' not connected`, duration_ms: 0 };
    }

    const start = Date.now();

    try {
      const response = await this.httpRequest(
        `${server.url}/tools/${encodeURIComponent(toolName)}/invoke`,
        'POST',
        JSON.stringify({ arguments: args }),
        server.apiKey,
      );

      const data = JSON.parse(response);
      return {
        success: true,
        output: data.output ?? data.result ?? data,
        duration_ms: Date.now() - start,
      };
    } catch (error: unknown) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - start,
      };
    }
  }

  // ─── List all available tools across all servers ───
  listTools(): MCPTool[] {
    return Array.from(this.toolIndex.values());
  }

  // ─── List connected servers ───
  listServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  // ─── Disconnect server ───
  disconnect(name: string): boolean {
    const server = this.servers.get(name);
    if (!server) return false;

    // Remove tools from index
    for (const tool of server.tools) {
      this.toolIndex.delete(`${name}/${tool.name}`);
    }

    this.servers.delete(name);
    return true;
  }

  // ─── Find tool by name across all servers ───
  findTool(toolName: string): { server: string; tool: MCPTool } | null {
    for (const [key, tool] of this.toolIndex) {
      if (tool.name === toolName) {
        const serverName = key.split('/')[0];
        return { server: serverName, tool };
      }
    }
    return null;
  }

  // ─── HTTP helper ───
  private httpRequest(url: string, method: string, body?: string, apiKey?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'PAW-Agents/3.0 MCP-Client',
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body).toString();
      }

      const req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method,
          headers,
          timeout: 15_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`MCP server responded with ${res.statusCode}: ${data.slice(0, 200)}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('MCP request timed out')); });

      if (body) req.write(body);
      req.end();
    });
  }
}
