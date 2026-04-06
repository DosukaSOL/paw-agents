// ─── Reddit Channel Adapter ───
// Connects PAW Agents to Reddit via the Reddit API.
// Monitors a subreddit for mentions and DMs.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { config } from '../../core/config';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

interface RedditMessage {
  data: {
    name: string;
    author: string;
    body: string;
    subject?: string;
    subreddit?: string;
    was_comment: boolean;
  };
}

export class RedditAdapter implements ChannelAdapter {
  name: ChannelType = 'reddit';
  private handler: MessageHandler | null = null;
  private accessToken: string = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastProcessed: string = '';

  async start(): Promise<void> {
    const { clientId, clientSecret, username, password } = config.reddit;

    if (!clientId || !clientSecret || !username || !password) {
      console.log('[PAW:Reddit] No REDDIT_CLIENT_ID configured, skipping Reddit channel.');
      return;
    }

    try {
      // Authenticate via Reddit OAuth2 (script app flow)
      const authResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PAW-Agents/3.1 (by /u/' + username + ')',
        },
        body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      });

      if (!authResponse.ok) {
        throw new Error(`Reddit auth failed: ${authResponse.status}`);
      }

      const authData = await authResponse.json() as { access_token: string };
      this.accessToken = authData.access_token;

      // Poll inbox every 30 seconds
      this.pollTimer = setInterval(() => this.pollInbox(), 30_000);
      await this.pollInbox();

      console.log(`[PAW:Reddit] 💬 Reddit connected as /u/${username}`);
    } catch (err) {
      console.warn('[PAW:Reddit] Failed to start:', (err as Error).message);
    }
  }

  private async pollInbox(): Promise<void> {
    if (!this.accessToken || !this.handler) return;

    try {
      const response = await fetch('https://oauth.reddit.com/message/unread?limit=10', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'User-Agent': 'PAW-Agents/3.1',
        },
      });

      if (!response.ok) return;

      const data = await response.json() as { data: { children: RedditMessage[] } };
      const messages = data.data?.children ?? [];

      for (const msg of messages) {
        if (this.lastProcessed && msg.data.name <= this.lastProcessed) continue;
        this.lastProcessed = msg.data.name;

        const userId = `reddit:${msg.data.author}`;
        const text = msg.data.body;
        if (text && this.handler) {
          await this.handler(userId, text, 'reddit');
        }
      }

      // Mark as read
      if (messages.length > 0) {
        const ids = messages.map(m => m.data.name).join(',');
        await fetch('https://oauth.reddit.com/api/read_message', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'PAW-Agents/3.1',
          },
          body: `id=${ids}`,
        });
      }
    } catch (err) {
      console.error('[PAW:Reddit] Poll error:', (err as Error).message);
    }
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.accessToken) return;
    const redditUser = userId.replace('reddit:', '');
    try {
      await fetch('https://oauth.reddit.com/api/compose', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PAW-Agents/3.1',
        },
        body: `to=${encodeURIComponent(redditUser)}&subject=${encodeURIComponent('PAW Agent')}&text=${encodeURIComponent(message)}`,
      });
    } catch (err) {
      console.error('[PAW:Reddit] Send failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
