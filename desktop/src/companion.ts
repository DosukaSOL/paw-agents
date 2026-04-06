// ─── Pawl — PAW Desktop Companion ───
// A cute purple dog mascot that lives on your desktop.
// Renders as an always-on-top transparent overlay with animations,
// click interactions, notification bubbles, and sounds.

import { BrowserWindow, screen, ipcMain, Notification } from 'electron';
import * as path from 'path';

export interface PawlConfig {
  enabled: boolean;
  sounds: boolean;
  idleAnimations: boolean;
  walkAround: boolean;
  notificationBubbles: boolean;
  sleepWhenIdle: boolean;
  idleTimeoutMs: number;
  size: number; // px
}

export const DEFAULT_PAWL_CONFIG: PawlConfig = {
  enabled: true,
  sounds: true,
  idleAnimations: true,
  walkAround: true,
  notificationBubbles: true,
  sleepWhenIdle: true,
  idleTimeoutMs: 5 * 60 * 1000,
  size: 96,
};

// Sprite frame map — matches pawl-sprites.svg layout (128px per frame)
export const SPRITE_MAP = {
  // Row 0: Idle states
  idle_front:   { x: 0,   y: 0 },
  idle_left:    { x: 128, y: 0 },
  idle_right:   { x: 256, y: 0 },
  sit_front:    { x: 384, y: 0 },
  blink:        { x: 512, y: 0 },

  // Row 1: Emotions
  happy:        { x: 0,   y: 128 },
  excited:      { x: 128, y: 128 },
  mad:          { x: 256, y: 128 },
  sad:          { x: 384, y: 128 },
  confused:     { x: 512, y: 128 },

  // Row 2: Actions
  bark:         { x: 0,   y: 256 },
  alert:        { x: 128, y: 256 },
  success:      { x: 256, y: 256 },
  error:        { x: 384, y: 256 },
  thinking:     { x: 512, y: 256 },

  // Row 3: Movement
  walk_left_1:  { x: 0,   y: 384 },
  walk_left_2:  { x: 128, y: 384 },
  walk_right_1: { x: 256, y: 384 },
  walk_right_2: { x: 384, y: 384 },
  jump:         { x: 512, y: 384 },

  // Row 4: Special
  sleep:        { x: 0,   y: 512 },
  wag_1:        { x: 128, y: 512 },
  wag_2:        { x: 256, y: 512 },
  notification: { x: 384, y: 512 },
  love:         { x: 512, y: 512 },
} as const;

export type SpriteFrame = keyof typeof SPRITE_MAP;

// Emotion pool for RNG click reactions
const CLICK_EMOTIONS: SpriteFrame[] = [
  'happy', 'excited', 'mad', 'sad', 'confused', 'love', 'bark',
];

export class PawlCompanion {
  private window: BrowserWindow | null = null;
  private config: PawlConfig;
  private currentFrame: SpriteFrame = 'idle_front';
  private isAsleep = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private animationInterval: ReturnType<typeof setInterval> | null = null;
  private walkInterval: ReturnType<typeof setInterval> | null = null;
  private posX = 0;
  private posY = 0;
  private notificationQueue: Array<{ text: string; type: 'info' | 'success' | 'error' | 'warning' }> = [];

  constructor(config?: Partial<PawlConfig>) {
    this.config = { ...DEFAULT_PAWL_CONFIG, ...config };
  }

  // ─── Lifecycle ───

  async show(): Promise<void> {
    if (this.window) return;

    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const size = this.config.size;

    // Start in bottom-right area
    this.posX = width - size - 60;
    this.posY = height - size - 20;

    this.window = new BrowserWindow({
      width: size + 200, // Extra width for notification bubbles
      height: size + 80,
      x: this.posX - 100,
      y: this.posY - 40,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.window.setIgnoreMouseEvents(false);
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    this.window.loadFile(path.join(__dirname, '..', 'renderer', 'pawl.html'));

    this.window.on('closed', () => {
      this.window = null;
      this.stopAnimations();
    });

    this.setupIPC();
    this.startIdleTimer();
    if (this.config.idleAnimations) this.startIdleAnimations();
    if (this.config.walkAround) this.startWalking();
  }

  hide(): void {
    this.stopAnimations();
    if (this.window) {
      this.window.close();
      this.window = null;
    }
  }

  toggle(): void {
    if (this.window) {
      this.hide();
    } else {
      this.show();
    }
  }

  updateConfig(partial: Partial<PawlConfig>): void {
    this.config = { ...this.config, ...partial };
    this.sendToRenderer('pawl:config', this.config);

    if (!this.config.walkAround && this.walkInterval) {
      clearInterval(this.walkInterval);
      this.walkInterval = null;
    } else if (this.config.walkAround && !this.walkInterval) {
      this.startWalking();
    }

    if (!this.config.idleAnimations && this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    } else if (this.config.idleAnimations && !this.animationInterval) {
      this.startIdleAnimations();
    }
  }

  getConfig(): PawlConfig {
    return { ...this.config };
  }

  // ─── Notifications ───

  notify(text: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
    if (!this.config.notificationBubbles || !this.window) return;

    this.notificationQueue.push({ text, type });
    this.processNotificationQueue();
  }

  private async processNotificationQueue(): Promise<void> {
    if (this.notificationQueue.length === 0) return;

    const notif = this.notificationQueue.shift()!;

    // Wake up if sleeping
    if (this.isAsleep) {
      this.wake();
    }

    // Show alert frame
    const frameForType: Record<string, SpriteFrame> = {
      info: 'alert',
      success: 'success',
      error: 'error',
      warning: 'alert',
    };

    this.setFrame(frameForType[notif.type] ?? 'alert');
    this.sendToRenderer('pawl:notification', notif);

    if (this.config.sounds) {
      this.sendToRenderer('pawl:sound', 'bark');
    }

    // System notification too
    if (Notification.isSupported()) {
      new Notification({
        title: `🐾 Pawl`,
        body: notif.text,
        silent: true,
      }).show();
    }

    // Return to idle after 4s
    setTimeout(() => {
      this.setFrame('idle_front');
      // Process next in queue
      if (this.notificationQueue.length > 0) {
        setTimeout(() => this.processNotificationQueue(), 1000);
      }
    }, 4000);
  }

  // ─── Frame management ───

  setFrame(frame: SpriteFrame): void {
    this.currentFrame = frame;
    this.sendToRenderer('pawl:frame', frame);
  }

  // ─── Animations ───

  private startIdleAnimations(): void {
    if (this.animationInterval) return;

    this.animationInterval = setInterval(() => {
      if (this.isAsleep) return;

      const rand = Math.random();
      if (rand < 0.15) {
        // Blink
        this.setFrame('blink');
        setTimeout(() => this.setFrame('idle_front'), 200);
      } else if (rand < 0.25) {
        // Look around
        const dir = Math.random() < 0.5 ? 'idle_left' : 'idle_right';
        this.setFrame(dir);
        setTimeout(() => this.setFrame('idle_front'), 1500);
      } else if (rand < 0.30) {
        // Wag tail
        this.setFrame('wag_1');
        setTimeout(() => this.setFrame('wag_2'), 200);
        setTimeout(() => this.setFrame('wag_1'), 400);
        setTimeout(() => this.setFrame('wag_2'), 600);
        setTimeout(() => this.setFrame('idle_front'), 800);
      }
    }, 3000);
  }

  private startWalking(): void {
    if (this.walkInterval) return;
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const size = this.config.size;

    this.walkInterval = setInterval(() => {
      if (this.isAsleep || !this.window) return;
      if (Math.random() > 0.3) return; // Only walk sometimes

      const direction = Math.random() < 0.5 ? 'left' : 'right';
      const steps = Math.floor(Math.random() * 8) + 3;
      let step = 0;

      const walkStep = setInterval(() => {
        if (step >= steps || !this.window) {
          clearInterval(walkStep);
          this.setFrame('idle_front');
          return;
        }

        // Alternate walk frames
        const frame1: SpriteFrame = direction === 'left' ? 'walk_left_1' : 'walk_right_1';
        const frame2: SpriteFrame = direction === 'left' ? 'walk_left_2' : 'walk_right_2';
        this.setFrame(step % 2 === 0 ? frame1 : frame2);

        const moveBy = direction === 'left' ? -6 : 6;
        this.posX = Math.max(0, Math.min(width - size, this.posX + moveBy));
        this.window?.setBounds({
          x: this.posX - 100,
          y: this.posY - 40,
          width: size + 200,
          height: size + 80,
        });

        step++;
      }, 250);
    }, 8000);
  }

  private startIdleTimer(): void {
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.config.sleepWhenIdle) return;

    this.idleTimer = setTimeout(() => {
      this.sleep();
    }, this.config.idleTimeoutMs);
  }

  private sleep(): void {
    if (this.isAsleep) return;
    this.isAsleep = true;
    this.setFrame('sleep');
  }

  private wake(): void {
    if (!this.isAsleep) return;
    this.isAsleep = false;

    // Jump up excitedly
    this.setFrame('jump');
    setTimeout(() => this.setFrame('excited'), 500);
    setTimeout(() => this.setFrame('idle_front'), 1500);
    this.resetIdleTimer();
  }

  private stopAnimations(): void {
    if (this.animationInterval) { clearInterval(this.animationInterval); this.animationInterval = null; }
    if (this.walkInterval) { clearInterval(this.walkInterval); this.walkInterval = null; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  // ─── IPC ───

  private setupIPC(): void {
    // Click — RNG emotion
    ipcMain.on('pawl:click', () => {
      this.resetIdleTimer();
      if (this.isAsleep) {
        this.wake();
        return;
      }

      const emotion = CLICK_EMOTIONS[Math.floor(Math.random() * CLICK_EMOTIONS.length)];
      this.setFrame(emotion);

      if (this.config.sounds) {
        this.sendToRenderer('pawl:sound', emotion === 'bark' ? 'bark' : 'yip');
      }

      setTimeout(() => this.setFrame('idle_front'), 2000);
    });

    // Double-click — open main app
    ipcMain.on('pawl:doubleclick', () => {
      this.resetIdleTimer();
      // Emit event for main process to handle
      this.sendToRenderer('pawl:open-app', null);
    });

    // Drag support
    ipcMain.on('pawl:drag', (_event, deltaX: number, deltaY: number) => {
      if (!this.window) return;
      const display = screen.getPrimaryDisplay();
      const { width, height } = display.workAreaSize;
      const size = this.config.size;

      this.posX = Math.max(0, Math.min(width - size, this.posX + deltaX));
      this.posY = Math.max(0, Math.min(height - size, this.posY + deltaY));
      this.window.setBounds({
        x: this.posX - 100,
        y: this.posY - 40,
        width: size + 200,
        height: size + 80,
      });
    });
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }
}
