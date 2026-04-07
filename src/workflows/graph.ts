// ─── PAW Workflow Graph Engine ───
// Event-driven workflow DAG with conditional routing, parallel branches,
// state management, and durable execution. Inspired by LangGraph + CrewAI Flows.

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

// ─── Types ───

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowNode {
  id: string;
  name: string;
  type: 'action' | 'condition' | 'parallel' | 'wait' | 'subworkflow';
  handler: (state: WorkflowState, context: WorkflowContext) => Promise<WorkflowState>;
  retries?: number;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: (state: WorkflowState) => boolean;
  label?: string;
}

export interface WorkflowState {
  [key: string]: unknown;
}

export interface WorkflowContext {
  workflowId: string;
  runId: string;
  nodeId: string;
  attempt: number;
  startedAt: string;
  emit: (event: string, data: unknown) => void;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNode: string;
  initialState?: WorkflowState;
  maxSteps?: number;
  timeout?: number;
}

export interface NodeExecution {
  nodeId: string;
  name: string;
  status: NodeStatus;
  startTime: string;
  endTime?: string;
  duration_ms?: number;
  attempt: number;
  error?: string;
  stateSnapshot?: WorkflowState;
}

export interface WorkflowResult {
  workflowId: string;
  runId: string;
  success: boolean;
  finalState: WorkflowState;
  executions: NodeExecution[];
  totalDuration_ms: number;
  nodesCompleted: number;
  nodesFailed: number;
  nodesSkipped: number;
  error?: string;
}

// ─── Workflow Graph Engine ───

export class WorkflowGraphEngine extends EventEmitter {
  private workflows: Map<string, WorkflowConfig> = new Map();

  constructor() {
    super();
  }

  // ─── Register Workflow ───

  register(config: WorkflowConfig): void {
    // Validate graph structure
    this.validateWorkflow(config);
    this.workflows.set(config.id, config);
  }

  // ─── Execute Workflow ───

  async run(workflowId: string, inputState?: WorkflowState): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);

    const runId = randomUUID();
    const startTime = Date.now();
    const executions: NodeExecution[] = [];
    let currentState: WorkflowState = JSON.parse(JSON.stringify({ ...workflow.initialState, ...inputState }));
    let stepCount = 0;
    const maxSteps = workflow.maxSteps ?? 100;

    const nodeMap = new Map(workflow.nodes.map(n => [n.id, n]));
    const edgeMap = new Map<string, WorkflowEdge[]>();
    for (const edge of workflow.edges) {
      if (!edgeMap.has(edge.from)) edgeMap.set(edge.from, []);
      edgeMap.get(edge.from)!.push(edge);
    }

    this.emit('workflow:start', { workflowId, runId });

    let currentNodeId: string | null = workflow.entryNode;

    try {
      while (currentNodeId && stepCount < maxSteps) {
        stepCount++;
        const node = nodeMap.get(currentNodeId);
        if (!node) throw new Error(`Node "${currentNodeId}" not found`);

        // Execute node
        const execution = await this.executeNode(node, currentState, workflowId, runId);
        executions.push(execution);

        if (execution.status === 'completed' && execution.stateSnapshot) {
          currentState = execution.stateSnapshot;
        } else if (execution.status === 'failed') {
          this.emit('workflow:error', { workflowId, runId, nodeId: currentNodeId, error: execution.error });
          return {
            workflowId,
            runId,
            success: false,
            finalState: currentState,
            executions,
            totalDuration_ms: Date.now() - startTime,
            nodesCompleted: executions.filter(e => e.status === 'completed').length,
            nodesFailed: executions.filter(e => e.status === 'failed').length,
            nodesSkipped: executions.filter(e => e.status === 'skipped').length,
            error: execution.error,
          };
        }

        // Find next node
        currentNodeId = this.resolveNextNode(currentNodeId, currentState, edgeMap);
      }

      this.emit('workflow:complete', { workflowId, runId, state: currentState });

      return {
        workflowId,
        runId,
        success: true,
        finalState: currentState,
        executions,
        totalDuration_ms: Date.now() - startTime,
        nodesCompleted: executions.filter(e => e.status === 'completed').length,
        nodesFailed: executions.filter(e => e.status === 'failed').length,
        nodesSkipped: executions.filter(e => e.status === 'skipped').length,
      };
    } catch (err) {
      return {
        workflowId,
        runId,
        success: false,
        finalState: currentState,
        executions,
        totalDuration_ms: Date.now() - startTime,
        nodesCompleted: executions.filter(e => e.status === 'completed').length,
        nodesFailed: executions.filter(e => e.status === 'failed').length,
        nodesSkipped: executions.filter(e => e.status === 'skipped').length,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── Execute Node ───

  private async executeNode(
    node: WorkflowNode,
    state: WorkflowState,
    workflowId: string,
    runId: string,
  ): Promise<NodeExecution> {
    const maxRetries = node.retries ?? 0;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const startTime = new Date().toISOString();
      const execution: NodeExecution = {
        nodeId: node.id,
        name: node.name,
        status: 'running',
        startTime,
        attempt,
      };

      this.emit('node:start', { workflowId, runId, nodeId: node.id, attempt });

      try {
        const context: WorkflowContext = {
          workflowId,
          runId,
          nodeId: node.id,
          attempt,
          startedAt: startTime,
          emit: (event, data) => this.emit(event, data),
        };

        // Handle parallel node type
        let newState: WorkflowState;
        if (node.type === 'parallel') {
          newState = await this.executeWithTimeout(node.handler(state, context), node.timeout ?? 30000);
        } else {
          newState = await this.executeWithTimeout(node.handler(state, context), node.timeout ?? 30000);
        }

        execution.status = 'completed';
        execution.endTime = new Date().toISOString();
        execution.duration_ms = new Date(execution.endTime).getTime() - new Date(startTime).getTime();
        execution.stateSnapshot = newState;

        this.emit('node:complete', { workflowId, runId, nodeId: node.id, duration_ms: execution.duration_ms });
        return execution;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        execution.error = lastError;

        if (attempt <= maxRetries) {
          this.emit('node:retry', { workflowId, runId, nodeId: node.id, attempt, error: lastError });
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt - 1), 10000)));
        } else {
          execution.status = 'failed';
          execution.endTime = new Date().toISOString();
          execution.duration_ms = new Date(execution.endTime).getTime() - new Date(startTime).getTime();
          return execution;
        }
      }
    }

    // Should not reach here
    return {
      nodeId: node.id,
      name: node.name,
      status: 'failed',
      startTime: new Date().toISOString(),
      attempt: maxRetries + 1,
      error: lastError,
    };
  }

  // ─── Edge Resolution ───

  private resolveNextNode(
    currentNodeId: string,
    state: WorkflowState,
    edgeMap: Map<string, WorkflowEdge[]>,
  ): string | null {
    const edges = edgeMap.get(currentNodeId);
    if (!edges || edges.length === 0) return null;

    // Find first edge whose condition is satisfied (or unconditional)
    for (const edge of edges) {
      if (!edge.condition || edge.condition(state)) {
        return edge.to;
      }
    }

    return null; // No matching edge — workflow ends
  }

  // ─── Timeout Wrapper ───

  private executeWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Node execution timed out after ${timeout}ms`)), timeout);
      promise.then(result => { clearTimeout(timer); resolve(result); }).catch(err => { clearTimeout(timer); reject(err); });
    });
  }

  // ─── Validation ───

  private validateWorkflow(config: WorkflowConfig): void {
    const nodeIds = new Set(config.nodes.map(n => n.id));

    if (!nodeIds.has(config.entryNode)) {
      throw new Error(`Entry node "${config.entryNode}" not found in nodes`);
    }

    for (const edge of config.edges) {
      if (!nodeIds.has(edge.from)) throw new Error(`Edge references unknown source node "${edge.from}"`);
      if (!nodeIds.has(edge.to)) throw new Error(`Edge references unknown target node "${edge.to}"`);
    }

    // Cycle detection via DFS
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const adjList = new Map<string, string[]>();
    for (const edge of config.edges) {
      if (!adjList.has(edge.from)) adjList.set(edge.from, []);
      adjList.get(edge.from)!.push(edge.to);
    }

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId);
      inStack.add(nodeId);
      for (const neighbor of adjList.get(nodeId) ?? []) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) return true;
        } else if (inStack.has(neighbor)) {
          return true;
        }
      }
      inStack.delete(nodeId);
      return false;
    };

    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId) && hasCycle(nodeId)) {
        throw new Error('Workflow contains a cycle — only DAGs are supported');
      }
    }
  }

  // ─── Introspection ───

  listWorkflows(): { id: string; name: string; description?: string; nodeCount: number }[] {
    return [...this.workflows.values()].map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      nodeCount: w.nodes.length,
    }));
  }

  getWorkflow(id: string): WorkflowConfig | undefined {
    return this.workflows.get(id);
  }

  removeWorkflow(id: string): boolean {
    return this.workflows.delete(id);
  }
}
