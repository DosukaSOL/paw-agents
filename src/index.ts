// ─── PAW Agents — Entry Point ───
// The operating system for autonomous AI workers.

import { PawAgent } from './agent/loop';
import { TelegramBot } from './integrations/telegram/bot';

async function main(): Promise<void> {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║                                               ║
  ║   🐾  PAW AGENTS  —  Purp Autonomous Workers  ║
  ║                                               ║
  ║   The operating system for autonomous          ║
  ║   AI workers.                                  ║
  ║                                               ║
  ╚═══════════════════════════════════════════════╝
  `);

  // Initialize agent
  const agent = new PawAgent();

  // Start Telegram bot
  const bot = new TelegramBot(agent);
  await bot.start();
}

main().catch((err) => {
  console.error('[PAW] Fatal error:', err);
  process.exit(1);
});
