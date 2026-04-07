// ─── PAW Daemon: Intelligent Scheduler ───
// Cron-based + natural language scheduling for 24/7 agent tasks.
// Extends existing cron engine with smarter scheduling.

import { EventEmitter } from 'events';

export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;         // Cron expression or natural language
  action: string;           // Agent instruction to execute
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  created_at: string;
  created_by: string;
}

type TaskCallback = (taskName: string, action: string) => Promise<void>;

export class DaemonScheduler extends EventEmitter {
  private tasks = new Map<string, ScheduledTask>();
  private timers = new Map<string, NodeJS.Timeout>();
  private callback: TaskCallback | null = null;
  private running = false;

  // ─── Register task callback ───
  onTask(cb: TaskCallback): void {
    this.callback = cb;
  }

  // ─── Start the scheduler ───
  async start(): Promise<void> {
    this.running = true;
    // Re-schedule all enabled tasks
    for (const task of this.tasks.values()) {
      if (task.enabled) this.scheduleTask(task);
    }
    console.log(`[Scheduler] Started with ${this.tasks.size} task(s)`);
  }

  // ─── Stop the scheduler ───
  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  // ─── Add a scheduled task ───
  addTask(task: Omit<ScheduledTask, 'last_run' | 'next_run' | 'run_count' | 'created_at'>): ScheduledTask {
    const full: ScheduledTask = {
      ...task,
      last_run: null,
      next_run: null,
      run_count: 0,
      created_at: new Date().toISOString(),
    };
    this.tasks.set(task.id, full);
    if (this.running && task.enabled) {
      this.scheduleTask(full);
    }
    return full;
  }

  // ─── Remove a task ───
  removeTask(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    return this.tasks.delete(id);
  }

  // ─── Enable/disable a task ───
  setEnabled(id: string, enabled: boolean): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.enabled = enabled;
    if (!enabled) {
      const timer = this.timers.get(id);
      if (timer) clearTimeout(timer);
      this.timers.delete(id);
    } else if (this.running) {
      this.scheduleTask(task);
    }
  }

  // ─── Parse natural language schedule ───
  parseNaturalSchedule(text: string): { intervalMs: number; description: string } | null {
    const lower = text.toLowerCase().trim();

    // "every X minutes/hours"
    const everyMatch = lower.match(/every\s+(\d+)\s+(minute|hour|second|day)s?/);
    if (everyMatch) {
      const num = parseInt(everyMatch[1]);
      const unit = everyMatch[2];
      const multipliers: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };
      return { intervalMs: num * (multipliers[unit] ?? 60000), description: `Every ${num} ${unit}(s)` };
    }

    // "every hour" / "every minute" / "hourly" / "daily"
    if (lower === 'every hour' || lower === 'hourly') return { intervalMs: 3600000, description: 'Every hour' };
    if (lower === 'every minute') return { intervalMs: 60000, description: 'Every minute' };
    if (lower === 'daily' || lower === 'every day') return { intervalMs: 86400000, description: 'Daily' };

    // "in X minutes/hours" (one-shot)
    const inMatch = lower.match(/in\s+(\d+)\s+(minute|hour|second)s?/);
    if (inMatch) {
      const num = parseInt(inMatch[1]);
      const unit = inMatch[2];
      const multipliers: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000 };
      return { intervalMs: num * (multipliers[unit] ?? 60000), description: `In ${num} ${unit}(s)` };
    }

    return null;
  }

  // ─── Schedule from natural language ───
  addNaturalTask(id: string, name: string, scheduleText: string, action: string, createdBy: string = 'daemon'): ScheduledTask | null {
    const parsed = this.parseNaturalSchedule(scheduleText);
    if (!parsed) return null;

    return this.addTask({
      id,
      name,
      schedule: scheduleText,
      action,
      enabled: true,
      created_by: createdBy,
    });
  }

  // ─── Get task count ───
  getTaskCount(): number {
    return this.tasks.size;
  }

  // ─── Get all tasks ───
  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  // ─── Internal: schedule a task's next execution ───
  private scheduleTask(task: ScheduledTask): void {
    const parsed = this.parseNaturalSchedule(task.schedule);
    if (!parsed) return;

    const timer = setTimeout(async () => {
      if (!this.running || !task.enabled) return;

      task.last_run = new Date().toISOString();
      task.run_count++;

      if (this.callback) {
        try {
          await this.callback(task.name, task.action);
        } catch (err) {
          console.error(`[Scheduler] Task "${task.name}" failed:`, (err as Error).message);
        }
      }

      // Re-schedule (recurring)
      if (this.running && task.enabled) {
        this.scheduleTask(task);
      }
    }, parsed.intervalMs);

    // Ensure timer doesn't prevent process exit
    timer.unref();

    this.timers.set(task.id, timer);
    task.next_run = new Date(Date.now() + parsed.intervalMs).toISOString();
  }
}
