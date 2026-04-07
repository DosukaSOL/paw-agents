// ─── GitHub Channel Adapter ───
// Connects PAW to GitHub Issues, PRs, and comments as input/output channel.
// User provides their own GitHub token.

import { ChannelAdapter, ChannelType } from '../../core/types';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class GitHubAdapter implements ChannelAdapter {
  name: ChannelType = 'github';
  private handler: MessageHandler | null = null;
  private token: string;
  private owner: string;
  private repo: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCheckedAt: string = new Date().toISOString();
  private webhookPort: number;

  constructor() {
    this.token = process.env.GITHUB_TOKEN ?? '';
    this.owner = process.env.GITHUB_OWNER ?? '';
    this.repo = process.env.GITHUB_REPO ?? '';
    this.webhookPort = parseInt(process.env.GITHUB_WEBHOOK_PORT ?? '0', 10);
  }

  async start(): Promise<void> {
    if (!this.token || !this.owner || !this.repo) {
      console.log('[PAW:GitHub] No GitHub credentials configured, skipping.');
      return;
    }

    // Poll for new issues/comments every 60 seconds
    this.pollInterval = setInterval(() => this.pollActivity(), 60000);
    this.pollInterval.unref();
    console.log(`[PAW:GitHub] 🐙 GitHub channel connected (${this.owner}/${this.repo})`);
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async send(userId: string, message: string): Promise<void> {
    // Extract issue/PR number from userId
    const match = userId.match(/github:(issue|pr):(\d+)/);
    if (!match) return;

    const [, type, number] = match;
    try {
      await this.githubRequest('POST', `/repos/${this.owner}/${this.repo}/issues/${number}/comments`, {
        body: `🐾 **PAW Agent Response:**\n\n${message}`,
      });
    } catch (err) {
      console.error('[PAW:GitHub] Comment failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── Create an issue ───
  async createIssue(title: string, body: string, labels?: string[]): Promise<number | null> {
    try {
      const result = await this.githubRequest('POST', `/repos/${this.owner}/${this.repo}/issues`, {
        title,
        body,
        labels,
      });
      return result?.number ?? null;
    } catch (err) {
      console.error('[PAW:GitHub] Create issue failed:', (err as Error).message);
      return null;
    }
  }

  private async pollActivity(): Promise<void> {
    try {
      // Check for new issue comments mentioning @paw or containing trigger keywords
      const notifications = await this.githubRequest('GET',
        `/repos/${this.owner}/${this.repo}/issues/comments?since=${encodeURIComponent(this.lastCheckedAt)}&sort=created&direction=asc`
      );

      this.lastCheckedAt = new Date().toISOString();

      if (Array.isArray(notifications)) {
        for (const comment of notifications) {
          const body = comment.body ?? '';
          // Only process comments that mention PAW or are direct commands
          if (body.toLowerCase().includes('@paw') || body.toLowerCase().startsWith('/paw ')) {
            const issueUrl = comment.issue_url ?? '';
            const issueNumber = issueUrl.split('/').pop() ?? '0';
            if (this.handler) {
              await this.handler(`github:issue:${issueNumber}`, body, 'api');
            }
          }
        }
      }
    } catch {
      // Silent fail on poll
    }
  }

  private async githubRequest(method: string, endpoint: string, body?: unknown): Promise<any> {
    const url = `https://api.github.com${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'PAW-Agents/3.6',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return response.json();
  }
}
