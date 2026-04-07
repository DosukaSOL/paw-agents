// ─── PAW Daemon: System Watcher ───
// Monitors file system changes, clipboard, and system events.
// Triggers agent actions when interesting things happen.

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync } from 'child_process';

export type WatchEvent = 'created' | 'modified' | 'deleted' | 'renamed';
export type ClipboardType = 'text' | 'url' | 'code' | 'image' | 'unknown';

type FileChangeCallback = (event: WatchEvent, filePath: string) => Promise<void>;
type ClipboardCallback = (content: string, type: ClipboardType) => Promise<void>;

interface FileWatcher {
  path: string;
  watcher: fs.FSWatcher;
  callback: FileChangeCallback;
}

export class SystemWatcher extends EventEmitter {
  private fileWatchers: FileWatcher[] = [];
  private clipboardInterval: NodeJS.Timeout | null = null;
  private lastClipboard: string = '';

  // ─── Watch a file or directory for changes ───
  watchPath(watchPath: string, callback: FileChangeCallback): void {
    const resolved = path.resolve(watchPath);

    if (!fs.existsSync(resolved)) {
      console.warn(`[Watcher] Path does not exist: ${resolved}`);
      return;
    }

    try {
      const watcher = fs.watch(resolved, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(resolved, filename);
        const event: WatchEvent = eventType === 'rename' ? 'renamed' : 'modified';
        callback(event, fullPath).catch(err => {
          console.error(`[Watcher] Callback error:`, (err as Error).message);
        });
      });

      this.fileWatchers.push({ path: resolved, watcher, callback });
      console.log(`[Watcher] Monitoring: ${resolved}`);
    } catch (err) {
      console.error(`[Watcher] Failed to watch ${resolved}:`, (err as Error).message);
    }
  }

  // ─── Start clipboard monitoring ───
  startClipboardMonitor(callback: ClipboardCallback, intervalMs: number = 2000): void {
    if (this.clipboardInterval) return;

    // Get initial clipboard content
    this.lastClipboard = this.getClipboard();

    this.clipboardInterval = setInterval(() => {
      try {
        const current = this.getClipboard();
        if (current && current !== this.lastClipboard) {
          this.lastClipboard = current;
          const type = this.classifyClipboard(current);
          callback(current, type).catch(err => {
            console.error(`[Watcher] Clipboard callback error:`, (err as Error).message);
          });
        }
      } catch {
        // Clipboard access can fail silently
      }
    }, intervalMs);

    this.clipboardInterval.unref();
  }

  // ─── Stop clipboard monitoring ───
  stopClipboardMonitor(): void {
    if (this.clipboardInterval) {
      clearInterval(this.clipboardInterval);
      this.clipboardInterval = null;
    }
  }

  // ─── Get active watch count ───
  getWatchCount(): number {
    return this.fileWatchers.length + (this.clipboardInterval ? 1 : 0);
  }

  // ─── Stop all watchers ───
  stopAll(): void {
    for (const w of this.fileWatchers) {
      w.watcher.close();
    }
    this.fileWatchers = [];
    this.stopClipboardMonitor();
  }

  // ─── Remove a specific file watcher ───
  unwatchPath(watchPath: string): void {
    const resolved = path.resolve(watchPath);
    const idx = this.fileWatchers.findIndex(w => w.path === resolved);
    if (idx >= 0) {
      this.fileWatchers[idx].watcher.close();
      this.fileWatchers.splice(idx, 1);
    }
  }

  // ─── Read clipboard content (cross-platform) ───
  private getClipboard(): string {
    try {
      if (process.platform === 'darwin') {
        return execSync('pbpaste', { encoding: 'utf-8', timeout: 2000 }).trim();
      } else if (process.platform === 'linux') {
        return execSync('xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null', {
          encoding: 'utf-8',
          timeout: 2000,
          shell: '/bin/sh',
        }).trim();
      } else if (process.platform === 'win32') {
        return execSync('powershell -command "Get-Clipboard"', { encoding: 'utf-8', timeout: 2000 }).trim();
      }
    } catch {
      // Clipboard not available
    }
    return '';
  }

  // ─── Classify clipboard content type ───
  private classifyClipboard(content: string): ClipboardType {
    const trimmed = content.trim();

    // URL detection
    if (/^https?:\/\/\S+$/.test(trimmed)) return 'url';

    // Code detection (common patterns)
    if (
      trimmed.includes('function ') ||
      trimmed.includes('const ') ||
      trimmed.includes('import ') ||
      trimmed.includes('class ') ||
      trimmed.includes('def ') ||
      trimmed.includes('async ') ||
      /^\s*[\{\[\(]/.test(trimmed) ||
      trimmed.includes('=>') ||
      trimmed.includes('console.log')
    ) {
      return 'code';
    }

    // Plain text
    if (trimmed.length > 0) return 'text';

    return 'unknown';
  }
}
