// ─── PAW Daemon: Native OS Notifications ───
// Cross-platform notifications for agent activity, task completions, alerts.

import { execSync, spawn } from 'child_process';
import { EventEmitter } from 'events';

export interface Notification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  priority: 'low' | 'normal' | 'high';
  source: string;
}

export class NotificationManager extends EventEmitter {
  private history: Notification[] = [];
  private maxHistory = 500;
  private enabled = true;
  private counter = 0;

  // ─── Send a notification ───
  send(title: string, body: string, priority: 'low' | 'normal' | 'high' = 'normal', source: string = 'daemon'): void {
    const notification: Notification = {
      id: `notif-${++this.counter}`,
      title,
      body,
      timestamp: new Date().toISOString(),
      read: false,
      priority,
      source,
    };

    this.history.push(notification);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    this.emit('notification', notification);

    if (!this.enabled) return;

    try {
      this.sendNative(title, body);
    } catch (err) {
      console.warn('[Notifications] Native send failed:', (err as Error).message);
    }
  }

  // ─── Send native OS notification ───
  private sendNative(title: string, body: string): void {
    // Strip all control characters and limit length to prevent injection
    const safeTitle = title.replace(/[\x00-\x1f\x7f]/g, '').substring(0, 200);
    const safeBody = body.replace(/[\x00-\x1f\x7f]/g, '').substring(0, 500);

    if (process.platform === 'darwin') {
      // macOS: pass script via stdin to avoid shell escaping issues entirely
      const script = `display notification "${safeBody.replace(/[\\"/]/g, ' ')}" with title "🐾 PAW" subtitle "${safeTitle.replace(/[\\"/]/g, ' ')}"`;
      const child = spawn('osascript', ['-'], { timeout: 5000, stdio: ['pipe', 'ignore', 'ignore'] });
      child.stdin?.write(script);
      child.stdin?.end();
      child.unref();
    } else if (process.platform === 'linux') {
      // Linux: use notify-send with args array (no shell interpolation)
      spawn('notify-send', ['🐾 PAW — ' + safeTitle, safeBody], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      // Windows: use PowerShell with encoded command to avoid string interpolation
      const xml = `<toast><visual><binding template="ToastText02"><text id="1">PAW: ${safeTitle.replace(/[<>&"']/g, ' ')}</text><text id="2">${safeBody.replace(/[<>&"']/g, ' ')}</text></binding></visual></toast>`;
      const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('${xml.replace(/'/g, "''")}') 
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('PAW').Show($toast)
`;
      const encoded = Buffer.from(ps, 'utf16le').toString('base64');
      spawn('powershell', ['-NoProfile', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore' }).unref();
    }
  }

  // ─── Get notification history ───
  getHistory(limit: number = 50): Notification[] {
    return this.history.slice(-limit);
  }

  // ─── Mark notification as read ───
  markRead(id: string): void {
    const notif = this.history.find(n => n.id === id);
    if (notif) notif.read = true;
  }

  // ─── Get unread count ───
  getUnreadCount(): number {
    return this.history.filter(n => !n.read).length;
  }

  // ─── Enable/disable notifications ───
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // ─── Clear all notifications ───
  clear(): void {
    this.history = [];
    this.counter = 0;
  }
}
