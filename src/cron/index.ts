// ─── Cron & Webhook Engine ───
// Scheduled task execution and webhook trigger handling.

import { CronTask, WebhookConfig } from '../core/types';
import { config } from '../core/config';

export class CronEngine {
  private tasks = new Map<string, CronTask>();
  private timers = new Map<string, NodeJS.Timeout>();
  private taskHandler: ((task: CronTask) => Promise<void>) | null = null;

  // Register a handler that fires when a cron task triggers
  onTask(handler: (task: CronTask) => Promise<void>): void {
    this.taskHandler = handler;
  }

  // Add a new cron task
  addTask(task: CronTask): void {
    if (this.tasks.size >= config.cron.maxTasks) {
      throw new Error(`Max cron tasks (${config.cron.maxTasks}) reached`);
    }

    this.tasks.set(task.id, task);

    if (task.enabled && config.cron.enabled) {
      this.scheduleTask(task);
    }
  }

  // Remove a cron task
  removeTask(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    return this.tasks.delete(id);
  }

  // Enable/disable a task
  toggleTask(id: string, enabled: boolean): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);

    task.enabled = enabled;

    if (enabled) {
      this.scheduleTask(task);
    } else {
      const timer = this.timers.get(id);
      if (timer) {
        clearInterval(timer);
        this.timers.delete(id);
      }
    }
  }

  // List all tasks
  listTasks(): CronTask[] {
    return Array.from(this.tasks.values());
  }

  // Parse a simple cron-like schedule to interval ms
  // Supports: "every Xm", "every Xh", "every Xs", "every Xd"
  private parseSchedule(schedule: string): number {
    const match = schedule.match(/every\s+(\d+)\s*(s|m|h|d)/i);
    if (!match) throw new Error(`Invalid schedule: "${schedule}". Use "every Xm", "every Xh", etc.`);

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    const ms = value * (multipliers[unit] ?? 60_000);
    return Math.max(1000, ms); // Minimum 1 second to prevent DoS
  }

  // Schedule a task using setInterval
  private scheduleTask(task: CronTask): void {
    // Clear any existing timer
    const existing = this.timers.get(task.id);
    if (existing) clearInterval(existing);

    const intervalMs = this.parseSchedule(task.schedule);

    const timer = setInterval(async () => {
      if (!task.enabled) return;

      task.last_run = new Date().toISOString();
      task.next_run = new Date(Date.now() + intervalMs).toISOString();

      if (this.taskHandler) {
        try {
          await this.taskHandler(task);
        } catch (err) {
          console.error(`[Cron] Task ${task.id} failed:`, (err as Error).message);
        }
      }
    }, intervalMs);

    // Don't block process exit
    timer.unref();
    this.timers.set(task.id, timer);

    task.next_run = new Date(Date.now() + intervalMs).toISOString();
    console.log(`[Cron] Scheduled task "${task.name}" (${task.schedule})`);
  }

  // Stop all tasks
  stopAll(): void {
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}

// ─── Webhook Registry ───
export class WebhookRegistry {
  private webhooks = new Map<string, WebhookConfig>();

  register(webhook: WebhookConfig): void {
    this.webhooks.set(webhook.id, webhook);
  }

  unregister(id: string): boolean {
    return this.webhooks.delete(id);
  }

  get(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  getByPath(urlPath: string): WebhookConfig | undefined {
    for (const webhook of this.webhooks.values()) {
      if (webhook.path === urlPath && webhook.enabled) {
        return webhook;
      }
    }
    return undefined;
  }

  listAll(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }
}
