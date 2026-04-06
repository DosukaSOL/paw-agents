// ─── Execution Engine v3.0 ───
// Executes ONLY validated plans. Supports Solana, Purp, JS tools, APIs.
// Includes retry, rollback, and error recovery.
// Extended with browser, orchestrator, vector memory, workflows, MCP, simulation.

import { AgentPlan, ExecutionResult, StepResult, PlanStep, ExecutionError } from '../core/types';
import { SolanaExecutor } from '../integrations/solana/executor';
import { PurpEngine } from '../integrations/purp/engine';
import { PublicKey, Transaction } from '@solana/web3.js';
import { BrowserEngine } from '../browser/index';
import { AgentOrchestrator } from '../orchestrator/index';
import { VectorMemory } from '../vector-memory/index';
import { MCPClient } from '../mcp/index';
import { WorkflowEngine } from '../workflow/index';
import { TransactionSimulator } from '../simulation/index';
import * as fs from 'fs';
import * as path from 'path';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// In-process key-value memory store for agent tools
const memoryStore = new Map<string, unknown>();

export type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

export class ExecutionEngine {
  private tools = new Map<string, ToolHandler>();
  private solana: SolanaExecutor;
  private purp: PurpEngine;
  private browser: BrowserEngine;
  private orchestrator: AgentOrchestrator;
  private vectorMemory: VectorMemory;
  private mcpClient: MCPClient;
  private workflowEngine: WorkflowEngine;
  private simulator: TransactionSimulator;

  constructor(solana: SolanaExecutor, purp: PurpEngine) {
    this.solana = solana;
    this.purp = purp;
    this.browser = new BrowserEngine();
    this.orchestrator = new AgentOrchestrator();
    this.vectorMemory = new VectorMemory();
    this.mcpClient = new MCPClient();
    this.workflowEngine = new WorkflowEngine();
    this.simulator = new TransactionSimulator({ rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com' });
    this.registerBuiltinTools();
  }

  // ─── Expose sub-systems ───
  getBrowser(): BrowserEngine { return this.browser; }
  getOrchestrator(): AgentOrchestrator { return this.orchestrator; }
  getVectorMemory(): VectorMemory { return this.vectorMemory; }
  getMCPClient(): MCPClient { return this.mcpClient; }
  getWorkflowEngine(): WorkflowEngine { return this.workflowEngine; }
  getSimulator(): TransactionSimulator { return this.simulator; }

  // ─── Register a tool handler ───
  registerTool(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }

  // ─── Execute a validated plan ───
  async execute(plan: AgentPlan): Promise<ExecutionResult> {
    const start = Date.now();
    const stepsCompleted: StepResult[] = [];
    let finalOutput: unknown = null;

    for (const step of plan.plan) {
      const stepStart = Date.now();
      let lastError: string | undefined;
      let success = false;
      let output: unknown = null;

      // Retry loop
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          output = await this.executeStep(step);
          success = true;
          break;
        } catch (err) {
          lastError = (err as Error).message;
          if (attempt < MAX_RETRIES) {
            await this.delay(RETRY_DELAY_MS * (attempt + 1));
          }
        }
      }

      const stepResult: StepResult = {
        step: step.step,
        success,
        output,
        duration_ms: Date.now() - stepStart,
        error: lastError,
      };

      stepsCompleted.push(stepResult);

      if (!success) {
        // Attempt rollback of completed steps
        await this.rollback(plan.plan, stepsCompleted);

        return {
          success: false,
          plan_id: plan.id,
          steps_completed: stepsCompleted,
          final_output: null,
          error: {
            code: 'STEP_FAILED',
            message: `Step ${step.step} failed after ${MAX_RETRIES + 1} attempts: ${lastError}`,
            step: step.step,
            recoverable: false,
            recovery_attempted: true,
            recovery_result: 'rollback_triggered',
          },
          duration_ms: Date.now() - start,
        };
      }

      finalOutput = output;
    }

    return {
      success: true,
      plan_id: plan.id,
      steps_completed: stepsCompleted,
      final_output: finalOutput,
      duration_ms: Date.now() - start,
    };
  }

  // ─── Execute a single step ───
  private async executeStep(step: PlanStep): Promise<unknown> {
    const handler = this.tools.get(step.tool);
    if (!handler) {
      throw new Error(`Unknown tool: ${step.tool}`);
    }
    return handler(step.params);
  }

  // ─── Rollback completed steps ───
  private async rollback(allSteps: PlanStep[], completedResults: StepResult[]): Promise<void> {
    // Rollback in reverse order
    for (let i = completedResults.length - 1; i >= 0; i--) {
      const step = allSteps[i];
      if (completedResults[i].success && step.rollback) {
        try {
          const handler = this.tools.get(step.rollback.tool);
          if (handler) {
            await handler(step.rollback.params);
          }
        } catch (err) {
          console.error(`[ExecutionEngine] Rollback failed for step ${step.step}:`, (err as Error).message);
        }
      }
    }
  }

  // ─── Register built-in tools ───
  private registerBuiltinTools(): void {
    // Solana transfer
    this.registerTool('solana_transfer', async (params) => {
      const to = params.to as string;
      const lamports = params.lamports as number;
      const from = params.from as string;

      if (!SolanaExecutor.isValidAddress(to)) throw new Error('Invalid recipient address');
      if (!SolanaExecutor.isValidAddress(from)) throw new Error('Invalid sender address');
      if (lamports <= 0) throw new Error('Amount must be positive');

      const fromPubkey = new PublicKey(from);
      const toPubkey = new PublicKey(to);

      const tx = new Transaction().add(
        this.solana.createTransferInstruction(fromPubkey, toPubkey, lamports)
      );

      return this.solana.execute(tx, fromPubkey);
    });

    // Solana balance check
    this.registerTool('solana_balance', async (params) => {
      const address = params.address as string;
      if (!SolanaExecutor.isValidAddress(address)) throw new Error('Invalid address');
      return this.solana.getSolBalance(new PublicKey(address));
    });

    // Internal tools
    this.registerTool('internal_log', async (params) => {
      return { logged: params.message };
    });

    this.registerTool('internal_assert', async (params) => {
      const condition = params.condition as string;
      const value = params.value;
      if (!value) throw new Error(`Assertion failed: ${condition}`);
      return { asserted: true, condition };
    });

    this.registerTool('internal_variable', async (params) => {
      return { name: params.name, value: params.value };
    });

    // API call tool (sandboxed)
    this.registerTool('api_call', async (params) => {
      const url = params.url as string;
      const method = (params.method as string ?? 'GET').toUpperCase();

      // Sandbox: only allow HTTPS
      if (!url.startsWith('https://')) {
        throw new Error('API calls must use HTTPS');
      }

      // Sandbox: block internal/private IPs
      const hostname = new URL(url).hostname;
      if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('10.') || hostname.startsWith('192.168.')) {
        throw new Error('API calls to internal addresses are blocked');
      }

      const response = await fetch(url, {
        method,
        headers: params.headers as Record<string, string> ?? {},
        body: method !== 'GET' ? JSON.stringify(params.body) : undefined,
      });

      return {
        status: response.status,
        body: await response.json().catch(() => response.text()),
      };
    });

    // ─── HTTP convenience tools ───
    this.registerTool('http_get', async (params) => {
      const url = params.url as string;
      if (!url.startsWith('https://')) throw new Error('HTTP calls must use HTTPS');
      const hostname = new URL(url).hostname;
      if (['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) || hostname.startsWith('10.') || hostname.startsWith('192.168.')) {
        throw new Error('Blocked: internal address');
      }
      const response = await fetch(url, {
        headers: params.headers as Record<string, string> ?? {},
      });
      return { status: response.status, body: await response.json().catch(() => response.text()) };
    });

    this.registerTool('http_post', async (params) => {
      const url = params.url as string;
      if (!url.startsWith('https://')) throw new Error('HTTP calls must use HTTPS');
      const hostname = new URL(url).hostname;
      if (['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) || hostname.startsWith('10.') || hostname.startsWith('192.168.')) {
        throw new Error('Blocked: internal address');
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(params.headers as Record<string, string> ?? {}) },
        body: JSON.stringify(params.body),
      });
      return { status: response.status, body: await response.json().catch(() => response.text()) };
    });

    // ─── File operations (sandboxed to working directory) ───
    const SANDBOX_ROOT = path.resolve(process.cwd(), 'data');

    const resolveSafe = (filePath: string): string => {
      const resolved = path.resolve(SANDBOX_ROOT, filePath);
      if (!resolved.startsWith(SANDBOX_ROOT)) {
        throw new Error('File access denied: path traversal blocked');
      }
      return resolved;
    };

    this.registerTool('file_read', async (params) => {
      const safePath = resolveSafe(params.path as string);
      if (!fs.existsSync(safePath)) throw new Error(`File not found: ${params.path}`);
      const content = fs.readFileSync(safePath, 'utf-8');
      return { path: params.path, content, size: content.length };
    });

    this.registerTool('file_write', async (params) => {
      const safePath = resolveSafe(params.path as string);
      const content = String(params.content);
      if (content.length > 1_000_000) throw new Error('File content too large (1MB max)');
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(safePath, content, 'utf-8');
      return { path: params.path, written: content.length };
    });

    this.registerTool('file_list', async (params) => {
      const safePath = resolveSafe((params.path as string) ?? '.');
      if (!fs.existsSync(safePath)) throw new Error(`Directory not found: ${params.path}`);
      const entries = fs.readdirSync(safePath, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      }));
    });

    // ─── Data tools ───
    this.registerTool('data_transform', async (params) => {
      const data = params.data;
      const operation = params.operation as string;

      switch (operation) {
        case 'json_parse':
          return JSON.parse(String(data));
        case 'json_stringify':
          return JSON.stringify(data, null, 2);
        case 'base64_encode':
          return Buffer.from(String(data)).toString('base64');
        case 'base64_decode':
          return Buffer.from(String(data), 'base64').toString('utf-8');
        case 'uppercase':
          return String(data).toUpperCase();
        case 'lowercase':
          return String(data).toLowerCase();
        default:
          throw new Error(`Unknown transform: ${operation}`);
      }
    });

    this.registerTool('data_filter', async (params) => {
      const data = params.data as unknown[];
      const field = params.field as string;
      const value = params.value;

      if (!Array.isArray(data)) throw new Error('data must be an array');
      return data.filter((item: unknown) => {
        if (typeof item === 'object' && item !== null) {
          return (item as Record<string, unknown>)[field] === value;
        }
        return item === value;
      });
    });

    // ─── System tools ───
    this.registerTool('system_time', async () => {
      return {
        iso: new Date().toISOString(),
        unix: Date.now(),
        utc: new Date().toUTCString(),
      };
    });

    this.registerTool('system_sleep', async (params) => {
      const ms = Math.min(params.ms as number, 10000); // Max 10s
      await this.delay(ms);
      return { slept_ms: ms };
    });

    // ─── Memory tools (in-process key-value store) ───
    this.registerTool('memory_set', async (params) => {
      const key = String(params.key);
      const value = params.value;
      memoryStore.set(key, value);
      return { key, stored: true };
    });

    this.registerTool('memory_get', async (params) => {
      const key = String(params.key);
      return { key, value: memoryStore.get(key) ?? null, found: memoryStore.has(key) };
    });

    // ─── Browser automation tools ───
    this.registerTool('browser_navigate', async (params) => {
      return this.browser.execute({ type: 'navigate', url: params.url as string });
    });

    this.registerTool('browser_click', async (params) => {
      return this.browser.execute({ type: 'click', selector: params.selector as string });
    });

    this.registerTool('browser_type', async (params) => {
      return this.browser.execute({ type: 'type', selector: params.selector as string, text: params.value as string });
    });

    this.registerTool('browser_extract', async (params) => {
      return this.browser.execute({ type: 'extract', selector: params.selector as string });
    });

    this.registerTool('browser_screenshot', async (params) => {
      return this.browser.execute({ type: 'screenshot', url: params.url as string | undefined });
    });

    // ─── Multi-agent orchestration tools ───
    this.registerTool('agent_delegate', async (params) => {
      return this.orchestrator.delegate(
        'paw-core',
        params.agent_id as string,
        params.task as string,
      );
    });

    this.registerTool('agent_route', async (params) => {
      return this.orchestrator.route(
        'paw-core',
        params.intent as string,
      );
    });

    // ─── Vector memory tools ───
    this.registerTool('vector_store', async (params) => {
      return this.vectorMemory.add(
        params.text as string,
        (params.scope as 'session' | 'user' | 'global') ?? 'session',
        params.namespace as string ?? 'default',
        params.metadata as Record<string, unknown> ?? {},
      );
    });

    this.registerTool('vector_search', async (params) => {
      return this.vectorMemory.search(params.query as string, {
        scope: params.scope as string,
        namespace: params.namespace as string,
        limit: params.limit as number,
        threshold: params.threshold as number,
      });
    });

    this.registerTool('vector_stats', async () => {
      return this.vectorMemory.stats();
    });

    // ─── MCP tools ───
    this.registerTool('mcp_connect', async (params) => {
      return this.mcpClient.connect(
        params.name as string,
        params.url as string,
        params.api_key as string | undefined,
      );
    });

    this.registerTool('mcp_invoke', async (params) => {
      return this.mcpClient.invoke(
        params.server as string,
        params.tool as string,
        params.arguments as Record<string, unknown> ?? {},
      );
    });

    this.registerTool('mcp_list_tools', async () => {
      return this.mcpClient.listTools();
    });

    // ─── Workflow tools ───
    this.registerTool('workflow_create', async (params) => {
      return this.workflowEngine.createWorkflow(
        params.name as string,
        params.description as string ?? '',
        params.nodes as any[],
      );
    });

    this.registerTool('workflow_execute', async (params) => {
      return this.workflowEngine.execute(
        params.workflow_id as string,
        params.data as Record<string, unknown> ?? {},
      );
    });

    this.registerTool('workflow_list', async () => {
      return this.workflowEngine.listWorkflows();
    });

    // ─── Transaction simulation ───
    this.registerTool('tx_simulate', async (params) => {
      const balance = await this.simulator.getBalance(params.address as string);
      return { address: params.address, balance_lamports: balance, balance_sol: balance / 1e9 };
    });

    this.registerTool('tx_history', async () => {
      return this.simulator.getHistory();
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
