// ─── Discord Channel Adapter ───
// Connects PAW Agents to Discord using the bot API.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { config } from '../../core/config';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class DiscordAdapter implements ChannelAdapter {
  name: ChannelType = 'discord';
  private handler: MessageHandler | null = null;
  private client: unknown = null;

  async start(): Promise<void> {
    const token = config.discord.botToken;
    if (!token) {
      console.log('[PAW:Discord] No DISCORD_BOT_TOKEN configured, skipping Discord channel.');
      return;
    }

    try {
      // Dynamic import to avoid requiring discord.js if not used
      const { Client, GatewayIntentBits, Events } = await import('discord.js');
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      });

      client.on(Events.MessageCreate, async (message: { author: { bot: boolean; id: string }; content: string }) => {
        if (message.author.bot) return;
        if (this.handler) {
          await this.handler(`discord:${message.author.id}`, message.content, 'discord');
        }
      });

      client.once(Events.ClientReady, () => {
        console.log('[PAW:Discord] 🎮 Discord bot connected!');
      });

      await client.login(token);
      this.client = client;
    } catch (err) {
      console.warn('[PAW:Discord] Failed to start:', (err as Error).message);
    }
  }

  async stop(): Promise<void> {
    if (this.client && typeof (this.client as { destroy: () => void }).destroy === 'function') {
      (this.client as { destroy: () => void }).destroy();
    }
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.client) return;
    const discordId = userId.replace('discord:', '');
    try {
      const user = await (this.client as { users: { fetch: (id: string) => Promise<{ send: (msg: string) => Promise<void> }> } }).users.fetch(discordId);
      await user.send(message);
    } catch (err) {
      console.error('[PAW:Discord] Send failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
