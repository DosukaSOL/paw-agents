// ─── Notion Channel Adapter ───
// Connects PAW to Notion pages and databases as a task/note channel.
// User provides their own Notion integration token.

import { ChannelAdapter, ChannelType } from '../../core/types';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class NotionAdapter implements ChannelAdapter {
  name: ChannelType = 'notion';
  private handler: MessageHandler | null = null;
  private token: string;
  private databaseId: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCheckedAt: string = new Date().toISOString();

  constructor() {
    this.token = process.env.NOTION_TOKEN ?? '';
    this.databaseId = process.env.NOTION_DATABASE_ID ?? '';
  }

  async start(): Promise<void> {
    if (!this.token) {
      console.log('[PAW:Notion] No NOTION_TOKEN configured, skipping.');
      return;
    }

    // Poll Notion for new tasks every 60 seconds
    if (this.databaseId) {
      this.pollInterval = setInterval(() => this.pollDatabase(), 60000);
      this.pollInterval.unref();
    }

    console.log('[PAW:Notion] 📝 Notion channel connected');
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.token) return;

    // Add a comment or update a Notion page
    const pageId = userId.replace('notion:', '');
    try {
      await this.notionRequest('POST', '/v1/comments', {
        parent: { page_id: pageId },
        rich_text: [{ type: 'text', text: { content: `🐾 PAW: ${message}` } }],
      });
    } catch (err) {
      console.error('[PAW:Notion] Comment failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── Create a Notion page ───
  async createPage(title: string, content: string, databaseId?: string): Promise<string | null> {
    try {
      const result = await this.notionRequest('POST', '/v1/pages', {
        parent: { database_id: databaseId ?? this.databaseId },
        properties: {
          title: { title: [{ text: { content: title } }] },
        },
        children: [
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } },
        ],
      });
      return result?.id ?? null;
    } catch (err) {
      console.error('[PAW:Notion] Create page failed:', (err as Error).message);
      return null;
    }
  }

  private async pollDatabase(): Promise<void> {
    try {
      const result = await this.notionRequest('POST', `/v1/databases/${this.databaseId}/query`, {
        filter: {
          timestamp: 'last_edited_time',
          last_edited_time: { after: this.lastCheckedAt },
        },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        page_size: 5,
      });

      this.lastCheckedAt = new Date().toISOString();

      if (result?.results) {
        for (const page of result.results) {
          const title = page.properties?.title?.title?.[0]?.plain_text ?? 'Untitled';
          if (this.handler) {
            await this.handler(`notion:${page.id}`, `Notion update: ${title}`, 'api');
          }
        }
      }
    } catch {
      // Silent fail on poll
    }
  }

  private async notionRequest(method: string, endpoint: string, body?: unknown): Promise<any> {
    const url = `https://api.notion.com${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Notion API error: ${response.status}`);
    }

    return response.json();
  }
}
