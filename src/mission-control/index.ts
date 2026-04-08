// ─── PAW Mission Control — Real-Time Agent Monitoring & Management ───
// Central nerve center for monitoring agents, tasks, metrics, alerts, and logs.

import { config } from '../core/config';
import {
  MissionControlState,
  AgentStatus,
  TaskQueueItem,
  SystemMetrics,
  Alert,
  LogEntry,
  ChannelType,
} from '../core/types';
import { v4 as uuid } from 'uuid';

export class MissionControl {
  private agents = new Map<string, AgentStatus>();
  private taskQueue: TaskQueueItem[] = [];
  private alerts: Alert[] = [];
  private logs: LogEntry[] = [];
  private metricsHistory: SystemMetrics[] = [];
  private messageCount = 0;
  private totalResponseTime = 0;
  private responseCount = 0;
  private tasksTodayCount = 0;
  private errorsTodayCount = 0;
  private modelCallsToday = new Map<string, number>();
  private startTime = Date.now();
  private listeners = new Set<(state: MissionControlState) => void>();

  // ─── State Snapshot ───

  getState(): MissionControlState {
    return {
      agents: Array.from(this.agents.values()),
      tasks: this.taskQueue.slice(-200),
      metrics: this.getCurrentMetrics(),
      alerts: this.alerts.slice(-100),
      logs: this.logs.slice(-500),
    };
  }

  // ─── Agent Management ───

  registerAgent(agentId: string, name: string, provider: string): void {
    this.agents.set(agentId, {
      agent_id: agentId,
      name,
      status: 'idle',
      uptime_ms: 0,
      tasks_completed: 0,
      tasks_failed: 0,
      model_provider: provider,
      memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      last_activity: new Date().toISOString(),
    });
    this.broadcast();
  }

  updateAgentStatus(agentId: string, status: AgentStatus['status'], currentTask?: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.current_task = currentTask;
      agent.last_activity = new Date().toISOString();
      agent.uptime_ms = Date.now() - this.startTime;
      agent.memory_usage_mb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      this.broadcast();
    }
  }

  recordAgentTaskComplete(agentId: string, success: boolean): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      if (success) {
        agent.tasks_completed++;
      } else {
        agent.tasks_failed++;
      }
      agent.status = 'idle';
      agent.current_task = undefined;
      this.broadcast();
    }
  }

  // ─── Task Queue ───

  enqueueTask(type: string, payload: unknown, sourceChannel: ChannelType, priority: TaskQueueItem['priority'] = 'normal'): string {
    const id = uuid();
    const task: TaskQueueItem = {
      id,
      type,
      priority,
      status: 'queued',
      source_channel: sourceChannel,
      created_at: new Date().toISOString(),
      payload,
    };
    this.taskQueue.push(task);
    // Prune old tasks to prevent unbounded memory growth
    if (this.taskQueue.length > 500) {
      this.taskQueue = this.taskQueue.slice(-500);
    }
    this.tasksTodayCount++;
    this.broadcast();
    return id;
  }

  updateTaskStatus(taskId: string, status: TaskQueueItem['status'], result?: unknown, error?: string): void {
    const task = this.taskQueue.find(t => t.id === taskId);
    if (task) {
      task.status = status;
      if (status === 'processing') task.started_at = new Date().toISOString();
      if (status === 'completed' || status === 'failed') {
        task.completed_at = new Date().toISOString();
        if (result !== undefined) task.result = result;
        if (error) task.error = error;
        if (status === 'failed') this.errorsTodayCount++;
      }
      this.broadcast();
    }
  }

  // ─── Metrics ───

  recordMessage(): void {
    this.messageCount++;
  }

  recordResponseTime(ms: number): void {
    this.totalResponseTime += ms;
    this.responseCount++;
  }

  recordModelCall(provider: string): void {
    this.modelCallsToday.set(provider, (this.modelCallsToday.get(provider) ?? 0) + 1);
  }

  getCurrentMetrics(): SystemMetrics {
    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const uptimeMinutes = Math.max(uptimeSeconds / 60, 1);

    return {
      cpu_usage_pct: 0, // Would require os module, simplified
      memory_usage_mb: Math.round(mem.heapUsed / 1024 / 1024),
      memory_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      active_connections: this.agents.size,
      messages_per_minute: Math.round(this.messageCount / uptimeMinutes * 10) / 10,
      avg_response_time_ms: this.responseCount > 0 ? Math.round(this.totalResponseTime / this.responseCount) : 0,
      uptime_seconds: uptimeSeconds,
      total_tasks_today: this.tasksTodayCount,
      error_rate_pct: this.tasksTodayCount > 0 ? Math.round((this.errorsTodayCount / this.tasksTodayCount) * 10000) / 100 : 0,
      model_calls_today: Object.fromEntries(this.modelCallsToday),
    };
  }

  // ─── Alerts ───

  addAlert(severity: Alert['severity'], title: string, message: string, source: string): string {
    const id = uuid();
    this.alerts.push({
      id,
      severity,
      title,
      message,
      source,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      resolved: false,
    });

    // Cap alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-500);
    }

    this.broadcast();
    return id;
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.broadcast();
    }
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      this.broadcast();
    }
  }

  // ─── Logging ───

  log(level: LogEntry['level'], source: string, message: string, metadata?: Record<string, unknown>): void {
    this.logs.push({
      id: uuid(),
      level,
      source,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    });

    // Cap logs  
    if (this.logs.length > 5000) {
      this.logs = this.logs.slice(-2500);
    }

    // Auto-alert on errors
    if (level === 'error') {
      this.addAlert('error', `Error in ${source}`, message, source);
    }
  }

  // ─── Real-Time Broadcast ───

  onStateChange(listener: (state: MissionControlState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // Ignore listener errors
      }
    }
  }

  // ─── Cleanup ───

  resetDailyCounters(): void {
    this.tasksTodayCount = 0;
    this.errorsTodayCount = 0;
    this.modelCallsToday.clear();
    this.messageCount = 0;
    this.totalResponseTime = 0;
    this.responseCount = 0;
  }
}

// Singleton
export const missionControl = new MissionControl();
