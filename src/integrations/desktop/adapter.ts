// ─── Desktop Channel Adapter ───
// Desktop notifications + system tray as a communication channel.
// Works with the daemon's notification system.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { NotificationManager } from '../../daemon/notifications';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class DesktopAdapter implements ChannelAdapter {
  name: ChannelType = 'desktop';
  private handler: MessageHandler | null = null;
  private notifications: NotificationManager;

  constructor() {
    this.notifications = new NotificationManager();
  }

  async start(): Promise<void> {
    console.log('[PAW:Desktop] 🖥️ Desktop notification channel active');
  }

  async stop(): Promise<void> {
    // Nothing to stop
  }

  async send(userId: string, message: string): Promise<void> {
    // Send as native OS notification
    this.notifications.send('PAW Agent', message.substring(0, 200), 'normal', 'desktop-channel');
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── Process input from desktop (tray, hotkey, etc.) ───
  async processDesktopInput(message: string, source: string = 'desktop'): Promise<void> {
    if (this.handler) {
      await this.handler(`desktop:${source}`, message, 'desktop');
    }
  }

  getNotifications(): NotificationManager {
    return this.notifications;
  }
}
