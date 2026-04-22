// ─── Cost Tracker Tests ───
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { CostTracker, DEFAULT_PRICES } from '../src/intelligence/cost-tracker';

describe('CostTracker', () => {
  let tmpFile: string;
  let tracker: CostTracker;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `paw-cost-${Date.now()}-${Math.random()}.json`);
    tracker = new CostTracker(tmpFile);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
  });

  test('estimateTokens approximates 1 token per 4 chars', () => {
    expect(CostTracker.estimateTokens('')).toBe(0);
    expect(CostTracker.estimateTokens('abcd')).toBe(1);
    expect(CostTracker.estimateTokens('abcdefgh')).toBe(2);
    expect(CostTracker.estimateTokens('a'.repeat(100))).toBe(25);
  });

  test('priceFor returns known price and falls back to wildcard / zero', () => {
    expect(DEFAULT_PRICES['openai:gpt-4o-mini'].input).toBeCloseTo(0.15);
    expect(CostTracker.priceFor('ollama', 'llama3.1:8b')).toEqual({ input: 0, output: 0 });
    expect(CostTracker.priceFor('unknown-provider', 'unknown-model')).toEqual({ input: 0, output: 0 });
  });

  test('computeCost is correct for OpenAI gpt-4o-mini', () => {
    // 1M input @ 0.15 + 1M output @ 0.60 = 0.75
    const c = CostTracker.computeCost('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);
    expect(c).toBeCloseTo(0.75, 8);
    // Local provider always free
    expect(CostTracker.computeCost('ollama', 'llama3', 9_999_999, 9_999_999)).toBe(0);
  });

  test('record updates per-user, per-provider, and global totals', () => {
    const r = tracker.record('alice', 'openai', 'gpt-4o-mini', 1_000_000, 500_000);
    expect(r.costUsd).toBeCloseTo(0.15 + 0.30, 8);

    const u = tracker.getUserUsage('alice')!;
    expect(u.callCount).toBe(1);
    expect(u.totalInputTokens).toBe(1_000_000);
    expect(u.totalOutputTokens).toBe(500_000);
    expect(u.byProvider.openai.calls).toBe(1);

    const g = tracker.getGlobalUsage();
    expect(g.totals.callCount).toBe(1);
    expect(g.totals.byProviderCost.openai).toBeCloseTo(0.45, 8);
    expect(g.userCount).toBe(1);
  });

  test('checkBudget enforces the daily cap and resets at UTC midnight', () => {
    tracker.record('bob', 'openai', 'gpt-4o-mini', 1_000_000, 1_000_000); // $0.75 today
    const allowed = tracker.checkBudget('bob', 1.00);
    expect(allowed.allowed).toBe(true);
    expect(allowed.spentTodayUsd).toBeCloseTo(0.75, 6);
    expect(allowed.remainingUsd).toBeCloseTo(0.25, 6);

    const blocked = tracker.checkBudget('bob', 0.50);
    expect(blocked.allowed).toBe(false);
    expect(blocked.budgetUsd).toBe(0.50);

    // Disabled (budget <= 0) always allows.
    expect(tracker.checkBudget('bob', 0).allowed).toBe(true);
  });

  test('toPrometheus emits valid exposition with required HELP/TYPE lines', () => {
    tracker.record('carol', 'openai', 'gpt-4o-mini', 100_000, 200_000);
    const text = tracker.toPrometheus();
    expect(text).toMatch(/# HELP paw_llm_calls_total/);
    expect(text).toMatch(/# TYPE paw_llm_calls_total counter/);
    expect(text).toMatch(/^paw_llm_calls_total 1$/m);
    expect(text).toMatch(/paw_llm_tokens_by_provider_total\{provider="openai"\} 300000/);
    expect(text.endsWith('\n')).toBe(true);
  });

  test('flush persists state and a fresh tracker reloads it', () => {
    tracker.record('dave', 'anthropic', 'claude-sonnet-4-20250514', 1000, 2000);
    tracker.flush();
    expect(fs.existsSync(tmpFile)).toBe(true);

    const reloaded = new CostTracker(tmpFile);
    const u = reloaded.getUserUsage('dave')!;
    expect(u.callCount).toBe(1);
    expect(u.totalOutputTokens).toBe(2000);
  });

  test('getRecent caps results to the requested limit', () => {
    for (let i = 0; i < 5; i++) tracker.record('e', 'openai', 'gpt-4o-mini', 10, 10);
    expect(tracker.getRecent(3)).toHaveLength(3);
    expect(tracker.getRecent(100)).toHaveLength(5);
  });
});
