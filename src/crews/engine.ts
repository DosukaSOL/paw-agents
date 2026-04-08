// ─── PAW Multi-Agent Crews ───
// Role-based multi-agent orchestration. Inspired by CrewAI but built natively in TypeScript.
// Supports sequential, parallel, and hierarchical execution with delegation.

import { v4 as uuid } from 'uuid';

// ─── Types ───

export interface CrewAgent {
  id: string;
  role: string;
  goal: string;
  backstory: string;
  tools: string[];
  model?: string;
  maxIterations?: number;
  allowDelegation?: boolean;
  verbose?: boolean;
}

export interface CrewTask {
  id: string;
  description: string;
  expectedOutput: string;
  agent: string; // agent role
  context?: string[]; // task IDs whose output provides context
  tools?: string[];
  async?: boolean;
  callbackOnComplete?: (result: TaskResult) => void;
}

export type CrewProcess = 'sequential' | 'parallel' | 'hierarchical';

export interface CrewConfig {
  name: string;
  objective: string;
  agents: CrewAgent[];
  tasks: CrewTask[];
  process: CrewProcess;
  verbose?: boolean;
  maxRounds?: number;
  managerModel?: string; // for hierarchical process
  shareContext?: boolean;
}

export interface TaskResult {
  taskId: string;
  agentRole: string;
  output: string;
  success: boolean;
  error?: string;
  duration_ms: number;
  toolsUsed: string[];
  delegatedTo?: string;
  metadata: Record<string, unknown>;
}

export interface CrewResult {
  crewId: string;
  name: string;
  objective: string;
  process: CrewProcess;
  results: TaskResult[];
  finalOutput: string;
  success: boolean;
  duration_ms: number;
  agentsUsed: string[];
  roundsExecuted: number;
}

// ─── Agent Executor ───

type AgentExecutor = (agent: CrewAgent, task: CrewTask, context: string) => Promise<string>;

// ─── Crew Engine ───

export class CrewEngine {
  private executor: AgentExecutor;
  private verbose: boolean;

  constructor(executor: AgentExecutor, verbose?: boolean) {
    this.executor = executor;
    this.verbose = verbose ?? false;
  }

  async run(crewConfig: CrewConfig): Promise<CrewResult> {
    const crewId = uuid();
    const startTime = Date.now();
    const maxRounds = crewConfig.maxRounds ?? 1;
    const results: TaskResult[] = [];

    this.log(`[Crew] Starting "${crewConfig.name}" — ${crewConfig.process} process, ${crewConfig.agents.length} agents, ${crewConfig.tasks.length} tasks`);

    const agentMap = new Map<string, CrewAgent>();
    for (const agent of crewConfig.agents) {
      agent.id = agent.id || uuid();
      agentMap.set(agent.role, agent);
    }

    // Validate tasks reference valid agents
    for (const task of crewConfig.tasks) {
      task.id = task.id || uuid();
      if (!agentMap.has(task.agent)) {
        throw new Error(`Task "${task.description.slice(0, 50)}" references unknown agent role: "${task.agent}"`);
      }
    }

    let roundsExecuted = 0;

    for (let round = 0; round < maxRounds; round++) {
      roundsExecuted++;
      this.log(`[Crew] Round ${round + 1}/${maxRounds}`);

      switch (crewConfig.process) {
        case 'sequential':
          await this.runSequential(crewConfig, agentMap, results);
          break;
        case 'parallel':
          await this.runParallel(crewConfig, agentMap, results);
          break;
        case 'hierarchical':
          await this.runHierarchical(crewConfig, agentMap, results);
          break;
      }
    }

    const allSuccess = results.every(r => r.success);
    const finalOutput = results.length > 0 ? results[results.length - 1].output : '';

    const crewResult: CrewResult = {
      crewId,
      name: crewConfig.name,
      objective: crewConfig.objective,
      process: crewConfig.process,
      results,
      finalOutput,
      success: allSuccess,
      duration_ms: Date.now() - startTime,
      agentsUsed: [...new Set(results.map(r => r.agentRole))],
      roundsExecuted,
    };

    this.log(`[Crew] Completed "${crewConfig.name}" in ${crewResult.duration_ms}ms — ${allSuccess ? 'SUCCESS' : 'PARTIAL FAILURE'}`);
    return crewResult;
  }

  // ─── Sequential Execution ───

  private async runSequential(
    crewConfig: CrewConfig,
    agentMap: Map<string, CrewAgent>,
    results: TaskResult[]
  ): Promise<void> {
    const contextMap = new Map<string, string>();

    for (const task of crewConfig.tasks) {
      const agent = agentMap.get(task.agent)!;
      const context = this.buildContext(task, contextMap, crewConfig.shareContext ? results : []);
      const result = await this.executeTask(agent, task, context);
      results.push(result);
      contextMap.set(task.id, result.output);

      if (task.callbackOnComplete) {
        task.callbackOnComplete(result);
      }
    }
  }

  // ─── Parallel Execution ───

  private async runParallel(
    crewConfig: CrewConfig,
    agentMap: Map<string, CrewAgent>,
    results: TaskResult[]
  ): Promise<void> {
    // Group tasks by dependency level
    const levels = this.topologicalSort(crewConfig.tasks);
    const contextMap = new Map<string, string>();

    for (const level of levels) {
      const promises = level.map(async (task) => {
        const agent = agentMap.get(task.agent)!;
        const context = this.buildContext(task, contextMap, crewConfig.shareContext ? results : []);
        return this.executeTask(agent, task, context);
      });

      const levelResults = await Promise.all(promises);
      for (const result of levelResults) {
        results.push(result);
        const task = crewConfig.tasks.find(t => t.id === result.taskId);
        if (task) {
          contextMap.set(task.id, result.output);
          if (task.callbackOnComplete) {
            task.callbackOnComplete(result);
          }
        }
      }
    }
  }

  // ─── Hierarchical Execution ───

  private async runHierarchical(
    crewConfig: CrewConfig,
    agentMap: Map<string, CrewAgent>,
    results: TaskResult[]
  ): Promise<void> {
    // Manager agent coordinates. Use first agent or a virtual manager.
    const managerRole = 'crew_manager';
    const manager: CrewAgent = {
      id: uuid(),
      role: managerRole,
      goal: `Coordinate the crew to achieve: ${crewConfig.objective}`,
      backstory: `You are an expert project manager coordinating a team of ${crewConfig.agents.length} specialists.`,
      tools: [],
      model: crewConfig.managerModel,
      allowDelegation: true,
    };

    // Manager delegates tasks sequentially but can re-assign
    const contextMap = new Map<string, string>();

    for (const task of crewConfig.tasks) {
      const agent = agentMap.get(task.agent)!;

      // Manager reviews the task assignment
      const delegationContext = `OBJECTIVE: ${crewConfig.objective}\nTASK: ${task.description}\nASSIGNED TO: ${agent.role} (${agent.goal})\nEXPECTED OUTPUT: ${task.expectedOutput}`;

      this.log(`[Crew Manager] Delegating task to ${agent.role}`);
      const context = this.buildContext(task, contextMap, results);
      const result = await this.executeTask(agent, task, `${delegationContext}\n\nCONTEXT:\n${context}`);
      result.delegatedTo = agent.role;
      results.push(result);
      contextMap.set(task.id, result.output);

      if (task.callbackOnComplete) {
        task.callbackOnComplete(result);
      }
    }

    // Suppress unused variable warning
    void manager;
  }

  // ─── Task Execution ───

  private async executeTask(agent: CrewAgent, task: CrewTask, context: string): Promise<TaskResult> {
    const startTime = Date.now();
    this.log(`[Agent: ${agent.role}] Starting task: ${task.description.slice(0, 60)}...`);

    try {
      const output = await this.executor(agent, task, context);
      const duration_ms = Date.now() - startTime;

      this.log(`[Agent: ${agent.role}] Completed in ${duration_ms}ms`);

      return {
        taskId: task.id,
        agentRole: agent.role,
        output,
        success: true,
        duration_ms,
        toolsUsed: task.tools ?? agent.tools,
        metadata: { model: agent.model },
      };
    } catch (err) {
      const duration_ms = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      this.log(`[Agent: ${agent.role}] FAILED: ${error}`);

      return {
        taskId: task.id,
        agentRole: agent.role,
        output: '',
        success: false,
        error,
        duration_ms,
        toolsUsed: task.tools ?? agent.tools,
        metadata: { model: agent.model },
      };
    }
  }

  // ─── Context Builder ───

  private buildContext(task: CrewTask, contextMap: Map<string, string>, existingResults: TaskResult[]): string {
    const parts: string[] = [];

    // Add context from specified task dependencies
    if (task.context) {
      for (const depId of task.context) {
        const depOutput = contextMap.get(depId);
        if (depOutput) {
          parts.push(`[Context from task ${depId}]:\n${depOutput}`);
        }
      }
    }

    // Add shared context from all previous results if enabled
    if (existingResults.length > 0) {
      const shared = existingResults
        .filter(r => r.success && r.taskId !== task.id)
        .map(r => `[${r.agentRole}]: ${r.output.slice(0, 500)}`)
        .join('\n');
      if (shared) {
        parts.push(`[Shared crew context]:\n${shared}`);
      }
    }

    return parts.join('\n\n');
  }

  // ─── Topological Sort for Parallel ───

  private topologicalSort(tasks: CrewTask[]): CrewTask[][] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const task of tasks) {
      inDegree.set(task.id, 0);
      adj.set(task.id, []);
    }

    for (const task of tasks) {
      if (task.context) {
        for (const dep of task.context) {
          if (taskMap.has(dep)) {
            adj.get(dep)!.push(task.id);
            inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
          }
        }
      }
    }

    const levels: CrewTask[][] = [];
    let queue = tasks.filter(t => (inDegree.get(t.id) ?? 0) === 0);

    while (queue.length > 0) {
      levels.push(queue);
      const nextQueue: CrewTask[] = [];

      for (const task of queue) {
        for (const depId of (adj.get(task.id) ?? [])) {
          const newDeg = (inDegree.get(depId) ?? 0) - 1;
          inDegree.set(depId, newDeg);
          if (newDeg === 0) {
            const dep = taskMap.get(depId);
            if (dep) nextQueue.push(dep);
          }
        }
      }

      queue = nextQueue;
    }

    return levels;
  }

  private log(msg: string): void {
    if (this.verbose) {
      console.log(msg);
    }
  }
}
