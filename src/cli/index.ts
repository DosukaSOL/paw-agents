#!/usr/bin/env node
// ─── PAW CLI Companion ───
// Interactive command-line interface for PAW Agents.
// Commands: paw chat, paw deploy, paw status, paw rag, paw branch

import * as readline from 'readline';
import { PawAgent } from '../agent/loop';
import { config } from '../core/config';

const VERSION = '3.2.0';

// ─── ANSI Colors ───
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
};

function banner(): void {
  console.log(`
${c.cyan}${c.bold}  ╔═══════════════════════════════════════╗
  ║                                       ║
  ║   🐾  PAW CLI v${VERSION}                 ║
  ║   Programmable Autonomous Workers     ║
  ║                                       ║
  ╚═══════════════════════════════════════╝${c.reset}
`);
}

function help(): void {
  console.log(`
${c.bold}Usage:${c.reset} paw <command> [options]

${c.bold}Commands:${c.reset}
  ${c.cyan}chat${c.reset}        Start an interactive chat session with PAW
  ${c.cyan}status${c.reset}      Show agent status, config, and connected channels
  ${c.cyan}deploy${c.reset}      Start the full PAW agent (all channels + gateway)
  ${c.cyan}rag${c.reset}         Manage RAG documents (index, search, list)
  ${c.cyan}branch${c.reset}      Manage conversation branches (list, switch, rollback)
  ${c.cyan}models${c.reset}      Show available AI models and performance stats
  ${c.cyan}help${c.reset}        Show this help message
  ${c.cyan}version${c.reset}     Show version

${c.bold}Chat commands (inside chat):${c.reset}
  ${c.dim}/mode <mode>${c.reset}     Switch agent mode (supervised|autonomous|free)
  ${c.dim}/branch${c.reset}          Create a new conversation branch
  ${c.dim}/rollback <n>${c.reset}    Roll back to message #n
  ${c.dim}/branches${c.reset}        List all conversation branches
  ${c.dim}/switch <id>${c.reset}     Switch to a different branch
  ${c.dim}/rag index <file>${c.reset} Index a file for RAG
  ${c.dim}/rag search <q>${c.reset}  Search RAG documents
  ${c.dim}/stats${c.reset}           Show session stats
  ${c.dim}/clear${c.reset}           Clear conversation history
  ${c.dim}/exit${c.reset}            Exit the chat
`);
}

// ─── Status command ───
function showStatus(): void {
  console.log(`\n${c.bold}🐾 PAW Agent Status${c.reset}\n`);
  console.log(`  ${c.cyan}Version:${c.reset}    ${VERSION}`);
  console.log(`  ${c.cyan}Mode:${c.reset}       ${config.agent.mode}`);
  console.log(`  ${c.cyan}Network:${c.reset}    ${config.solana.network}`);
  console.log(`  ${c.cyan}Gateway:${c.reset}    ws://${config.gateway.host}:${config.gateway.port}`);
  console.log(`  ${c.cyan}Model:${c.reset}      ${config.models.defaultProvider}`);
  console.log(`  ${c.cyan}Validation:${c.reset} ${config.agent.requireValidation ? 'Always on' : 'Disabled'}`);

  // Check configured channels
  const channels: string[] = [];
  if (process.env.TELEGRAM_BOT_TOKEN) channels.push('Telegram');
  if (process.env.DISCORD_BOT_TOKEN) channels.push('Discord');
  if (process.env.SLACK_BOT_TOKEN) channels.push('Slack');
  if (config.email.imapHost) channels.push('Email');
  if (config.sms.accountSid) channels.push('SMS');
  if (config.line.channelAccessToken) channels.push('LINE');
  if (config.reddit.clientId) channels.push('Reddit');
  if (config.matrix.homeserverUrl) channels.push('Matrix');
  channels.push('WebChat', 'Webhooks'); // Always available via gateway

  console.log(`  ${c.cyan}Channels:${c.reset}   ${channels.join(', ')}`);

  // Intelligence features
  console.log(`\n  ${c.bold}Intelligence:${c.reset}`);
  console.log(`  ${c.cyan}Profiling:${c.reset}  ${config.intelligence.profilingEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  ${c.cyan}RAG:${c.reset}        ${config.intelligence.ragEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  ${c.cyan}Smart Route:${c.reset} ${config.intelligence.smartRoutingEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  ${c.cyan}Fast Path:${c.reset}  ${config.intelligence.fastPathEnabled ? `Enabled (${config.intelligence.fastPathProvider})` : 'Disabled'}`);
  console.log(`  ${c.cyan}Branching:${c.reset}  ${config.intelligence.branchingEnabled ? 'Enabled' : 'Disabled'}`);
  console.log('');
}

// ─── Models command ───
function showModels(): void {
  console.log(`\n${c.bold}🤖 Available AI Models${c.reset}\n`);

  const models = [
    { name: 'OpenAI', model: config.models.openai.model, configured: !!config.models.openai.apiKey },
    { name: 'Anthropic', model: 'claude-sonnet-4-20250514', configured: !!config.models.anthropic.apiKey },
    { name: 'Google', model: config.models.google.model, configured: !!config.models.google.apiKey },
    { name: 'Mistral', model: config.models.mistral.model, configured: !!config.models.mistral.apiKey },
    { name: 'DeepSeek', model: config.models.deepseek.model, configured: !!config.models.deepseek.apiKey },
    { name: 'Groq', model: config.models.groq.model, configured: !!config.models.groq.apiKey },
  ];

  for (const m of models) {
    const status = m.configured ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const isDefault = m.name.toLowerCase() === config.models.defaultProvider ? ` ${c.yellow}(default)${c.reset}` : '';
    console.log(`  ${status} ${c.bold}${m.name}${c.reset} — ${m.model}${isDefault}`);
  }

  console.log('');
}

// ─── Interactive chat ───
async function startChat(): Promise<void> {
  banner();
  console.log(`${c.dim}Mode: ${config.agent.mode} | Model: ${config.models.defaultProvider} | Type /help for commands${c.reset}\n`);

  const agent = new PawAgent();
  const userId = `cli:${Date.now()}`;
  let messageCount = 0;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.green}you → ${c.reset}`,
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Handle CLI commands
    if (input === '/exit' || input === '/quit') {
      console.log(`\n${c.dim}👋 Goodbye! ${messageCount} messages in this session.${c.reset}\n`);
      rl.close();
      process.exit(0);
    }

    if (input === '/help') {
      help();
      rl.prompt();
      return;
    }

    if (input === '/clear') {
      console.clear();
      banner();
      messageCount = 0;
      rl.prompt();
      return;
    }

    if (input === '/stats') {
      console.log(`\n${c.dim}Session: ${messageCount} messages | User: ${userId} | Mode: ${agent.getUserMode(userId)}${c.reset}\n`);
      rl.prompt();
      return;
    }

    if (input.startsWith('/mode ')) {
      const mode = input.slice(6).trim();
      if (['supervised', 'autonomous', 'free'].includes(mode)) {
        agent.setUserMode(userId, mode as 'supervised' | 'autonomous' | 'free');
        console.log(`\n${c.yellow}Mode switched to: ${mode}${c.reset}\n`);
      } else {
        console.log(`\n${c.red}Invalid mode. Use: supervised, autonomous, or free${c.reset}\n`);
      }
      rl.prompt();
      return;
    }

    // Send to agent
    messageCount++;
    process.stdout.write(`\n${c.cyan}paw → ${c.reset}`);

    try {
      const response = await agent.process(userId, input);

      if (response.requires_confirmation) {
        console.log(`${response.message}\n`);
      } else if (response.success) {
        console.log(`${response.message}\n`);
      } else {
        console.log(`${c.red}${response.message}${c.reset}\n`);
      }
    } catch (err) {
      console.log(`${c.red}Error: ${(err as Error).message}${c.reset}\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// ─── Deploy command (starts full agent) ───
async function deploy(): Promise<void> {
  banner();
  console.log(`${c.yellow}Starting full PAW agent...${c.reset}\n`);

  // Dynamic import to avoid loading everything for other commands
  try {
    await import('../index');
  } catch (err) {
    console.error(`${c.red}Failed to start:${c.reset}`, (err as Error).message);
    process.exit(1);
  }
}

// ─── Main ───
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'help';

  switch (command) {
    case 'chat':
      await startChat();
      break;
    case 'status':
      showStatus();
      break;
    case 'deploy':
      await deploy();
      break;
    case 'models':
      showModels();
      break;
    case 'version':
    case '--version':
    case '-v':
      console.log(`paw v${VERSION}`);
      break;
    case 'help':
    case '--help':
    case '-h':
      banner();
      help();
      break;
    default:
      console.log(`${c.red}Unknown command: ${command}${c.reset}`);
      help();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${c.red}Fatal error:${c.reset}`, err);
  process.exit(1);
});
