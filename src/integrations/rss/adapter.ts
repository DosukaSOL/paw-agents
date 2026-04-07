// ─── RSS Feed Channel Adapter ───
// Monitors RSS/Atom feeds and triggers agent actions on new entries.
// Useful for news digests, blog monitoring, price alerts.

import { ChannelAdapter, ChannelType } from '../../core/types';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
}

export class RSSAdapter implements ChannelAdapter {
  name: ChannelType = 'rss';
  private handler: MessageHandler | null = null;
  private feeds: string[];
  private pollInterval: NodeJS.Timeout | null = null;
  private seenItems = new Set<string>();
  private pollIntervalMs: number;

  constructor() {
    this.feeds = (process.env.RSS_FEEDS ?? '').split(',').filter(Boolean);
    this.pollIntervalMs = parseInt(process.env.RSS_POLL_INTERVAL ?? '300000', 10); // Default: 5 minutes
  }

  async start(): Promise<void> {
    if (this.feeds.length === 0) {
      console.log('[PAW:RSS] No RSS_FEEDS configured, skipping.');
      return;
    }

    // Initial poll
    await this.pollFeeds();

    // Schedule recurring polls
    this.pollInterval = setInterval(() => this.pollFeeds(), this.pollIntervalMs);
    this.pollInterval.unref();

    console.log(`[PAW:RSS] 📰 Monitoring ${this.feeds.length} feed(s)`);
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async send(userId: string, message: string): Promise<void> {
    // RSS is input-only; "sending" logs the response
    console.log(`[PAW:RSS] Response for ${userId}: ${message.substring(0, 100)}`);
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── Add a feed at runtime ───
  addFeed(url: string): void {
    if (!this.feeds.includes(url)) {
      this.feeds.push(url);
    }
  }

  // ─── Remove a feed ───
  removeFeed(url: string): void {
    this.feeds = this.feeds.filter(f => f !== url);
  }

  private async pollFeeds(): Promise<void> {
    for (const feedUrl of this.feeds) {
      try {
        const items = await this.fetchFeed(feedUrl);
        for (const item of items) {
          const id = item.guid || item.link || item.title;
          if (this.seenItems.has(id)) continue;
          this.seenItems.add(id);

          if (this.handler) {
            const feedMessage = `New RSS item: "${item.title}" — ${item.link}\n${item.description.substring(0, 200)}`;
            await this.handler(`rss:${feedUrl}`, feedMessage, 'api');
          }
        }
      } catch (err) {
        console.warn(`[PAW:RSS] Feed poll failed (${feedUrl}):`, (err as Error).message);
      }
    }

    // Prevent memory leak
    if (this.seenItems.size > 10000) {
      const items = Array.from(this.seenItems);
      this.seenItems = new Set(items.slice(-5000));
    }
  }

  private async fetchFeed(url: string): Promise<FeedItem[]> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PAW-Agents/3.6 RSS Reader' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed: ${response.status}`);
    }

    const xml = await response.text();
    return this.parseRSS(xml);
  }

  // ─── Simple RSS/Atom XML parser (no dependencies) ───
  private parseRSS(xml: string): FeedItem[] {
    const items: FeedItem[] = [];

    // RSS 2.0 items
    const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = rssItemRegex.exec(xml)) !== null) {
      const content = match[1];
      items.push({
        title: this.extractTag(content, 'title'),
        link: this.extractTag(content, 'link'),
        description: this.extractTag(content, 'description'),
        pubDate: this.extractTag(content, 'pubDate'),
        guid: this.extractTag(content, 'guid') || this.extractTag(content, 'link'),
      });
    }

    // Atom entries
    if (items.length === 0) {
      const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
      while ((match = atomEntryRegex.exec(xml)) !== null) {
        const content = match[1];
        const linkMatch = content.match(/<link[^>]+href="([^"]+)"/);
        items.push({
          title: this.extractTag(content, 'title'),
          link: linkMatch?.[1] ?? '',
          description: this.extractTag(content, 'summary') || this.extractTag(content, 'content'),
          pubDate: this.extractTag(content, 'published') || this.extractTag(content, 'updated'),
          guid: this.extractTag(content, 'id') || linkMatch?.[1] || '',
        });
      }
    }

    return items.slice(0, 20); // Cap at 20 items per feed
  }

  private extractTag(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
    return (match?.[1] ?? '').trim();
  }
}
