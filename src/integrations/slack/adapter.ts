// ─── Slack Channel Adapter ───
// Connects PAW Agents to Slack using Socket Mode.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { config } from '../../core/config';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class SlackAdapter implements ChannelAdapter {
  name: ChannelType = 'slack';
  private handler: MessageHandler | null = null;
  private app: unknown = null;

  async start(): Promise<void> {
    const botToken = config.slack.botToken;
    const appToken = config.slack.appToken;

    if (!botToken || !appToken) {
      console.log('[PAW:Slack] No SLACK_BOT_TOKEN/SLACK_APP_TOKEN configured, skipping Slack channel.');
      return;
    }

    try {
      // Dynamic import to avoid requiring @slack/bolt if not used
      const { App } = await import('@slack/bolt');
      const app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.message(async (args: any) => {
        const user = args.message?.user as string | undefined;
        const text = args.message?.text as string | undefined;
        if (!user || !text) return;
        if (this.handler) {
          await this.handler(`slack:${user}`, text, 'slack');
        }
      });

      await app.start();
      this.app = app;
      console.log('[PAW:Slack] 💬 Slack bot connected!');
    } catch (err) {
      console.warn('[PAW:Slack] Failed to start:', (err as Error).message);
    }
  }

  async stop(): Promise<void> {
    if (this.app && typeof (this.app as { stop: () => Promise<void> }).stop === 'function') {
      await (this.app as { stop: () => Promise<void> }).stop();
    }
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.app) return;
    const slackId = userId.replace('slack:', '');
    try {
      const client = (this.app as { client: { chat: { postMessage: (opts: { channel: string; text: string }) => Promise<void> } } }).client;
      await client.chat.postMessage({ channel: slackId, text: message });
    } catch (err) {
      console.error('[PAW:Slack] Send failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
