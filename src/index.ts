// ─── PAW Agents v3.0 — Entry Point ───
// The operating system for autonomous AI workers.
// Multi-channel, multi-agent, with WebSocket gateway + dashboard.

import { PawAgent } from './agent/loop';
import { TelegramBot } from './integrations/telegram/bot';
import { PawGateway } from './gateway/index';
import { CronEngine } from './cron/index';
import { config } from './core/config';

async function main(): Promise<void> {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   🐾  PAW AGENTS v3.0                             ║
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

  console.log('[PAW] 🐾 All systems online.');
}

main().catch((err) => {
  console.error('[PAW] Fatal error:', err);
  process.exit(1);
});
