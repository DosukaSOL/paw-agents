// ─── Twitter/X Channel Adapter ───
// Connects PAW to X/Twitter — DMs, mentions, and posting.
// User provides their own Twitter API keys.

import { ChannelAdapter, ChannelType } from '../../core/types';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class TwitterAdapter implements ChannelAdapter {
  name: ChannelType = 'twitter';
  private handler: MessageHandler | null = null;
  private apiKey: string;
  private apiSecret: string;
  private accessToken: string;
  private accessSecret: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCheckedId: string = '0';

  constructor() {
    this.apiKey = process.env.TWITTER_API_KEY ?? '';
    this.apiSecret = process.env.TWITTER_API_SECRET ?? '';
    this.accessToken = process.env.TWITTER_ACCESS_TOKEN ?? '';
    this.accessSecret = process.env.TWITTER_ACCESS_SECRET ?? '';
  }

  async start(): Promise<void> {
    if (!this.apiKey || !this.accessToken) {
      console.log('[PAW:Twitter] No Twitter API credentials configured, skipping.');
      return;
    }

    // Poll for DMs and mentions every 30 seconds
    this.pollInterval = setInterval(() => this.pollMessages(), 30000);
    this.pollInterval.unref();
    console.log('[PAW:Twitter] 🐦 Twitter/X channel connected');
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.apiKey) return;

    try {
      // Send DM via Twitter API v2
      const twitterUserId = userId.replace('twitter:', '');
      await this.twitterRequest('POST', '/2/dm_conversations/with/' + encodeURIComponent(twitterUserId) + '/messages', {
        text: message.substring(0, 10000), // Twitter DM limit
      });
    } catch (err) {
      console.error('[PAW:Twitter] Send failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── Post a tweet ───
  async tweet(text: string): Promise<{ id: string } | null> {
    try {
      const result = await this.twitterRequest('POST', '/2/tweets', { text: text.substring(0, 280) });
      return result?.data?.id ? { id: result.data.id } : null;
    } catch (err) {
      console.error('[PAW:Twitter] Tweet failed:', (err as Error).message);
      return null;
    }
  }

  private async pollMessages(): Promise<void> {
    try {
      // Poll DMs
      const dms = await this.twitterRequest('GET', '/2/dm_events?event_types=MessageCreate&max_results=5');
      if (dms?.data) {
        for (const dm of dms.data) {
          if (dm.id > this.lastCheckedId) {
            this.lastCheckedId = dm.id;
            if (this.handler) {
              await this.handler(`twitter:${dm.sender_id}`, dm.text, 'api');
            }
          }
        }
      }
    } catch {
      // Silent fail on poll
    }
  }

  private async twitterRequest(method: string, endpoint: string, body?: unknown): Promise<any> {
    const url = `https://api.twitter.com${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Twitter API error: ${response.status}`);
    }

    return response.json();
  }
}
