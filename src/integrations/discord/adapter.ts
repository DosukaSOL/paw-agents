// ─── Discord Channel Adapter ───
// Connects PAW Agents to Discord using the bot API.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { config } from '../../core/config';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class DiscordAdapter implements ChannelAdapter {
  name: ChannelType = 'discord';
  private handler: MessageHandler | null = null;
  private client: unknown = null;
  private channelMap = new Map<string, string>(); // userId -> last channelId
  private static readonly MAX_CHANNEL_MAP_SIZE = 10_000;

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

      client.on(Events.MessageCreate, async (message: { author: { bot: boolean; id: string }; content: string; channel: { id: string } }) => {
        if (message.author.bot) return;
        const userId = `discord:${message.author.id}`;
        // Store the source channel for reply routing (with LRU eviction)
        if (this.channelMap.size >= DiscordAdapter.MAX_CHANNEL_MAP_SIZE && !this.channelMap.has(userId)) {
          const oldest = this.channelMap.keys().next().value;
          if (oldest) this.channelMap.delete(oldest);
        }
        this.channelMap.set(userId, message.channel.id);
        if (this.handler) {
          await this.handler(userId, message.content, 'discord').catch(err =>
            console.error('[PAW:Discord] Handler error:', (err as Error).message)
          );
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
    try {
      // Try to reply in the source channel first
      const channelId = this.channelMap.get(userId);
      if (channelId) {
        const channel = await (this.client as { channels: { fetch: (id: string) => Promise<{ send: (msg: string) => Promise<void> } | null> } }).channels.fetch(channelId);
        if (channel && 'send' in channel) {
          await (channel as { send: (msg: string) => Promise<void> }).send(message);
          return;
        }
      }
      // Fallback to DM
      const discordId = userId.replace('discord:', '');
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
