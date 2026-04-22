// ─── Cost Tracker — Per-User Token & USD Spend Tracking ───
// Records every LLM call with input/output tokens, computes USD cost from
// a built-in price table, persists per-user totals to disk, and (optionally)
// enforces a daily USD budget per user.
//
// Wire-in points:
//   - gateway streaming `done` chunk → record(userId, provider, model, inTok, outTok)
//   - agent loop pre-LLM → checkBudget(userId, dailyBudgetUsd)
//   - HTTP /api/usage → getUserUsage / getGlobalUsage
//   - HTTP /metrics  → exposes prom counters
//
// Pricing source: public list prices as of April 2026. Update via CostTracker.PRICES.

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../core/config';

// ─── Price table: USD per 1,000,000 tokens ───
// Format: { 'provider:model': { input, output } }
// Local providers (ollama) are 0.
export const DEFAULT_PRICES: Record<string, { input: number; output: number }> = {
  // OpenAI
  'openai:gpt-4o':              { input: 2.50, output: 10.00 },
  'openai:gpt-4o-mini':         { input: 0.15, output: 0.60 },
  'openai:gpt-4-turbo':         { input: 10.00, output: 30.00 },
  'openai:gpt-3.5-turbo':       { input: 0.50, output: 1.50 },
  'openai:o1':                  { input: 15.00, output: 60.00 },
  'openai:o1-mini':             { input: 3.00, output: 12.00 },
  // Anthropic
  'anthropic:claude-sonnet-4-20250514':  { input: 3.00, output: 15.00 },
  'anthropic:claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'anthropic:claude-haiku-4-20250514':   { input: 0.25, output: 1.25 },
  'anthropic:claude-3-5-sonnet-20241022':{ input: 3.00, output: 15.00 },
  // Google
  'google:gemini-2.0-flash':    { input: 0.10, output: 0.40 },
  'google:gemini-1.5-pro':      { input: 1.25, output: 5.00 },
  'google:gemini-1.5-flash':    { input: 0.075, output: 0.30 },
  // Groq (free tier on most)
  'groq:llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'groq:llama-3.1-8b-instant':    { input: 0.05, output: 0.08 },
  // Mistral
  'mistral:mistral-large-latest':  { input: 2.00, output: 6.00 },
  'mistral:mistral-small-latest':  { input: 0.20, output: 0.60 },
  // DeepSeek
  'deepseek:deepseek-chat':     { input: 0.27, output: 1.10 },
  'deepseek:deepseek-reasoner': { input: 0.55, output: 2.19 },
  // Local — free
  'ollama:*':                   { input: 0, output: 0 },
};

export interface CostRecord {
  ts: string;             // ISO timestamp
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UserUsageSummary {
  userId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  callCount: number;
  byProvider: Record<string, { tokens: number; costUsd: number; calls: number }>;
  firstCall: string;
  lastCall: string;
}

export interface BudgetCheck {
  allowed: boolean;
  spentTodayUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  resetAtUtc: string; // next 00:00 UTC
}

interface PersistedState {
  version: 1;
  users: Record<string, UserUsageSummary>;
  daily: Record<string, Record<string, number>>; // userId -> { 'YYYY-MM-DD': costUsd }
  totals: {
    callCount: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    byProviderTokens: Record<string, number>;
    byProviderCost: Record<string, number>;
  };
}

const EMPTY_TOTALS = (): PersistedState['totals'] => ({
  callCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  byProviderTokens: {},
  byProviderCost: {},
});

export class CostTracker {
  private state: PersistedState;
  private storePath: string;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private static readonly FLUSH_DEBOUNCE_MS = 2000;
  // Recent ring buffer of raw records (capped) for /api/usage debugging.
  private recent: CostRecord[] = [];
  private static readonly RECENT_MAX = 1000;

  constructor(storePath?: string) {
    this.storePath = path.resolve(
      storePath ?? process.env.COST_STORE_PATH ?? './data/cost-tracker.json',
    );
    this.state = this.loadFromDisk();
    this.ensureDir();
  }

  // ─── Estimate tokens from text (≈ 1 token per 4 chars; floor 1) ───
  static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  // ─── Look up unit price for a provider:model pair ───
  static priceFor(provider: string, model: string): { input: number; output: number } {
    const key = `${provider}:${model}`.toLowerCase();
    if (DEFAULT_PRICES[key]) return DEFAULT_PRICES[key];
    // Wildcard fallback (e.g. ollama:*)
    const wild = `${provider}:*`.toLowerCase();
    if (DEFAULT_PRICES[wild]) return DEFAULT_PRICES[wild];
    return { input: 0, output: 0 };
  }

  // ─── Compute USD cost for a single call ───
  static computeCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
    const p = CostTracker.priceFor(provider, model);
    const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
    return Math.round(cost * 1e8) / 1e8; // 8 decimal places
  }

  // ─── Record an LLM call ───
  record(userId: string, provider: string, model: string, inputTokens: number, outputTokens: number): CostRecord {
    const safeUser = userId || 'anonymous';
    const inTok = Math.max(0, Math.floor(inputTokens || 0));
    const outTok = Math.max(0, Math.floor(outputTokens || 0));
    const costUsd = CostTracker.computeCost(provider, model, inTok, outTok);
    const ts = new Date().toISOString();

    // Per-user summary
    const u = this.state.users[safeUser] ?? this.emptyUser(safeUser, ts);
    u.totalInputTokens += inTok;
    u.totalOutputTokens += outTok;
    u.totalCostUsd = round8(u.totalCostUsd + costUsd);
    u.callCount += 1;
    u.lastCall = ts;
    const pp = u.byProvider[provider] ?? { tokens: 0, costUsd: 0, calls: 0 };
    pp.tokens += inTok + outTok;
    pp.costUsd = round8(pp.costUsd + costUsd);
    pp.calls += 1;
    u.byProvider[provider] = pp;
    this.state.users[safeUser] = u;

    // Per-day spend (UTC date key)
    const day = ts.slice(0, 10);
    if (!this.state.daily[safeUser]) this.state.daily[safeUser] = {};
    this.state.daily[safeUser][day] = round8((this.state.daily[safeUser][day] ?? 0) + costUsd);

    // Global totals
    const g = this.state.totals;
    g.callCount += 1;
    g.inputTokens += inTok;
    g.outputTokens += outTok;
    g.costUsd = round8(g.costUsd + costUsd);
    g.byProviderTokens[provider] = (g.byProviderTokens[provider] ?? 0) + inTok + outTok;
    g.byProviderCost[provider] = round8((g.byProviderCost[provider] ?? 0) + costUsd);

    const record: CostRecord = { ts, userId: safeUser, provider, model, inputTokens: inTok, outputTokens: outTok, costUsd };
    this.recent.push(record);
    if (this.recent.length > CostTracker.RECENT_MAX) this.recent.shift();

    this.dirty = true;
    this.scheduleFlush();
    return record;
  }

  // ─── Per-user usage summary ───
  getUserUsage(userId: string): UserUsageSummary | null {
    return this.state.users[userId] ?? null;
  }

  // ─── All users ───
  getGlobalUsage(): { totals: PersistedState['totals']; userCount: number } {
    return { totals: this.state.totals, userCount: Object.keys(this.state.users).length };
  }

  // ─── Recent calls (newest last) ───
  getRecent(limit = 50): CostRecord[] {
    const n = Math.max(1, Math.min(CostTracker.RECENT_MAX, limit));
    return this.recent.slice(-n);
  }

  // ─── Today's spend in USD for a given user (UTC) ───
  getTodaySpend(userId: string): number {
    const day = new Date().toISOString().slice(0, 10);
    return this.state.daily[userId]?.[day] ?? 0;
  }

  // ─── Budget check. Pass dailyBudgetUsd <= 0 to disable. ───
  checkBudget(userId: string, dailyBudgetUsd: number): BudgetCheck {
    const spent = this.getTodaySpend(userId);
    const budget = Math.max(0, dailyBudgetUsd || 0);
    const remaining = Math.max(0, round8(budget - spent));
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return {
      allowed: budget <= 0 || spent < budget,
      spentTodayUsd: spent,
      budgetUsd: budget,
      remainingUsd: remaining,
      resetAtUtc: tomorrow.toISOString(),
    };
  }

  // ─── Prometheus exposition (text/plain; version=0.0.4) ───
  toPrometheus(): string {
    const lines: string[] = [];
    const t = this.state.totals;
    lines.push('# HELP paw_llm_calls_total Total LLM calls recorded by PAW.');
    lines.push('# TYPE paw_llm_calls_total counter');
    lines.push(`paw_llm_calls_total ${t.callCount}`);
    lines.push('# HELP paw_llm_input_tokens_total Total LLM input tokens.');
    lines.push('# TYPE paw_llm_input_tokens_total counter');
    lines.push(`paw_llm_input_tokens_total ${t.inputTokens}`);
    lines.push('# HELP paw_llm_output_tokens_total Total LLM output tokens.');
    lines.push('# TYPE paw_llm_output_tokens_total counter');
    lines.push(`paw_llm_output_tokens_total ${t.outputTokens}`);
    lines.push('# HELP paw_llm_cost_usd_total Total LLM USD spend.');
    lines.push('# TYPE paw_llm_cost_usd_total counter');
    lines.push(`paw_llm_cost_usd_total ${t.costUsd}`);
    lines.push('# HELP paw_llm_tokens_by_provider_total Tokens by provider.');
    lines.push('# TYPE paw_llm_tokens_by_provider_total counter');
    for (const [p, v] of Object.entries(t.byProviderTokens)) {
      lines.push(`paw_llm_tokens_by_provider_total{provider="${escapeLabel(p)}"} ${v}`);
    }
    lines.push('# HELP paw_llm_cost_by_provider_usd_total USD by provider.');
    lines.push('# TYPE paw_llm_cost_by_provider_usd_total counter');
    for (const [p, v] of Object.entries(t.byProviderCost)) {
      lines.push(`paw_llm_cost_by_provider_usd_total{provider="${escapeLabel(p)}"} ${v}`);
    }
    return lines.join('\n') + '\n';
  }

  // ─── Persistence ───
  private emptyUser(userId: string, ts: string): UserUsageSummary {
    return {
      userId,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      callCount: 0,
      byProvider: {},
      firstCall: ts,
      lastCall: ts,
    };
  }

  private ensureDir(): void {
    try { fs.mkdirSync(path.dirname(this.storePath), { recursive: true }); } catch { /* noop */ }
  }

  private loadFromDisk(): PersistedState {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
        if (raw && raw.version === 1 && raw.users && raw.daily && raw.totals) {
          // Backfill any missing maps to keep counters safe.
          raw.totals.byProviderTokens = raw.totals.byProviderTokens ?? {};
          raw.totals.byProviderCost = raw.totals.byProviderCost ?? {};
          return raw as PersistedState;
        }
      }
    } catch {
      // Corrupted — start fresh.
    }
    return { version: 1, users: {}, daily: {}, totals: EMPTY_TOTALS() };
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, CostTracker.FLUSH_DEBOUNCE_MS);
    // Don't keep the event loop alive just to flush
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      this.ensureDir();
      const tmp = this.storePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state), 'utf-8');
      fs.renameSync(tmp, this.storePath);
      this.dirty = false;
    } catch {
      // Silent — still works in-memory.
    }
  }

  // Test/inspection helpers
  __resetForTests(): void {
    this.state = { version: 1, users: {}, daily: {}, totals: EMPTY_TOTALS() };
    this.recent = [];
    this.dirty = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
  }
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
function escapeLabel(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ─── Singleton (used by gateway + loop) ───
let _instance: CostTracker | null = null;
export function getCostTracker(): CostTracker {
  if (!_instance) _instance = new CostTracker();
  return _instance;
}

// Daily budget read from env (0 = disabled).
export function getUserDailyBudgetUsd(): number {
  const v = Number(process.env.USER_DAILY_BUDGET_USD ?? '0');
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Re-exported for tests / gateway convenience.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _config = config;
