// ─── Telegram Bot Interface ───
// Primary user interface for PAW Agents.

import { Telegraf, Context } from 'telegraf';
import { config } from '../../core/config';
import { PawAgent } from '../../agent/loop';

export class TelegramBot {
  private bot: Telegraf;
  private agent: PawAgent;

  constructor(agent: PawAgent) {
    this.bot = new Telegraf(config.telegram.botToken);
    this.agent = agent;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Start command
    this.bot.start((ctx) => {
      ctx.reply(
        '🐾 *PAW Agent Active*\n\n' +
        'I am your autonomous AI worker. Tell me what you need:\n\n' +
        '• Check a Solana wallet balance\n' +
        '• Transfer SOL\n' +
        '• Execute Purp programs\n' +
        '• Call APIs\n' +
        '• And more...\n\n' +
        'All actions are validated and require your approval for high-risk operations.\n\n' +
        'Type /help for more info.',
        { parse_mode: 'Markdown' }
      );
    });

    // Help command
    this.bot.help((ctx) => {
      ctx.reply(
        '🐾 *PAW Agent Help*\n\n' +
        '*Commands:*\n' +
        '/start — Initialize agent\n' +
        '/help — Show this help\n' +
        '/skills — List loaded skills\n' +
        '/status — Agent status\n\n' +
        '*How it works:*\n' +
        '1. Send me a natural language request\n' +
        '2. I create a safe execution plan\n' +
        '3. High-risk actions require your confirmation\n' +
        '4. All actions are logged and traceable\n\n' +
        '*Safety:*\n' +
        '• All blockchain transactions are simulated first\n' +
        '• Risk scoring on every action\n' +
        '• Full audit trail via Clawtrace\n' +
        '• No direct code execution',
        { parse_mode: 'Markdown' }
      );
    });

    // Skills command
    this.bot.command('skills', (ctx) => {
      ctx.reply(
        '🐾 *Loaded Skills*\n\n' +
        'Skills are loaded from the /skills directory.\n' +
        'Add .skill.md or .skill.yaml files to extend capabilities.',
        { parse_mode: 'Markdown' }
      );
    });

    // Status command
    this.bot.command('status', (ctx) => {
      ctx.reply(
        '🐾 *PAW Agent Status*\n\n' +
        '✅ Agent: Online\n' +
        '✅ Pipeline: INTENT → PLAN → VALIDATE → EXECUTE → VERIFY\n' +
        '✅ Safety: Active\n' +
        '✅ Clawtrace: Logging',
        { parse_mode: 'Markdown' }
      );
    });

    // Main message handler — THE AGENT LOOP ENTRY POINT
    this.bot.on('text', async (ctx) => {
      const userId = String(ctx.from.id);
      const message = ctx.message.text;

      // Show typing indicator
      await ctx.sendChatAction('typing');

      try {
        const response = await this.agent.process(userId, message);

        if (response.success) {
          await ctx.reply(response.message, { parse_mode: 'Markdown' });
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
