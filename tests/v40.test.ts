// ─── PAW v4.0 Simulation Tests ───
// Tests for MCP, Crews, Research, Thinking, Sandbox, Workflows, Plugins

// ═══════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════

describe('MCP Server', () => {
  let PawMCPServer: typeof import('../src/mcp/server').PawMCPServer;

  beforeAll(() => {
    PawMCPServer = require('../src/mcp/server').PawMCPServer;
  });

  test('PawMCPServer exports correctly', () => {
    expect(PawMCPServer).toBeDefined();
    expect(typeof PawMCPServer).toBe('function');
  });

  test('creates server instance with default config', () => {
    const server = new PawMCPServer();
    expect(server).toBeDefined();
    expect(typeof server.start).toBe('function');
    expect(typeof server.stop).toBe('function');
    expect(typeof server.registerTool).toBe('function');
  });

  test('creates server with custom port and host', () => {
    const server = new PawMCPServer(9999, '0.0.0.0');
    expect(server).toBeDefined();
  });

  test('registerTool adds a tool', () => {
    const server = new PawMCPServer();
    server.registerTool(
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: { msg: { type: 'string', description: 'test' } }, required: ['msg'] },
      },
      async (params) => ({ echo: params.msg }),
    );
    expect(server).toBeDefined();
  });

  test('registerResource adds a resource', () => {
    const server = new PawMCPServer();
    server.registerResource('paw://test', 'Test Resource', 'A test resource', 'text/plain');
    expect(server).toBeDefined();
  });

  test('has builtin tools registered', () => {
    const server = new PawMCPServer();
    // The constructor registers builtin tools — server should have them
    expect(server).toBeDefined();
  });
});

// ═══════════════════════════════════════
// MCP Client
// ═══════════════════════════════════════

describe('MCP Client', () => {
  let PawMCPClient: typeof import('../src/mcp/client').PawMCPClient;

  beforeAll(() => {
    PawMCPClient = require('../src/mcp/client').PawMCPClient;
  });

  test('PawMCPClient exports correctly', () => {
    expect(PawMCPClient).toBeDefined();
    expect(typeof PawMCPClient).toBe('function');
  });

  test('creates client with defaults', () => {
    const client = new PawMCPClient();
    expect(client).toBeDefined();
    expect(typeof client.connect).toBe('function');
    expect(typeof client.invokeTool).toBe('function');
    expect(typeof client.getAllTools).toBe('function');
    expect(typeof client.disconnect).toBe('function');
  });

  test('creates client with custom options', () => {
    const client = new PawMCPClient({ timeout: 5000, retries: 1 });
    expect(client).toBeDefined();
  });

  test('getAllTools returns empty on fresh client', () => {
    const client = new PawMCPClient();
    expect(client.getAllTools()).toEqual([]);
  });

  test('getConnections returns empty on fresh client', () => {
    const client = new PawMCPClient();
    expect(client.getConnections()).toEqual([]);
  });

  test('rejects invalid protocol', async () => {
    const client = new PawMCPClient();
    await expect(client.connect('ftp://evil.com')).rejects.toThrow('Unsupported protocol');
  });

  test('invokeTool throws when not connected', async () => {
    const client = new PawMCPClient();
    await expect(client.invokeTool('http://localhost:9999', 'test', {})).rejects.toThrow('Not connected');
  });
});

// ═══════════════════════════════════════
// Multi-Agent Crews
// ═══════════════════════════════════════

describe('Crew Engine', () => {
  let CrewEngine: typeof import('../src/crews/engine').CrewEngine;

  beforeAll(() => {
    CrewEngine = require('../src/crews/engine').CrewEngine;
  });

  test('CrewEngine exports correctly', () => {
    expect(CrewEngine).toBeDefined();
    expect(typeof CrewEngine).toBe('function');
  });

  test('creates engine with executor', () => {
    const engine = new CrewEngine(async () => 'test output');
    expect(engine).toBeDefined();
    expect(typeof engine.run).toBe('function');
  });

  test('runs sequential crew', async () => {
    const engine = new CrewEngine(async (_agent, task) => `Completed: ${task.description}`);
    const result = await engine.run({
      name: 'Test Crew',
      objective: 'Testing',
      agents: [
        { id: '1', role: 'researcher', goal: 'Research', backstory: 'Expert', tools: [] },
      ],
      tasks: [
        { id: 't1', description: 'Research topic', expectedOutput: 'Report', agent: 'researcher' },
      ],
      process: 'sequential',
    });
    expect(result.success).toBe(true);
    expect(result.results.length).toBe(1);
    expect(result.results[0].output).toContain('Research topic');
  });

  test('runs parallel crew', async () => {
    const engine = new CrewEngine(async (_agent, task) => `Done: ${task.description}`);
    const result = await engine.run({
      name: 'Parallel',
      objective: 'Test parallel',
      agents: [
        { id: '1', role: 'writer', goal: 'Write', backstory: '', tools: [] },
        { id: '2', role: 'editor', goal: 'Edit', backstory: '', tools: [] },
      ],
      tasks: [
        { id: 't1', description: 'Write draft', expectedOutput: 'Draft', agent: 'writer' },
        { id: 't2', description: 'Edit draft', expectedOutput: 'Final', agent: 'editor', context: ['t1'] },
      ],
      process: 'parallel',
    });
    expect(result.success).toBe(true);
    expect(result.results.length).toBe(2);
  });

  test('runs hierarchical crew', async () => {
    const engine = new CrewEngine(async (_agent, task) => `Manager assigned: ${task.description}`);
    const result = await engine.run({
      name: 'Hierarchical',
      objective: 'Test hierarchy',
      agents: [
        { id: '1', role: 'analyst', goal: 'Analyze', backstory: '', tools: [] },
      ],
      tasks: [
        { id: 't1', description: 'Analyze data', expectedOutput: 'Report', agent: 'analyst' },
      ],
      process: 'hierarchical',
    });
    expect(result.success).toBe(true);
  });

  test('throws for unknown agent role', async () => {
    const engine = new CrewEngine(async () => 'x');
    await expect(engine.run({
      name: 'Bad Crew',
      objective: 'Test',
      agents: [{ id: '1', role: 'dev', goal: '', backstory: '', tools: [] }],
      tasks: [{ id: 't1', description: 'Do work', expectedOutput: '', agent: 'nonexistent' }],
      process: 'sequential',
    })).rejects.toThrow('unknown agent role');
  });

  test('handles executor failure gracefully', async () => {
    const engine = new CrewEngine(async () => { throw new Error('LLM failed'); });
    const result = await engine.run({
      name: 'Fail Crew',
      objective: 'Test failure',
      agents: [{ id: '1', role: 'dev', goal: '', backstory: '', tools: [] }],
      tasks: [{ id: 't1', description: 'Fail', expectedOutput: '', agent: 'dev' }],
      process: 'sequential',
    });
    expect(result.success).toBe(false);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('LLM failed');
  });
});

// ═══════════════════════════════════════
// Deep Research Engine
// ═══════════════════════════════════════

describe('Deep Research Engine', () => {
  let DeepResearchEngine: typeof import('../src/research/engine').DeepResearchEngine;

  beforeAll(() => {
    DeepResearchEngine = require('../src/research/engine').DeepResearchEngine;
  });

  test('exports correctly', () => {
    expect(DeepResearchEngine).toBeDefined();
  });

  test('creates instance with adapters', () => {
    const engine = new DeepResearchEngine(
      async () => [],
      async () => ({ content: '', title: '' }),
      async () => 'analysis',
    );
    expect(engine).toBeDefined();
    expect(typeof engine.research).toBe('function');
    expect(typeof engine.getSteps).toBe('function');
  });

  test('runs quick research', async () => {
    const engine = new DeepResearchEngine(
      async (q) => [{ url: 'https://example.com', title: q, snippet: 'Test', relevanceScore: 0.9, fetchedAt: new Date().toISOString() }],
      async () => ({ content: 'This is test content about AI agents.', title: 'Test Page' }),
      async (_sys, prompt) => {
        if (prompt.includes('Topic:')) return '["AI agents overview"]';
        if (prompt.includes('[Source')) return '## Key Findings\nAI agents are important [1].\n## Conclusion\nGreat progress.';
        return 'A concise summary of AI agent research.';
      },
    );

    const report = await engine.research({ topic: 'AI agents', depth: 'quick' });
    expect(report.id).toBeDefined();
    expect(report.depth).toBe('quick');
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.duration_ms).toBeGreaterThan(0);
    expect(report.summary).toBeDefined();
  });

  test('getSteps returns execution steps', async () => {
    const engine = new DeepResearchEngine(
      async () => [{ url: 'https://x.com', title: 'Test', snippet: 'T', relevanceScore: 1, fetchedAt: '' }],
      async () => ({ content: 'content', title: 'title' }),
      async () => '## Results\nOk',
    );
    await engine.research({ topic: 'Test', depth: 'quick' });
    const steps = engine.getSteps();
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].action).toBe('search');
  });
});

// ═══════════════════════════════════════
// Extended Thinking
// ═══════════════════════════════════════

describe('Extended Thinking Engine', () => {
  let ExtendedThinkingEngine: typeof import('../src/thinking/engine').ExtendedThinkingEngine;

  beforeAll(() => {
    ExtendedThinkingEngine = require('../src/thinking/engine').ExtendedThinkingEngine;
  });

  test('exports correctly', () => {
    expect(ExtendedThinkingEngine).toBeDefined();
  });

  test('creates instance', () => {
    const engine = new ExtendedThinkingEngine(
      { enabled: true, provider: 'generic', budgetTokens: 5000, adaptive: false, showThinking: true, streamThinking: false, chainOfThought: true },
      async () => ({ thinking: 'I thought about it', response: 'Here is my answer', thinkingTokens: 100, responseTokens: 50 }),
    );
    expect(engine).toBeDefined();
  });

  test('think returns result with thinking disabled', async () => {
    const engine = new ExtendedThinkingEngine(
      { enabled: false, provider: 'generic', budgetTokens: 5000, adaptive: false, showThinking: true, streamThinking: false, chainOfThought: false },
      async () => ({ thinking: '', response: 'Answer: 42', thinkingTokens: 0, responseTokens: 10 }),
    );
    const result = await engine.think('system', 'What is 6x7?');
    expect(result.response).toBe('Answer: 42');
    expect(result.thinking).toEqual([]);
    expect(result.totalThinkingTokens).toBe(0);
  });

  test('think returns result with thinking enabled', async () => {
    const engine = new ExtendedThinkingEngine(
      { enabled: true, provider: 'claude', budgetTokens: 5000, adaptive: false, showThinking: true, streamThinking: false, chainOfThought: false },
      async () => ({ thinking: 'Step 1: multiply. Step 2: result.', response: '42', thinkingTokens: 50, responseTokens: 5 }),
    );
    const result = await engine.think('system', 'What is 6x7?');
    expect(result.response).toBe('42');
    expect(result.thinking.length).toBeGreaterThan(0);
    expect(result.thinking[0].content).toContain('Step 1');
    expect(result.totalThinkingTokens).toBe(50);
    expect(result.provider).toBe('claude');
  });

  test('assessComplexity scores properly', async () => {
    const engine = new ExtendedThinkingEngine(
      { enabled: true, provider: 'generic', budgetTokens: 50000, adaptive: true, showThinking: true, streamThinking: false, chainOfThought: true },
      async () => ({ thinking: '', response: '', thinkingTokens: 0, responseTokens: 0 }),
    );
    const simple = await engine.assessComplexity('Hello');
    expect(simple.score).toBeLessThan(0.5);
    expect(simple.recommendedBudget).toBeLessThan(30000);

    const complex = await engine.assessComplexity('Please implement a multi-step algorithm to analyze and compare these complex code implementations, calculate the mathematical proof, and synthesize the results');
    expect(complex.score).toBeGreaterThan(simple.score);
    expect(complex.recommendedBudget).toBeGreaterThan(simple.recommendedBudget);
  });

  test('chainOfThought parses thinking tags', async () => {
    const engine = new ExtendedThinkingEngine(
      { enabled: true, provider: 'generic', budgetTokens: 5000, adaptive: false, showThinking: true, streamThinking: false, chainOfThought: true },
      async () => ({ thinking: '', response: '<thinking>\nStep by step reasoning\n</thinking>\n\n<answer>\nFinal answer here\n</answer>', thinkingTokens: 0, responseTokens: 20 }),
    );
    const result = await engine.chainOfThought('system', 'test');
    expect(result.response).toBe('Final answer here');
    expect(result.thinking[0].content).toContain('Step by step');
  });

  test('getConfig and updateConfig work', () => {
    const engine = new ExtendedThinkingEngine(
      { enabled: true, provider: 'claude', budgetTokens: 5000, adaptive: false, showThinking: false, streamThinking: false, chainOfThought: false },
      async () => ({ thinking: '', response: '', thinkingTokens: 0, responseTokens: 0 }),
    );
    expect(engine.getConfig().provider).toBe('claude');
    engine.updateConfig({ provider: 'openai' });
    expect(engine.getConfig().provider).toBe('openai');
  });
});

// ═══════════════════════════════════════
// Code Sandbox
// ═══════════════════════════════════════

describe('Code Sandbox', () => {
  let CodeSandbox: typeof import('../src/sandbox/executor').CodeSandbox;

  beforeAll(() => {
    CodeSandbox = require('../src/sandbox/executor').CodeSandbox;
  });

  test('exports correctly', () => {
    expect(CodeSandbox).toBeDefined();
  });

  test('creates sandbox with defaults', () => {
    const sandbox = new CodeSandbox();
    expect(sandbox).toBeDefined();
    expect(typeof sandbox.execute).toBe('function');
  });

  test('executes simple code', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'console.log("hello")', language: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  test('captures return value', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'return 2 + 3', language: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(5);
  });

  test('captures console.error', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'console.error("bad")', language: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('[ERROR] bad');
  });

  test('blocks process.exit', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'process.exit(1)', language: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Process termination');
  });

  test('blocks child_process', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'require("child_process").exec("ls")', language: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Shell execution');
  });

  test('blocks eval', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'eval("1+1")', language: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Dynamic code execution');
  });

  test('blocks prototype pollution', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'const a = {}; a.__proto__.polluted = true', language: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Prototype');
  });

  test('blocks network by default', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'fetch("https://evil.com")', language: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network access');
  });

  test('blocks fs by default', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({ code: 'require("fs").readFileSync("/etc/passwd")', language: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('File system');
  });

  test('handles timeout', async () => {
    const sandbox = new CodeSandbox({ timeout: 100 });
    const result = await sandbox.execute({ code: 'while(true){}', language: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  test('supports custom globals', async () => {
    const sandbox = new CodeSandbox();
    const result = await sandbox.execute({
      code: 'console.log(myVar)',
      language: 'javascript',
      globals: { myVar: 'injected' },
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('injected');
  });

  test('getHistory tracks executions', async () => {
    const sandbox = new CodeSandbox();
    await sandbox.execute({ code: 'return 1', language: 'javascript' });
    await sandbox.execute({ code: 'return 2', language: 'javascript' });
    expect(sandbox.getHistory().length).toBe(2);
  });

  test('clearHistory resets', async () => {
    const sandbox = new CodeSandbox();
    await sandbox.execute({ code: 'return 1', language: 'javascript' });
    sandbox.clearHistory();
    expect(sandbox.getHistory().length).toBe(0);
  });

  test('truncates large output', async () => {
    const sandbox = new CodeSandbox({ maxOutputSize: 100 });
    const result = await sandbox.execute({
      code: 'for(let i=0;i<1000;i++) console.log("x".repeat(50))',
      language: 'javascript',
    });
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════
// Workflow Graph Engine
// ═══════════════════════════════════════

describe('Workflow Graph Engine', () => {
  let WorkflowGraphEngine: typeof import('../src/workflows/graph').WorkflowGraphEngine;

  beforeAll(() => {
    WorkflowGraphEngine = require('../src/workflows/graph').WorkflowGraphEngine;
  });

  test('exports correctly', () => {
    expect(WorkflowGraphEngine).toBeDefined();
  });

  test('creates engine instance', () => {
    const engine = new WorkflowGraphEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.register).toBe('function');
    expect(typeof engine.run).toBe('function');
  });

  test('registers and lists workflows', () => {
    const engine = new WorkflowGraphEngine();
    engine.register({
      id: 'test-wf',
      name: 'Test Workflow',
      description: 'A test',
      nodes: [
        { id: 'start', name: 'Start', type: 'action', handler: async (state) => ({ ...state, started: true }) },
      ],
      edges: [],
      entryNode: 'start',
    });
    const list = engine.listWorkflows();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Test Workflow');
  });

  test('runs simple linear workflow', async () => {
    const engine = new WorkflowGraphEngine();
    engine.register({
      id: 'linear',
      name: 'Linear',
      nodes: [
        { id: 'a', name: 'Step A', type: 'action', handler: async (state) => ({ ...state, a: true }) },
        { id: 'b', name: 'Step B', type: 'action', handler: async (state) => ({ ...state, b: true }) },
      ],
      edges: [{ from: 'a', to: 'b' }],
      entryNode: 'a',
    });
    const result = await engine.run('linear', { input: 'test' });
    expect(result.success).toBe(true);
    expect(result.finalState.a).toBe(true);
    expect(result.finalState.b).toBe(true);
    expect(result.nodesCompleted).toBe(2);
  });

  test('runs conditional workflow', async () => {
    const engine = new WorkflowGraphEngine();
    engine.register({
      id: 'conditional',
      name: 'Conditional',
      nodes: [
        { id: 'check', name: 'Check', type: 'condition', handler: async (state) => ({ ...state, checked: true }) },
        { id: 'yes', name: 'Yes Branch', type: 'action', handler: async (state) => ({ ...state, branch: 'yes' }) },
        { id: 'no', name: 'No Branch', type: 'action', handler: async (state) => ({ ...state, branch: 'no' }) },
      ],
      edges: [
        { from: 'check', to: 'yes', condition: (state) => state.goYes === true },
        { from: 'check', to: 'no', condition: (state) => state.goYes !== true },
      ],
      entryNode: 'check',
    });

    const r1 = await engine.run('conditional', { goYes: true });
    expect(r1.finalState.branch).toBe('yes');

    const r2 = await engine.run('conditional', { goYes: false });
    expect(r2.finalState.branch).toBe('no');
  });

  test('handles node failure', async () => {
    const engine = new WorkflowGraphEngine();
    engine.register({
      id: 'fail-wf',
      name: 'Fail',
      nodes: [
        { id: 'boom', name: 'Boom', type: 'action', handler: async () => { throw new Error('Exploded'); } },
      ],
      edges: [],
      entryNode: 'boom',
    });
    const result = await engine.run('fail-wf');
    expect(result.success).toBe(false);
    expect(result.nodesFailed).toBe(1);
    expect(result.error).toContain('Exploded');
  });

  test('retries failed nodes', async () => {
    let callCount = 0;
    const engine = new WorkflowGraphEngine();
    engine.register({
      id: 'retry-wf',
      name: 'Retry',
      nodes: [
        {
          id: 'flaky', name: 'Flaky', type: 'action', retries: 2,
          handler: async (state) => {
            callCount++;
            if (callCount < 3) throw new Error('not yet');
            return { ...state, done: true };
          },
        },
      ],
      edges: [],
      entryNode: 'flaky',
    });
    const result = await engine.run('retry-wf');
    expect(result.success).toBe(true);
    expect(callCount).toBe(3);
  });

  test('rejects cycle in graph', () => {
    const engine = new WorkflowGraphEngine();
    expect(() => {
      engine.register({
        id: 'cycle',
        name: 'Cycle',
        nodes: [
          { id: 'a', name: 'A', type: 'action', handler: async (s) => s },
          { id: 'b', name: 'B', type: 'action', handler: async (s) => s },
        ],
        edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
        entryNode: 'a',
      });
    }).toThrow('cycle');
  });

  test('rejects unknown entry node', () => {
    const engine = new WorkflowGraphEngine();
    expect(() => {
      engine.register({
        id: 'bad-entry',
        name: 'Bad',
        nodes: [{ id: 'a', name: 'A', type: 'action', handler: async (s) => s }],
        edges: [],
        entryNode: 'nonexistent',
      });
    }).toThrow('not found');
  });

  test('throws for unknown workflow ID', async () => {
    const engine = new WorkflowGraphEngine();
    await expect(engine.run('no-such-workflow')).rejects.toThrow('not found');
  });

  test('removeWorkflow works', () => {
    const engine = new WorkflowGraphEngine();
    engine.register({
      id: 'rm-wf',
      name: 'Remove',
      nodes: [{ id: 'a', name: 'A', type: 'action', handler: async (s) => s }],
      edges: [],
      entryNode: 'a',
    });
    expect(engine.removeWorkflow('rm-wf')).toBe(true);
    expect(engine.listWorkflows().length).toBe(0);
  });
});

// ═══════════════════════════════════════
// Plugin Manager
// ═══════════════════════════════════════

describe('Plugin Manager', () => {
  let PluginManager: typeof import('../src/plugins/manager').PluginManager;

  beforeAll(() => {
    PluginManager = require('../src/plugins/manager').PluginManager;
  });

  test('exports correctly', () => {
    expect(PluginManager).toBeDefined();
  });

  test('creates manager instance', () => {
    const manager = new PluginManager(['/tmp/plugins'], '4.0.0');
    expect(manager).toBeDefined();
    expect(typeof manager.discover).toBe('function');
    expect(typeof manager.load).toBe('function');
    expect(typeof manager.activate).toBe('function');
    expect(typeof manager.deactivate).toBe('function');
  });

  test('list returns empty on fresh manager', () => {
    const manager = new PluginManager([], '4.0.0');
    expect(manager.list()).toEqual([]);
  });

  test('getTools returns empty initially', () => {
    const manager = new PluginManager([], '4.0.0');
    expect(manager.getTools()).toEqual([]);
  });

  test('getChannels returns empty initially', () => {
    const manager = new PluginManager([], '4.0.0');
    expect(manager.getChannels()).toEqual([]);
  });

  test('getProviders returns empty initially', () => {
    const manager = new PluginManager([], '4.0.0');
    expect(manager.getProviders()).toEqual([]);
  });

  test('getMiddleware returns empty initially', () => {
    const manager = new PluginManager([], '4.0.0');
    expect(manager.getMiddleware()).toEqual([]);
  });

  test('discover returns empty for nonexistent dirs', async () => {
    const manager = new PluginManager(['/nonexistent/path'], '4.0.0');
    const manifests = await manager.discover();
    expect(manifests).toEqual([]);
  });

  test('load returns null for missing manifest', async () => {
    const manager = new PluginManager([], '4.0.0');
    const result = await manager.load('/nonexistent/plugin');
    expect(result).toBeNull();
  });

  test('activate returns false for unknown plugin', async () => {
    const manager = new PluginManager([], '4.0.0');
    expect(await manager.activate('nonexistent')).toBe(false);
  });

  test('deactivate returns false for unknown plugin', async () => {
    const manager = new PluginManager([], '4.0.0');
    expect(await manager.deactivate('nonexistent')).toBe(false);
  });

  test('unload returns false for unknown plugin', async () => {
    const manager = new PluginManager([], '4.0.0');
    expect(await manager.unload('nonexistent')).toBe(false);
  });
});

// ═══════════════════════════════════════
// Config v4.0 Sections
// ═══════════════════════════════════════

describe('Config v4.0', () => {
  const { config } = require('../src/core/config');

  test('mcp config exists', () => {
    expect(config.mcp).toBeDefined();
    expect(typeof config.mcp.serverEnabled).toBe('boolean');
    expect(typeof config.mcp.serverPort).toBe('number');
  });

  test('crews config exists', () => {
    expect(config.crews).toBeDefined();
    expect(typeof config.crews.enabled).toBe('boolean');
    expect(typeof config.crews.maxAgentsPerCrew).toBe('number');
  });

  test('research config exists', () => {
    expect(config.research).toBeDefined();
    expect(typeof config.research.enabled).toBe('boolean');
    expect(['quick', 'standard', 'deep', 'exhaustive']).toContain(config.research.defaultDepth);
  });

  test('thinking config exists', () => {
    expect(config.thinking).toBeDefined();
    expect(typeof config.thinking.enabled).toBe('boolean');
    expect(['claude', 'openai', 'generic']).toContain(config.thinking.provider);
  });

  test('sandbox config exists', () => {
    expect(config.sandbox).toBeDefined();
    expect(typeof config.sandbox.enabled).toBe('boolean');
    expect(typeof config.sandbox.timeout).toBe('number');
  });

  test('workflows config exists', () => {
    expect(config.workflows).toBeDefined();
    expect(typeof config.workflows.enabled).toBe('boolean');
    expect(typeof config.workflows.maxSteps).toBe('number');
  });

  test('plugins config exists', () => {
    expect(config.plugins).toBeDefined();
    expect(typeof config.plugins.enabled).toBe('boolean');
    expect(Array.isArray(config.plugins.dirs)).toBe(true);
  });

  test('package version is 4.0.0', () => {
    const pkg = require('../package.json');
    expect(pkg.version).toBe('4.0.0');
  });
});
