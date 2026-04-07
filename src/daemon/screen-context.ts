// ─── PAW Screen & App Context Awareness ───
// Detects active window, captures screen context, and provides ambient awareness.
// Cross-platform: macOS (Accessibility/AppleScript), Linux (xdotool), Windows (PowerShell).

import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { platform } from 'os';

export interface ActiveWindow {
  title: string;
  app: string;
  pid: number;
  url?: string;  // Browser URL if applicable
  timestamp: string;
}

export interface ScreenContext {
  activeWindow: ActiveWindow;
  recentWindows: ActiveWindow[];
  workingContext: string;  // AI-summarized context
}

export class ScreenContextEngine extends EventEmitter {
  private currentWindow: ActiveWindow | null = null;
  private windowHistory: ActiveWindow[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private maxHistory = 50;
  private os = platform();

  // ─── Start monitoring ───
  start(intervalMs = 3000): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.poll(), intervalMs);
    this.pollInterval.unref();
    this.poll();
  }

  // ─── Stop monitoring ───
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // ─── Get current context ───
  getContext(): ScreenContext {
    return {
      activeWindow: this.currentWindow ?? { title: '', app: '', pid: 0, timestamp: new Date().toISOString() },
      recentWindows: this.windowHistory.slice(-10),
      workingContext: this.summarizeContext(),
    };
  }

  // ─── Get active window info ───
  getActiveWindow(): ActiveWindow | null {
    return this.currentWindow;
  }

  // ─── Poll for active window ───
  private poll(): void {
    try {
      const window = this.detectActiveWindow();
      if (!window) return;

      // Only record if window actually changed
      if (this.currentWindow?.title !== window.title || this.currentWindow?.app !== window.app) {
        this.currentWindow = window;
        this.windowHistory.push(window);
        if (this.windowHistory.length > this.maxHistory) {
          this.windowHistory.shift();
        }
        this.emit('window-change', window);
      }
    } catch {
      // Silently skip failed polls
    }
  }

  // ─── Detect active window (cross-platform) ───
  private detectActiveWindow(): ActiveWindow | null {
    try {
      switch (this.os) {
        case 'darwin': return this.detectMacOS();
        case 'linux': return this.detectLinux();
        case 'win32': return this.detectWindows();
        default: return null;
      }
    } catch {
      return null;
    }
  }

  // ─── macOS detection via AppleScript ───
  private detectMacOS(): ActiveWindow | null {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set windowTitle to ""
        try
          set windowTitle to name of front window of frontApp
        end try
        set appPID to unix id of frontApp
        return appName & "|||" & windowTitle & "|||" & appPID
      end tell
    `;

    const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 2000,
      encoding: 'utf-8',
    }).trim();

    const [app, title, pidStr] = result.split('|||');
    if (!app) return null;

    const window: ActiveWindow = {
      title: title ?? '',
      app,
      pid: parseInt(pidStr ?? '0', 10),
      timestamp: new Date().toISOString(),
    };

    // Try to get URL if it's a browser
    if (['Safari', 'Google Chrome', 'Firefox', 'Arc', 'Brave Browser', 'Microsoft Edge'].includes(app)) {
      window.url = this.getBrowserURL(app);
    }

    return window;
  }

  // ─── Get active browser URL on macOS ───
  private getBrowserURL(browser: string): string | undefined {
    try {
      let script: string;
      switch (browser) {
        case 'Safari':
          script = 'tell application "Safari" to return URL of front document';
          break;
        case 'Google Chrome':
        case 'Brave Browser':
        case 'Microsoft Edge':
          script = `tell application "${browser}" to return URL of active tab of front window`;
          break;
        case 'Arc':
          script = 'tell application "Arc" to return URL of active tab of front window';
          break;
        default:
          return undefined;
      }

      return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        timeout: 1000,
        encoding: 'utf-8',
      }).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  // ─── Linux detection via xdotool ───
  private detectLinux(): ActiveWindow | null {
    try {
      const windowId = execSync('xdotool getactivewindow', { timeout: 1000, encoding: 'utf-8' }).trim();
      const title = execSync(`xdotool getactivewindow getwindowname`, { timeout: 1000, encoding: 'utf-8' }).trim();
      const pid = parseInt(execSync(`xdotool getactivewindow getwindowpid`, { timeout: 1000, encoding: 'utf-8' }).trim(), 10);

      // Get app name from PID
      let app = '';
      try {
        app = execSync(`ps -p ${pid} -o comm=`, { timeout: 1000, encoding: 'utf-8' }).trim();
      } catch {
        app = 'unknown';
      }

      return { title, app, pid, timestamp: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  // ─── Windows detection via PowerShell ───
  private detectWindows(): ActiveWindow | null {
    try {
      const script = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
            [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          }
"@
        $hwnd = [Win32]::GetForegroundWindow()
        $sb = New-Object System.Text.StringBuilder 256
        [Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null
        $pid = 0
        [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        "$($proc.ProcessName)|||$($sb.ToString())|||$pid"
      `;

      const result = execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
        timeout: 3000,
        encoding: 'utf-8',
      }).trim();

      const [app, title, pidStr] = result.split('|||');
      if (!app) return null;

      return {
        title: title ?? '',
        app,
        pid: parseInt(pidStr ?? '0', 10),
        timestamp: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  // ─── Summarize current working context ───
  private summarizeContext(): string {
    if (!this.currentWindow) return 'No active window detected';

    const w = this.currentWindow;
    const parts: string[] = [];

    parts.push(`Active: ${w.app}`);
    if (w.title) parts.push(`Window: "${w.title}"`);
    if (w.url) parts.push(`URL: ${w.url}`);

    // Detect context type from window info
    const context = this.classifyContext(w);
    if (context) parts.push(`Context: ${context}`);

    // Recent app switches
    const recentApps = [...new Set(this.windowHistory.slice(-5).map(h => h.app))];
    if (recentApps.length > 1) {
      parts.push(`Recent apps: ${recentApps.join(', ')}`);
    }

    return parts.join(' | ');
  }

  // ─── Classify what user is doing based on window info ───
  private classifyContext(window: ActiveWindow): string | null {
    const app = window.app.toLowerCase();
    const title = window.title.toLowerCase();

    // Coding
    if (['code', 'visual studio code', 'cursor', 'vim', 'nvim', 'neovim', 'emacs',
         'sublime_text', 'atom', 'webstorm', 'intellij', 'pycharm', 'xcode',
         'android studio'].some(e => app.includes(e))) {
      return 'coding';
    }

    // Browsing
    if (['safari', 'chrome', 'firefox', 'arc', 'brave', 'edge', 'opera'].some(e => app.includes(e))) {
      if (title.includes('github') || title.includes('gitlab')) return 'code-review';
      if (title.includes('stackoverflow') || title.includes('docs')) return 'research';
      if (title.includes('mail') || title.includes('gmail') || title.includes('outlook')) return 'email';
      if (title.includes('slack') || title.includes('discord') || title.includes('teams')) return 'communication';
      return 'browsing';
    }

    // Terminal
    if (['terminal', 'iterm', 'warp', 'alacritty', 'kitty', 'hyper', 'cmd', 'powershell',
         'windowsterminal'].some(e => app.includes(e))) {
      return 'terminal';
    }

    // Communication
    if (['slack', 'discord', 'teams', 'zoom', 'telegram', 'messages', 'whatsapp',
         'signal'].some(e => app.includes(e))) {
      return 'communication';
    }

    // Design
    if (['figma', 'sketch', 'photoshop', 'illustrator', 'canva', 'affinity',
         'blender'].some(e => app.includes(e))) {
      return 'design';
    }

    // Writing
    if (['pages', 'word', 'notion', 'obsidian', 'bear', 'notes', 'typora',
         'ia writer'].some(e => app.includes(e))) {
      return 'writing';
    }

    return null;
  }

  // ─── Get formatted context for AI prompts ───
  getContextForPrompt(): string {
    const ctx = this.getContext();
    const lines: string[] = ['[Screen Context]'];

    if (ctx.activeWindow.app) {
      lines.push(`App: ${ctx.activeWindow.app}`);
      if (ctx.activeWindow.title) lines.push(`Window: ${ctx.activeWindow.title}`);
      if (ctx.activeWindow.url) lines.push(`URL: ${ctx.activeWindow.url}`);
    }

    if (ctx.workingContext) {
      lines.push(`Activity: ${ctx.workingContext}`);
    }

    return lines.join('\n');
  }
}

export const screenContext = new ScreenContextEngine();
