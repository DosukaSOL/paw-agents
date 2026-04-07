// ─── PAW Daemon: Always-On Background Service ───
// Runs PAW as a persistent 24/7 agent. The backbone of Free mode.
// Manages system tray, schedulers, watchers, voice, and all channels.

import { EventEmitter } from 'events';
import { PawAgent } from '../agent/loop';
import { VoiceAgent } from '../voice/voice-agent';
import { DaemonScheduler } from './scheduler';
import { SystemWatcher } from './watcher';
import { NotificationManager } from './notifications';
import { ScreenContextEngine, screenContext } from './screen-context';
import { config } from '../core/config';

export type DaemonState = 'starting' | 'running' | 'paused' | 'stopping' | 'stopped';

export interface DaemonStatus {
  state: DaemonState;
  uptime_ms: number;
  started_at: string | null;
  agent_mode: string;
  voice_active: boolean;
  active_watchers: number;
  scheduled_tasks: number;
  memory_mb: number;
  cpu_percent: number;
}

export interface DaemonEvent {
  type: 'voice' | 'webhook' | 'schedule' | 'channel' | 'file-change' | 'clipboard' | 'screen' | 'system';
  source: string;
  data: unknown;
  timestamp: string;
}

export class PawDaemon extends EventEmitter {
  private state: DaemonState = 'stopped';
  private agent: PawAgent | null = null;
  private voiceAgent: VoiceAgent | null = null;
  private scheduler: DaemonScheduler;
  private watcher: SystemWatcher;
  private notifications: NotificationManager;
  private startedAt: Date | null = null;
  private eventLog: DaemonEvent[] = [];
  private maxEventLog = 1000;
  private screenChangeHandler: ((window: { app: string; title: string; url?: string }) => void) | null = null;

  constructor() {
    super();
    this.scheduler = new DaemonScheduler();
    this.watcher = new SystemWatcher();
    this.notifications = new NotificationManager();
  }

  // ─── Start the daemon ───
  async start(agent: PawAgent): Promise<void> {
    if (this.state === 'running') {
      console.log('[Daemon] Already running');
      return;
    }

    this.state = 'starting';
    this.agent = agent;
    this.startedAt = new Date();
    this.emit('state-change', 'starting');

    console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║   🐾  PAW DAEMON — Always-On Mode                ║
  ║   Running 24/7 as your personal AI assistant      ║
  ╚═══════════════════════════════════════════════════╝
    `);

    // Initialize voice if enabled
    if (config.voice?.enabled) {
      this.voiceAgent = new VoiceAgent(agent);
      if (config.voice.continuousListening) {
        this.voiceAgent.startListening();
      }
      console.log('[Daemon] 🎤 Voice agent active');
    }

    // Start scheduler
    this.scheduler.onTask(async (taskName, action) => {
      this.logEvent('schedule', taskName, { action });
      if (this.agent) {
        const response = await this.agent.process(`daemon:scheduler`, action);
        if (config.daemon?.notificationsEnabled) {
          this.notifications.send('Scheduled Task', `${taskName}: ${response.message.substring(0, 100)}`);
        }
      }
    });
    await this.scheduler.start();

    // Start watchers if enabled
    if (config.daemon?.watchPaths?.length) {
      for (const watchPath of config.daemon.watchPaths) {
        this.watcher.watchPath(watchPath, async (event, filePath) => {
          this.logEvent('file-change', filePath, { event });
          if (this.agent) {
            await this.agent.process('daemon:watcher', `File ${event}: ${filePath}`);
          }
        });
      }
      console.log(`[Daemon] 👁️ Watching ${config.daemon.watchPaths.length} path(s)`);
    }

    // Start clipboard monitor if enabled
    if (config.daemon?.clipboardMonitor) {
      this.watcher.startClipboardMonitor(async (content, type) => {
        this.logEvent('clipboard', 'clipboard', { content_type: type, preview: content.substring(0, 100) });
        if (this.agent) {
          await this.agent.process('daemon:clipboard', `Clipboard ${type}: ${content}`);
        }
      });
      console.log('[Daemon] 📋 Clipboard monitor active');
    }

    // Start screen context monitoring if enabled
    if (config.daemon?.screenContext) {
      screenContext.start(3000);
      this.screenChangeHandler = (window) => {
        this.logEvent('screen', window.app, { title: window.title, url: window.url });
      };
      screenContext.on('window-change', this.screenChangeHandler);
      console.log('[Daemon] 🖥️ Screen context active');
    }

    this.state = 'running';
    this.emit('state-change', 'running');
    console.log('[Daemon] ✅ Daemon is now running');

    if (config.daemon?.notificationsEnabled) {
      this.notifications.send('PAW Daemon', 'Your AI assistant is now running in the background.');
    }
  }

  // ─── Stop the daemon ───
  async stop(): Promise<void> {
    if (this.state === 'stopped') return;

    this.state = 'stopping';
    this.emit('state-change', 'stopping');

    // Stop voice
    if (this.voiceAgent) {
      this.voiceAgent.stopListening();
    }

    // Stop scheduler
    this.scheduler.stop();

    // Stop watchers
    this.watcher.stopAll();

    // Stop screen context
    if (this.screenChangeHandler) {
      screenContext.removeListener('window-change', this.screenChangeHandler);
      this.screenChangeHandler = null;
    }
    screenContext.stop();

    this.state = 'stopped';
    this.startedAt = null;
    this.emit('state-change', 'stopped');
    console.log('[Daemon] 🛑 Daemon stopped');
  }

  // ─── Pause (keep alive but stop processing) ───
  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    if (this.voiceAgent) this.voiceAgent.stopListening();
    this.emit('state-change', 'paused');
    console.log('[Daemon] ⏸️ Daemon paused');
  }

  // ─── Resume from pause ───
  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    if (this.voiceAgent && config.voice?.continuousListening) {
      this.voiceAgent.startListening();
    }
    this.emit('state-change', 'running');
    console.log('[Daemon] ▶️ Daemon resumed');
  }

  // ─── Get daemon status ───
  getStatus(): DaemonStatus {
    const mem = process.memoryUsage();
    return {
      state: this.state,
      uptime_ms: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      started_at: this.startedAt?.toISOString() ?? null,
      agent_mode: config.agent.mode,
      voice_active: this.voiceAgent ? this.voiceAgent.getState() !== 'idle' : false,
      active_watchers: this.watcher.getWatchCount(),
      scheduled_tasks: this.scheduler.getTaskCount(),
      memory_mb: Math.round(mem.heapUsed / 1024 / 1024),
      cpu_percent: 0, // Would require os-level monitoring
    };
  }

  // ─── Process a wake event (voice, webhook, etc.) ───
  async wake(event: DaemonEvent): Promise<void> {
    this.logEvent(event.type, event.source, event.data);

    if (this.state === 'paused') {
      this.resume();
    }

    if (this.agent && this.state === 'running') {
      const message = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
      await this.agent.process(`daemon:${event.type}`, message);
    }
  }

  // ─── Get voice agent (if active) ───
  getVoiceAgent(): VoiceAgent | null {
    return this.voiceAgent;
  }

  // ─── Get notification manager ───
  getNotifications(): NotificationManager {
    return this.notifications;
  }

  // ─── Get recent events ───
  getRecentEvents(limit: number = 50): DaemonEvent[] {
    return this.eventLog.slice(-limit);
  }

  // ─── Log an event ───
  private logEvent(type: DaemonEvent['type'], source: string, data: unknown): void {
    const event: DaemonEvent = {
      type,
      source,
      data,
      timestamp: new Date().toISOString(),
    };
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEventLog) {
      this.eventLog = this.eventLog.slice(-this.maxEventLog);
    }
    this.emit('event', event);
  }
}

// Singleton daemon instance
export const pawDaemon = new PawDaemon();
