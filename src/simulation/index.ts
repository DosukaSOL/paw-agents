// ─── Transaction Simulation Sandbox ───
// Dry-run Solana transactions with detailed outcome reporting.
// Simulates before broadcasting to prevent costly mistakes.

import { Connection, Transaction, VersionedTransaction, PublicKey, SendOptions } from '@solana/web3.js';

export interface SimulationResult {
  success: boolean;
  logs: string[];
  unitsConsumed: number;
  fee: number;
  balanceChanges: BalanceChange[];
  error?: string;
  warning?: string;
}

export interface BalanceChange {
  account: string;
  before: number;
  after: number;
  delta: number;
}

export interface SimulationConfig {
  rpcUrl: string;
  maxRetries?: number;
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

export class TransactionSimulator {
  private connection: Connection;
  private config: SimulationConfig;
  private history: { tx: string; result: SimulationResult; timestamp: number }[] = [];

  constructor(config: SimulationConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, config.commitment ?? 'confirmed');
  }

  // ─── Simulate a transaction ───
  async simulate(transaction: Transaction | VersionedTransaction): Promise<SimulationResult> {
    try {
      let logs: string[] = [];
      let unitsConsumed = 0;
      let error: string | undefined;

      if (transaction instanceof Transaction) {
        const result = await this.connection.simulateTransaction(transaction);
        logs = result.value.logs ?? [];
        unitsConsumed = result.value.unitsConsumed ?? 0;
        if (result.value.err) {
          error = JSON.stringify(result.value.err);
        }
      } else {
        const result = await this.connection.simulateTransaction(transaction);
        logs = result.value.logs ?? [];
        unitsConsumed = result.value.unitsConsumed ?? 0;
        if (result.value.err) {
          error = JSON.stringify(result.value.err);
        }
      }

      // Estimate fee
      const fee = await this.estimateFee(transaction);

      // Parse balance changes from logs
      const balanceChanges = this.parseBalanceChanges(logs);

      // Check for warnings
      const warning = this.detectWarnings(logs, unitsConsumed);

      const result: SimulationResult = {
        success: !error,
        logs,
        unitsConsumed,
        fee,
        balanceChanges,
        error,
        warning,
      };

      // Store in history
      this.history.push({
        tx: this.txSignature(transaction),
        result,
        timestamp: Date.now(),
      });
      if (this.history.length > 50) this.history.shift();

      return result;
    } catch (err: unknown) {
      return {
        success: false,
        logs: [],
        unitsConsumed: 0,
        fee: 0,
        balanceChanges: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── Simulate and send only if simulation passes ───
  async simulateAndSend(
    transaction: Transaction | VersionedTransaction,
    options?: SendOptions,
  ): Promise<{ simulation: SimulationResult; signature?: string }> {
    const simulation = await this.simulate(transaction);

    if (!simulation.success) {
      return { simulation };
    }

    // Send real transaction
    let signature: string;
    if (transaction instanceof Transaction) {
      signature = await this.connection.sendRawTransaction(transaction.serialize(), options);
    } else {
      signature = await this.connection.sendRawTransaction(transaction.serialize(), options);
    }

    return { simulation, signature };
  }

  // ─── Estimate fee ───
  private async estimateFee(transaction: Transaction | VersionedTransaction): Promise<number> {
    try {
      if (transaction instanceof Transaction) {
        const fee = await this.connection.getFeeForMessage(transaction.compileMessage());
        return fee.value ?? 5000;
      }
      return 5000; // Default 5000 lamports
    } catch {
      return 5000;
    }
  }

  // ─── Parse balance changes from logs ───
  private parseBalanceChanges(logs: string[]): BalanceChange[] {
    const changes: BalanceChange[] = [];

    for (const log of logs) {
      // Look for program log patterns that indicate balance changes
      const transferMatch = log.match(/Transfer:\s*(\w+)\s*->\s*(\w+)\s*(\d+)/);
      if (transferMatch) {
        changes.push({
          account: transferMatch[1],
          before: 0,
          after: 0,
          delta: -Number(transferMatch[3]),
        });
        changes.push({
          account: transferMatch[2],
          before: 0,
          after: 0,
          delta: Number(transferMatch[3]),
        });
      }
    }

    return changes;
  }

  // ─── Detect potential warnings ───
  private detectWarnings(logs: string[], unitsConsumed: number): string | undefined {
    const warnings: string[] = [];

    if (unitsConsumed > 800_000) {
      warnings.push(`High compute units: ${unitsConsumed.toLocaleString()} (near 1.4M limit)`);
    }

    const hasOwnerCheck = logs.some(l => l.includes('owner check'));
    if (hasOwnerCheck) {
      warnings.push('Owner check detected — verify account ownership');
    }

    const hasCPIDepth = logs.filter(l => l.includes('Program invoke')).length;
    if (hasCPIDepth > 3) {
      warnings.push(`Deep CPI chain detected: ${hasCPIDepth} invocations`);
    }

    return warnings.length > 0 ? warnings.join('; ') : undefined;
  }

  // ─── Get transaction signature for history ───
  private txSignature(transaction: Transaction | VersionedTransaction): string {
    if (transaction instanceof Transaction) {
      return transaction.signature?.toString() ?? `sim_${Date.now()}`;
    }
    return `sim_${Date.now()}`;
  }

  // ─── Get simulation history ───
  getHistory(): typeof this.history {
    return [...this.history];
  }

  // ─── Quick balance check ───
  async getBalance(address: string): Promise<number> {
    return this.connection.getBalance(new PublicKey(address));
  }
}
