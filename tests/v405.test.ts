// Tests covering safety/quality fixes shipped in v4.0.5+ comprehensive audit:
//  - ExecutionEngine per-tool timeout
//  - ExecutionEngine retry-with-jitter (does not throw)
//  - UserProfiler eviction respects MAX_PROFILES_IN_MEMORY
//  - WorkflowGraphEngine cycle detection
//  - Browser engine evaluate() blocks dangerous patterns

import { ExecutionEngine } from '../src/execution/engine';
import { SolanaExecutor } from '../src/integrations/solana/executor';
import { PurpEngine } from '../src/integrations/purp/engine';
import { UserProfiler } from '../src/intelligence/profiler';
import { WorkflowGraphEngine, WorkflowConfig } from '../src/workflows/graph';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('v4.0.5 hardening — ExecutionEngine timeout', () => {
  // Reduce timeout + retries via env so the test runs in <1s
  beforeAll(() => {
    process.env.PAW_EXEC_STEP_TIMEOUT_MS = '120';
    process.env.PAW_EXEC_RETRY_DELAY_MS = '20';
    process.env.PAW_EXEC_MAX_RETRIES = '1';
  });
  afterAll(() => {
    delete process.env.PAW_EXEC_STEP_TIMEOUT_MS;
    delete process.env.PAW_EXEC_RETRY_DELAY_MS;
    delete process.env.PAW_EXEC_MAX_RETRIES;
  });

  test('hanging tool is aborted by timeout, not retried forever', async () => {
    const solana = new SolanaExecutor();
    const purp = new PurpEngine();
    const engine = new ExecutionEngine(solana, purp);

    let calls = 0;
    engine.registerTool('test_hang', async () => {
      calls++;
      // never resolves
      await new Promise(() => undefined);
      return null;
    });

    const result = await engine.execute({
      id: 'plan_hang',
      intent: 'test',
      task_type: 'general',
      plan: [{ step: 1, action: 'hang', tool: 'test_hang', params: {} }],
      reasoning: '',
      risk_score: 0,
      confidence: 1,
      requires_confirmation: false,
      estimated_duration_ms: 0,
      requires_keys: [],
    } as any);

    expect(result.success).toBe(false);
    // PAW_EXEC_MAX_RETRIES = 1 → 2 total attempts
    expect(calls).toBe(2);
    expect(result.error?.message).toMatch(/timed out/);
  }, 5_000);

  test('successful tool runs without timeout overhead', async () => {
    const solana = new SolanaExecutor();
    const purp = new PurpEngine();
    const engine = new ExecutionEngine(solana, purp);

    engine.registerTool('test_quick', async (params) => ({ ok: true, got: params }));

    const result = await engine.execute({
      id: 'plan_ok',
      intent: 'test',
      task_type: 'general',
      plan: [{ step: 1, action: 'quick', tool: 'test_quick', params: { x: 1 } }],
      reasoning: '',
      risk_score: 0,
      confidence: 1,
      requires_confirmation: false,
      estimated_duration_ms: 0,
      requires_keys: [],
    } as any);

    expect(result.success).toBe(true);
    expect(result.steps_completed).toHaveLength(1);
  });
});

describe('v4.0.5 hardening — UserProfiler eviction', () => {
  test('eviction caps in-memory profiles to MAX_PROFILES_IN_MEMORY', () => {
    process.env.PAW_PROFILER_MAX_IN_MEMORY = '20';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-profiler-'));
    const profiler = new UserProfiler(tmp);
    for (let i = 0; i < 200; i++) {
      const p = profiler.getProfile(`u${i}`);
      // Stagger last_seen so eviction has a stable order
      p.last_seen = new Date(Date.now() - (200 - i) * 1000).toISOString();
    }
    const size = (profiler as any).profiles.size;
    // After eviction the cache target is ~90% of max (20 * 0.9 = 18)
    expect(size).toBeLessThanOrEqual(20);
    delete process.env.PAW_PROFILER_MAX_IN_MEMORY;
  });
});

describe('v4.0.5 hardening — Workflow cycle detection', () => {
  test('register() rejects a workflow with a cycle', () => {
    const engine = new WorkflowGraphEngine();
    const cyclic: WorkflowConfig = {
      id: 'cyclic',
      name: 'cyclic',
      nodes: [
        { id: 'a', name: 'a', type: 'action', handler: async (s) => s },
        { id: 'b', name: 'b', type: 'action', handler: async (s) => s },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      entryNode: 'a',
    };
    expect(() => engine.register(cyclic)).toThrow(/cycle/i);
  });

  test('register() accepts a valid DAG', () => {
    const engine = new WorkflowGraphEngine();
    const dag: WorkflowConfig = {
      id: 'dag',
      name: 'dag',
      nodes: [
        { id: 'a', name: 'a', type: 'action', handler: async (s) => s },
        { id: 'b', name: 'b', type: 'action', handler: async (s) => s },
      ],
      edges: [{ from: 'a', to: 'b' }],
      entryNode: 'a',
    };
    expect(() => engine.register(dag)).not.toThrow();
  });
});

// (Browser sandbox URL/script blocking is tested via integration scripts —
//  unit-testing it here would force a real Chromium launch on every CI run.)
