// ─── PAW Daemon: System Tray Integration ───
// Menu bar (macOS) / system tray (Windows/Linux) for quick access.
// Shows agent status, mode switching, voice toggle, and quick actions.

import { EventEmitter } from 'events';
import { PawDaemon, DaemonStatus } from './index';
import { config } from '../core/config';
import { AgentMode } from '../core/types';

export interface TrayAction {
  label: string;
  action: string;
  shortcut?: string;
  enabled?: boolean;
  separator?: boolean;
}

export class SystemTray extends EventEmitter {
  private daemon: PawDaemon | null = null;
  private trayInstance: unknown = null;
  private menuItems: TrayAction[] = [];

  constructor() {
    super();
    this.buildMenu();
  }

  // ─── Bind to daemon ───
  setDaemon(daemon: PawDaemon): void {
    this.daemon = daemon;
    daemon.on('state-change', () => this.updateMenu());
  }

  // ─── Build the tray menu ───
  private buildMenu(): void {
    this.menuItems = [
      { label: '🐾 PAW Agents', action: 'open-hub', shortcut: 'Cmd+Shift+P' },
      { label: '', action: '', separator: true },
      { label: `Status: Running`, action: 'status' },
      { label: `Mode: ${config.agent.mode}`, action: 'mode' },
      { label: '', action: '', separator: true },
      { label: '🎤 Toggle Voice', action: 'toggle-voice', shortcut: 'Cmd+Shift+V' },
      { label: '⏸️ Pause Agent', action: 'pause', shortcut: 'Cmd+Shift+Space' },
      { label: '', action: '', separator: true },
      { label: 'Switch to Supervised', action: 'mode-supervised' },
      { label: 'Switch to Autonomous', action: 'mode-autonomous' },
      { label: 'Switch to Free', action: 'mode-free' },
      { label: '', action: '', separator: true },
      { label: '📊 Open Dashboard', action: 'open-dashboard' },
      { label: '📋 Recent Events', action: 'recent-events' },
      { label: '', action: '', separator: true },
      { label: '❌ Quit PAW', action: 'quit', shortcut: 'Cmd+Q' },
    ];
  }

  // ─── Update menu based on current state ───
  private updateMenu(): void {
    const status = this.daemon?.getStatus();
    if (!status) return;

    // Update dynamic items
    const stateLabel = status.state === 'paused' ? 'Paused' : 'Running';
    const stateItem = this.menuItems.find(i => i.action === 'status');
    if (stateItem) stateItem.label = `Status: ${stateLabel}`;

    const modeItem = this.menuItems.find(i => i.action === 'mode');
    if (modeItem) modeItem.label = `Mode: ${status.agent_mode}`;

    const pauseItem = this.menuItems.find(i => i.action === 'pause');
    if (pauseItem) {
      pauseItem.label = status.state === 'paused' ? '▶️ Resume Agent' : '⏸️ Pause Agent';
    }

    this.emit('menu-updated', this.menuItems);
  }

  // ─── Handle tray action ───
  async handleAction(action: string): Promise<void> {
    switch (action) {
      case 'open-hub':
        this.emit('open-hub');
        break;
      case 'open-dashboard':
        this.emit('open-dashboard');
        break;
      case 'toggle-voice': {
        const voice = this.daemon?.getVoiceAgent();
        if (voice) {
          if (voice.getState() === 'idle') {
            voice.startListening();
          } else {
            voice.stopListening();
          }
        }
        break;
      }
      case 'pause':
        if (this.daemon) {
          const status = this.daemon.getStatus();
          if (status.state === 'paused') {
            this.daemon.resume();
          } else {
            this.daemon.pause();
          }
        }
        break;
      case 'mode-supervised':
      case 'mode-autonomous':
      case 'mode-free':
        this.emit('mode-change', action.replace('mode-', '') as AgentMode);
        break;
      case 'recent-events':
        this.emit('show-events', this.daemon?.getRecentEvents(10) ?? []);
        break;
      case 'quit':
        this.emit('quit');
        break;
    }
    this.updateMenu();
  }

  // ─── Get current menu items ───
  getMenuItems(): TrayAction[] {
    return this.menuItems;
  }

  // ─── Get formatted tooltip ───
  getTooltip(): string {
    const status = this.daemon?.getStatus();
    if (!status) return 'PAW Agents — Stopped';
    const uptime = Math.floor(status.uptime_ms / 60000);
    return `PAW Agents — ${status.state} | ${status.agent_mode} mode | ${uptime}m uptime | ${status.memory_mb}MB`;
  }
}
