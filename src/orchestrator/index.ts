// ─── Multi-Agent Orchestration ───
// Enables agent-to-agent communication and task delegation.
// A coordinator agent can spawn specialist agents and route subtasks.

import { v4 as uuid } from 'uuid';
import { AgentSession, AgentToAgentMessage } from '../core/types';

export interface AgentSpec {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  handler: (message: string) => Promise<unknown>;
}

export interface OrchestrationResult {
  success: boolean;
  agent_id: string;
  agent_name: string;
  response: unknown;
  duration_ms: number;
}

export interface TaskDelegation {
  task_id: string;
  from_agent: string;
  to_agent: string;
  message: string;
  result?: OrchestrationResult;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
}

export class AgentOrchestrator {
  private agents = new Map<string, AgentSpec>();
  private sessions = new Map<string, AgentSession>();
  private messageLog: AgentToAgentMessage[] = [];
  private delegations: TaskDelegation[] = [];
  private maxDelegationDepth = 3;
  private maxLogSize = 1000;

  // ─── Register a specialist agent ───
  registerAgent(spec: AgentSpec): void {
    this.agents.set(spec.id, spec);
    this.sessions.set(spec.id, {
      agent_id: spec.id,
      session_id: uuid(),
      name: spec.name,
      status: 'idle',
      created_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      message_count: 0,
    });
  }

  // ─── Unregister an agent ───
  unregisterAgent(agentId: string): boolean {
    this.sessions.delete(agentId);
    return this.agents.delete(agentId);
  }

  // ─── Find the best agent for a task ───
  findAgent(intent: string): AgentSpec | null {
    const lower = intent.toLowerCase();
    let best: AgentSpec | null = null;
    let bestScore = 0;

    for (const agent of this.agents.values()) {
      let score = 0;
      for (const cap of agent.capabilities) {
        if (lower.includes(cap.toLowerCase())) score += 2;
      }
      // Check description
      const descWords = agent.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length > 3 && lower.includes(word)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = agent;
      }
    }

    return bestScore > 0 ? best : null;
  }

  // ─── Delegate a task to a specific agent ───
  async delegate(fromAgentId: string, toAgentId: string, message: string): Promise<OrchestrationResult> {
    const agent = this.agents.get(toAgentId);
    if (!agent) throw new Error(`Agent ${toAgentId} not found`);

    const delegation: TaskDelegation = {
      task_id: uuid(),
      from_agent: fromAgentId,
      to_agent: toAgentId,
      message,
      status: 'running',
      created_at: new Date().toISOString(),
    };
    this.delegations.push(delegation);

    // Update session
    const session = this.sessions.get(toAgentId);
    if (session) {
      session.status = 'active';
      session.last_message_at = new Date().toISOString();
      session.message_count++;
    }

    // Log message
    this.messageLog.push({
      from_agent: fromAgentId,
      to_agent: toAgentId,
      message,
      timestamp: new Date().toISOString(),
    });
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog.splice(0, this.messageLog.length - this.maxLogSize);
    }

    const start = Date.now();
    try {
      const response = await agent.handler(message);

      const result: OrchestrationResult = {
        success: true,
        agent_id: toAgentId,
        agent_name: agent.name,
        response,
        duration_ms: Date.now() - start,
      };

      delegation.result = result;
      delegation.status = 'completed';

      // Log response
      this.messageLog.push({
        from_agent: toAgentId,
        to_agent: fromAgentId,
        message: typeof response === 'string' ? response : JSON.stringify(response),
        reply_to: delegation.task_id,
        timestamp: new Date().toISOString(),
      });

      if (session) session.status = 'idle';
      return result;
    } catch (err) {
      delegation.status = 'failed';
      if (session) session.status = 'idle';

      return {
        success: false,
        agent_id: toAgentId,
        agent_name: agent.name,
        response: `Error: ${(err as Error).message}`,
        duration_ms: Date.now() - start,
      };
    }
  }

  // ─── Auto-route: find best agent and delegate ───
  async route(fromAgentId: string, intent: string): Promise<OrchestrationResult> {
    const agent = this.findAgent(intent);
    if (!agent) {
      return {
        success: false,
        agent_id: 'none',
        agent_name: 'none',
        response: 'No specialist agent found for this task.',
        duration_ms: 0,
      };
    }
    return this.delegate(fromAgentId, agent.id, intent);
  }

  // ─── Multi-step orchestration: break task into sub-tasks ───
  async orchestrate(coordinatorId: string, subtasks: { agentId: string; message: string }[]): Promise<OrchestrationResult[]> {
    if (subtasks.length > this.maxDelegationDepth * 3) {
      throw new Error('Too many subtasks. Maximum delegation chain exceeded.');
    }

    const results: OrchestrationResult[] = [];
    for (const task of subtasks) {
      const result = await this.delegate(coordinatorId, task.agentId, task.message);
      results.push(result);
      // If a subtask fails, stop the chain
      if (!result.success) break;
    }
    return results;
  }

  // ─── List all registered agents ───
  listAgents(): AgentSpec[] {
    return Array.from(this.agents.values());
  }

  // ─── Get agent sessions ───
  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  // ─── Get message history ───
  getMessageLog(limit: number = 50): AgentToAgentMessage[] {
    return this.messageLog.slice(-limit);
  }

  // ─── Get delegation history ───
  getDelegations(limit: number = 50): TaskDelegation[] {
    return this.delegations.slice(-limit);
  }
}
