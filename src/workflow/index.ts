// ─── DAG Workflow Engine ───
// Directed Acyclic Graph workflow execution.
// Supports: triggers → conditions → actions, parallel branches, error handling.

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'condition' | 'action' | 'transform' | 'wait' | 'parallel';
  name: string;
  config: Record<string, unknown>;
  next?: string[];          // IDs of downstream nodes
  onError?: string;         // ID of error handler node
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  enabled: boolean;
  created_at: string;
  runs: number;
  last_run?: string;
}

export interface WorkflowContext {
  workflowId: string;
  runId: string;
  data: Record<string, unknown>;
  nodeResults: Map<string, unknown>;
  startedAt: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

export type ActionHandler = (config: Record<string, unknown>, ctx: WorkflowContext) => Promise<unknown>;

export class WorkflowEngine {
  private workflows: Map<string, Workflow> = new Map();
  private handlers: Map<string, ActionHandler> = new Map();
  private runHistory: WorkflowContext[] = [];
  private maxHistory = 100;

  // ─── Register action handler ───
  registerHandler(actionType: string, handler: ActionHandler): void {
    this.handlers.set(actionType, handler);
  }

  // ─── Create workflow ───
  createWorkflow(name: string, description: string, nodes: WorkflowNode[]): Workflow {
    // Validate DAG (no cycles)
    this.validateDAG(nodes);

    const workflow: Workflow = {
      id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      description,
      nodes,
      enabled: true,
      created_at: new Date().toISOString(),
      runs: 0,
    };

    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  // ─── Execute workflow ───
  async execute(workflowId: string, triggerData: Record<string, unknown> = {}): Promise<WorkflowContext> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow '${workflowId}' not found`);
    if (!workflow.enabled) throw new Error(`Workflow '${workflowId}' is disabled`);

    const ctx: WorkflowContext = {
      workflowId,
      runId: `run_${Date.now()}`,
      data: { ...triggerData },
      nodeResults: new Map(),
      startedAt: Date.now(),
      status: 'running',
    };

    try {
      // Find entry nodes (triggers or nodes with no incoming edges)
      const incomingEdges = new Set<string>();
      for (const node of workflow.nodes) {
        if (node.next) {
          for (const nxt of node.next) incomingEdges.add(nxt);
        }
      }
      const entryNodes = workflow.nodes.filter(n => !incomingEdges.has(n.id));

      // Execute from entry nodes
      for (const node of entryNodes) {
        await this.executeNode(node, workflow, ctx);
      }

      ctx.status = 'completed';
      workflow.runs++;
      workflow.last_run = new Date().toISOString();
    } catch (error: unknown) {
      ctx.status = 'failed';
      ctx.error = error instanceof Error ? error.message : String(error);
    }

    // Store history
    this.runHistory.push(ctx);
    if (this.runHistory.length > this.maxHistory) {
      this.runHistory.shift();
    }

    return ctx;
  }

  // ─── Execute single node ───
  private async executeNode(node: WorkflowNode, workflow: Workflow, ctx: WorkflowContext): Promise<void> {
    try {
      let result: unknown;

      switch (node.type) {
        case 'trigger':
          result = ctx.data;
          break;

        case 'condition': {
          const field = String(node.config.field ?? '');
          const op = String(node.config.operator ?? 'eq');
          const value = node.config.value;
          const actual = ctx.data[field];

          let conditionMet = false;
          switch (op) {
            case 'eq': conditionMet = actual === value; break;
            case 'neq': conditionMet = actual !== value; break;
            case 'gt': conditionMet = Number(actual) > Number(value); break;
            case 'lt': conditionMet = Number(actual) < Number(value); break;
            case 'contains': conditionMet = String(actual).includes(String(value)); break;
            case 'exists': conditionMet = actual !== undefined && actual !== null; break;
          }

          result = conditionMet;
          if (!conditionMet) return; // Stop this branch
          break;
        }

        case 'transform': {
          const expression = String(node.config.expression ?? '');
          const targetKey = String(node.config.target ?? 'transformed');
          // Simple key mapping transform
          if (expression.includes('->')) {
            const [from, to] = expression.split('->').map(s => s.trim());
            ctx.data[to || targetKey] = ctx.data[from];
          }
          result = ctx.data;
          break;
        }

        case 'wait': {
          const ms = Number(node.config.duration_ms ?? 1000);
          const bounded = Math.min(ms, 30_000); // Max 30s wait
          await new Promise(resolve => setTimeout(resolve, bounded));
          result = { waited: bounded };
          break;
        }

        case 'parallel': {
          const subNodeIds = node.next ?? [];
          const subNodes = subNodeIds
            .map(id => workflow.nodes.find(n => n.id === id))
            .filter((n): n is WorkflowNode => n !== undefined);

          await Promise.all(subNodes.map(n => this.executeNode(n, workflow, ctx)));
          result = { parallel: subNodeIds };
          // Don't continue to next — parallel already processed children
          ctx.nodeResults.set(node.id, result);
          return;
        }

        case 'action': {
          const actionType = String(node.config.action ?? '');
          const handler = this.handlers.get(actionType);
          if (handler) {
            result = await handler(node.config, ctx);
          } else {
            result = { error: `No handler for action type '${actionType}'` };
          }
          break;
        }
      }

      ctx.nodeResults.set(node.id, result);

      // Execute next nodes
      if (node.next) {
        for (const nextId of node.next) {
          const nextNode = workflow.nodes.find(n => n.id === nextId);
          if (nextNode) {
            await this.executeNode(nextNode, workflow, ctx);
          }
        }
      }
    } catch (error: unknown) {
      // Error handling — route to error handler node if defined
      if (node.onError) {
        const errorNode = workflow.nodes.find(n => n.id === node.onError);
        if (errorNode) {
          ctx.data._error = error instanceof Error ? error.message : String(error);
          ctx.data._errorNode = node.id;
          await this.executeNode(errorNode, workflow, ctx);
          return;
        }
      }
      throw error;
    }
  }

  // ─── Validate DAG (no cycles) ───
  private validateDAG(nodes: WorkflowNode[]): void {
    const visited = new Set<string>();
    const stack = new Set<string>();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const dfs = (id: string): void => {
      if (stack.has(id)) throw new Error(`Cycle detected at node '${id}'`);
      if (visited.has(id)) return;

      stack.add(id);
      const node = nodeMap.get(id);
      if (node?.next) {
        for (const nxt of node.next) dfs(nxt);
      }
      stack.delete(id);
      visited.add(id);
    };

    for (const node of nodes) {
      dfs(node.id);
    }
  }

  // ─── List workflows ───
  listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  // ─── Get workflow ───
  getWorkflow(id: string): Workflow | null {
    return this.workflows.get(id) ?? null;
  }

  // ─── Delete workflow ───
  deleteWorkflow(id: string): boolean {
    return this.workflows.delete(id);
  }

  // ─── Toggle workflow ───
  toggleWorkflow(id: string, enabled: boolean): boolean {
    const wf = this.workflows.get(id);
    if (!wf) return false;
    wf.enabled = enabled;
    return true;
  }

  // ─── Get run history ───
  getHistory(workflowId?: string): WorkflowContext[] {
    if (workflowId) {
      return this.runHistory.filter(r => r.workflowId === workflowId);
    }
    return [...this.runHistory];
  }
}
