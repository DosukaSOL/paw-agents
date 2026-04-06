// ─── PAW Agents v3.1 — Entry Point ───
// The operating system for autonomous AI workers.
// Multi-channel, multi-agent, with WebSocket gateway + dashboard.

import { PawAgent } from './agent/loop';
import { TelegramBot } from './integrations/telegram/bot';
import { DiscordAdapter } from './integrations/discord/adapter';
import { SlackAdapter } from './integrations/slack/adapter';
import { EmailAdapter } from './integrations/email/adapter';
import { SMSAdapter } from './integrations/sms/adapter';
import { LINEAdapter } from './integrations/line/adapter';
import { RedditAdapter } from './integrations/reddit/adapter';
import { MatrixAdapter } from './integrations/matrix/adapter';
import { PawGateway } from './gateway/index';
import { CronEngine } from './cron/index';
import { config } from './core/config';

async function main(): Promise<void> {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   🐾  PAW AGENTS v3.2                             ║
  ║   Purp Autonomous Workers                         ║
  ║                                                   ║
  ║   The operating system for autonomous AI agents.  ║
  ║                                                   ║
  ║   Mode: ${config.agent.mode.padEnd(35)}    ║
  ║   Gateway: ws://${config.gateway.host}:${String(config.gateway.port).padEnd(22)}  ║
  ║   Dashboard: http://${config.gateway.host}:${String(config.gateway.port).padEnd(19)}  ║
  ║   Network: ${config.solana.network.padEnd(33)}  ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
  `);

  // Initialize agent
  const agent = new PawAgent();

  // Start WebSocket Gateway
  const gateway = new PawGateway(agent);
  await gateway.start();

  // Start Cron engine
  const cron = new CronEngine();
  cron.onTask(async (task) => {
    console.log(`[Cron] Running task: ${task.name}`);
    await agent.process(`cron:${task.id}`, task.action);
  });

  // Start Telegram bot (primary channel)
  try {
    const bot = new TelegramBot(agent);
    await bot.start();
  } catch (err) {
    console.warn('[PAW] Telegram not configured or failed:', (err as Error).message);
  }

  // Start Discord adapter
  try {
    const discord = new DiscordAdapter();
    discord.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await discord.send(userId, response.message);
    });
    await discord.start();
  } catch (err) {
    console.warn('[PAW] Discord not configured or failed:', (err as Error).message);
  }

  // Start Slack adapter
  try {
    const slack = new SlackAdapter();
    slack.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await slack.send(userId, response.message);
    });
    await slack.start();
  } catch (err) {
    console.warn('[PAW] Slack not configured or failed:', (err as Error).message);
  }

  // Start Email adapter (if configured)
  if (config.email?.imapHost) {
    try {
      const email = new EmailAdapter({
        imap: {
          host: config.email.imapHost,
          port: config.email.imapPort,
          user: config.email.user,
          password: config.email.password,
          tls: true,
        },
        smtp: {
          host: config.email.smtpHost,
          port: config.email.smtpPort,
          user: config.email.user,
          password: config.email.password,
          secure: true,
        },
        fromAddress: config.email.user,
      });
      email.onMessage(async (userId: string, message: string) => {
        const response = await agent.process(userId, message);
        await email.send(userId, response.message);
      });
      await email.start();
    } catch (err) {
      console.warn('[PAW] Email not configured or failed:', (err as Error).message);
    }
  }

  // Start SMS adapter (if configured)
  if (config.sms?.accountSid) {
    try {
      const sms = new SMSAdapter({
        accountSid: config.sms.accountSid,
        authToken: config.sms.authToken,
        fromNumber: config.sms.fromNumber,
      });
      sms.onMessage(async (userId: string, message: string) => {
        const response = await agent.process(userId, message);
        await sms.send(userId, response.message);
      });
      await sms.start();
    } catch (err) {
      console.warn('[PAW] SMS not configured or failed:', (err as Error).message);
    }
  }

  // Start LINE adapter (if configured)
  try {
    const line = new LINEAdapter();
    line.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await line.send(userId, response.message);
    });
    await line.start();
  } catch (err) {
    console.warn('[PAW] LINE not configured or failed:', (err as Error).message);
  }

  // Start Reddit adapter (if configured)
  try {
    const reddit = new RedditAdapter();
    reddit.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await reddit.send(userId, response.message);
    });
    await reddit.start();
  } catch (err) {
    console.warn('[PAW] Reddit not configured or failed:', (err as Error).message);
  }

  // Start Matrix / Element adapter (if configured)
  try {
    const matrix = new MatrixAdapter();
    matrix.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await matrix.send(userId, response.message);
    });
    await matrix.start();
  } catch (err) {
    console.warn('[PAW] Matrix not configured or failed:', (err as Error).message);
  }

  console.log('[PAW] 🐾 All systems online.');
}

main().catch((err) => {
  console.error('[PAW] Fatal error:', err);
  process.exit(1);
});
