// ─── Execution Engine ───
// Executes ONLY validated plans. Supports Solana, Purp, JS tools, APIs.
// Includes retry, rollback, and error recovery.

import { AgentPlan, ExecutionResult, StepResult, PlanStep, ExecutionError } from '../core/types';
import { SolanaExecutor } from '../integrations/solana/executor';
import { PurpEngine } from '../integrations/purp/engine';
import { PublicKey, Transaction } from '@solana/web3.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

export class ExecutionEngine {
  private tools = new Map<string, ToolHandler>();
  private solana: SolanaExecutor;
  private purp: PurpEngine;

  constructor(solana: SolanaExecutor, purp: PurpEngine) {
    this.solana = solana;
    this.purp = purp;
    this.registerBuiltinTools();
  }

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
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
