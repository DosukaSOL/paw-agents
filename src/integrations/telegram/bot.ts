// ─── Telegram Bot Interface ───
// Primary user interface for PAW Agents.
// Now with chat command support and mode toggle.

import { Telegraf, Context } from 'telegraf';
import { config } from '../../core/config';
import { PawAgent } from '../../agent/loop';
import { CommandHandler } from '../../commands/index';

export class TelegramBot {
  private bot: Telegraf;
  private agent: PawAgent;
  private commands: CommandHandler;

  constructor(agent: PawAgent) {
    this.bot = new Telegraf(config.telegram.botToken);
    this.agent = agent;
    this.commands = new CommandHandler(agent);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Main message handler — routes commands and messages
    this.bot.on('text', async (ctx) => {
      if (!ctx.from) {
        await ctx.reply('Unable to process messages without user context.');
        return;
      }
      const userId = String(ctx.from.id);
      const message = ctx.message.text;

      // Try as command first
      const cmdResult = this.commands.handle(userId, message);
      if (cmdResult.handled && cmdResult.response) {
        try {
          await ctx.reply(cmdResult.response, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(cmdResult.response);
        }
        return;
      }

      // Show typing indicator
      await ctx.sendChatAction('typing');

      try {
        const response = await this.agent.process(userId, message);

        if (response.success) {
          try {
            await ctx.reply(response.message, { parse_mode: 'Markdown' });
          } catch {
            // Fallback to plain text if Markdown parsing fails
            await ctx.reply(response.message);
          }
        } else {
          await ctx.reply(`❌ ${response.message}`);
        }
      } catch (err) {
        console.error('[TelegramBot] Error:', (err as Error).message);
        await ctx.reply('❌ An internal error occurred. Please try again.');
      }
    });

    // Error handler
    this.bot.catch((err, ctx) => {
      console.error('[TelegramBot] Unhandled error:', err);
    });
  }

  async start(): Promise<void> {
    console.log('[PAW] 🐾 Starting Telegram bot...');
    await this.bot.launch();
    console.log('[PAW] 🐾 Bot is live!');

    // Graceful shutdown
    const shutdown = () => {
      console.log('[PAW] Shutting down...');
      this.bot.stop('SIGTERM');
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
}
