// ─── PAW Agents v3.6 — Entry Point ───
// The operating system for autonomous AI workers.
// Multi-channel, multi-agent, with WebSocket gateway, dashboard, Hub, Mission Control,
// voice, daemon, live browser, streaming, and 20+ channels.

import { PawAgent } from './agent/loop';
import { TelegramBot } from './integrations/telegram/bot';
import { DiscordAdapter } from './integrations/discord/adapter';
import { SlackAdapter } from './integrations/slack/adapter';
import { EmailAdapter } from './integrations/email/adapter';
import { SMSAdapter } from './integrations/sms/adapter';
import { LINEAdapter } from './integrations/line/adapter';
import { RedditAdapter } from './integrations/reddit/adapter';
import { MatrixAdapter } from './integrations/matrix/adapter';
import { TwitterAdapter } from './integrations/twitter/adapter';
import { GitHubAdapter } from './integrations/github/adapter';
import { NotionAdapter } from './integrations/notion/adapter';
import { CalendarAdapter } from './integrations/calendar/adapter';
import { DesktopAdapter } from './integrations/desktop/adapter';
import { RestApiAdapter } from './integrations/api-rest/adapter';
import { MQTTAdapter } from './integrations/mqtt/adapter';
import { RSSAdapter } from './integrations/rss/adapter';
import { VoiceAdapter } from './integrations/voice/adapter';
import { PawGateway } from './gateway/index';
import { CronEngine } from './cron/index';
import { pawDaemon } from './daemon/index';
import { config } from './core/config';
import { missionControl } from './mission-control/index';
import { crossAppSync } from './sync/cross-app';

async function main(): Promise<void> {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   🐾  PAW AGENTS v3.6                             ║
  ║   The OpenClaw Killer                             ║
  ║                                                   ║
  ║   The operating system for autonomous AI agents.  ║
  ║                                                   ║
  ║   Mode: ${config.agent.mode.padEnd(35)}    ║
  ║   Gateway: ws://${config.gateway.host}:${String(config.gateway.port).padEnd(22)}  ║
  ║   Dashboard: http://${config.gateway.host}:${String(config.gateway.port).padEnd(19)}  ║
  ║   Network: ${config.solana.network.padEnd(33)}  ║
  ║   Ollama: ${(config.models.ollama.enabled ? config.models.ollama.model : 'disabled').padEnd(33)}  ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
  `);

  // Initialize agent
  const agent = new PawAgent();

  // Register agent in Mission Control
  missionControl.registerAgent('paw-main', 'PAW Main Agent', config.models.defaultProvider);
  missionControl.log('info', 'system', 'PAW Agents v3.6 starting...');

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

  // ─── v3.6 New Channels ───

  // Twitter/X adapter
  try {
    const twitter = new TwitterAdapter();
    twitter.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await twitter.send(userId, response.message);
    });
    await twitter.start();
  } catch (err) {
    console.warn('[PAW] Twitter not configured or failed:', (err as Error).message);
  }

  // GitHub adapter
  try {
    const github = new GitHubAdapter();
    github.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await github.send(userId, response.message);
    });
    await github.start();
  } catch (err) {
    console.warn('[PAW] GitHub not configured or failed:', (err as Error).message);
  }

  // Notion adapter
  try {
    const notion = new NotionAdapter();
    notion.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await notion.send(userId, response.message);
    });
    await notion.start();
  } catch (err) {
    console.warn('[PAW] Notion not configured or failed:', (err as Error).message);
  }

  // Calendar adapter
  try {
    const calendar = new CalendarAdapter();
    calendar.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await calendar.send(userId, response.message);
    });
    await calendar.start();
  } catch (err) {
    console.warn('[PAW] Calendar not configured or failed:', (err as Error).message);
  }

  // Desktop notifications adapter
  try {
    const desktop = new DesktopAdapter();
    desktop.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await desktop.send(userId, response.message);
    });
    await desktop.start();
  } catch (err) {
    console.warn('[PAW] Desktop not configured or failed:', (err as Error).message);
  }

  // REST API adapter
  try {
    const rest = new RestApiAdapter();
    rest.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await rest.send(userId, response.message);
    });
    await rest.start();
  } catch (err) {
    console.warn('[PAW] REST API not configured or failed:', (err as Error).message);
  }

  // MQTT adapter
  try {
    const mqtt = new MQTTAdapter();
    mqtt.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await mqtt.send(userId, response.message);
    });
    await mqtt.start();
  } catch (err) {
    console.warn('[PAW] MQTT not configured or failed:', (err as Error).message);
  }

  // RSS feed adapter
  try {
    const rss = new RSSAdapter();
    rss.onMessage(async (userId: string, message: string) => {
      const response = await agent.process(userId, message);
      await rss.send(userId, response.message);
    });
    await rss.start();
  } catch (err) {
    console.warn('[PAW] RSS not configured or failed:', (err as Error).message);
  }

  // Voice adapter (if configured)
  if (config.voice?.enabled) {
    try {
      const voice = new VoiceAdapter();
      voice.onMessage(async (userId: string, message: string) => {
        const response = await agent.process(userId, message);
        await voice.send(userId, response.message);
      });
      await voice.start();
    } catch (err) {
      console.warn('[PAW] Voice not configured or failed:', (err as Error).message);
    }
  }

  // ─── Daemon (Free Mode backbone) ───
  if (config.daemon?.enabled || config.agent.mode === 'free') {
    try {
      await pawDaemon.start(agent);
    } catch (err) {
      console.warn('[PAW] Daemon failed to start:', (err as Error).message);
    }
  }

  console.log('[PAW] 🐾 All systems online.');
  missionControl.log('info', 'system', 'All systems online — PAW v3.6 ready');
  missionControl.updateAgentStatus('paw-main', 'active');
}

main().catch((err) => {
  console.error('[PAW] Fatal error:', err);
  process.exit(1);
});
