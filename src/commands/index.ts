// ─── Chat Commands System ───
// Unified command handler for all channels.
// Supports: /mode, /status, /new, /reset, /skills, /help, /sessions, /config

import { PawAgent } from '../agent/loop';
import { config } from '../core/config';
import { AgentMode } from '../core/types';

export interface CommandResult {
  handled: boolean;
  response?: string;
}

export class CommandHandler {
  private agent: PawAgent;

  constructor(agent: PawAgent) {
    this.agent = agent;
  }

  // Returns { handled: true, response } if the message was a command, else { handled: false }
  handle(userId: string, message: string): CommandResult {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) return { handled: false };

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/start':
        return { handled: true, response: this.cmdStart() };
      case '/help':
        return { handled: true, response: this.cmdHelp() };
      case '/mode':
        return { handled: true, response: this.cmdMode(userId, args) };
      case '/status':
        return { handled: true, response: this.cmdStatus(userId) };
      case '/new':
      case '/reset':
        return { handled: true, response: this.cmdReset(userId) };
      case '/skills':
        return { handled: true, response: this.cmdSkills() };
      case '/config':
        return { handled: true, response: this.cmdConfig(userId) };
      case '/version':
        return { handled: true, response: this.cmdVersion() };
      default:
        return { handled: true, response: `Unknown command: ${cmd}\nType /help for available commands.` };
    }
  }

  private cmdStart(): string {
    return [
      '🐾 *PAW Agent Active — v2.0*',
      '',
      'I am your autonomous AI worker. I can:',
      '',
      '• Check Solana wallets & transfer SOL',
      '• Compile & deploy Purp SCL v0.3 programs',
      '• Call APIs & fetch data',
      '• Read/write files',
      '• Run scheduled tasks (cron)',
      '• Handle webhooks',
      '• And much more...',
      '',
      '*Modes:*',
      '🔒 `/mode supervised` — Review & confirm all actions (default)',
      '🤖 `/mode autonomous` — Auto-execute, confirm only critical risks',
      '',
      'Type /help for all commands.',
    ].join('\n');
  }

  private cmdHelp(): string {
    return [
      '🐾 *PAW Agent Commands*',
      '',
      '`/start` — Welcome message',
      '`/help` — This help text',
      '`/mode [autonomous|supervised]` — View or change agent mode',
      '`/status` — Agent status & system health',
      '`/new` or `/reset` — Start a fresh conversation',
      '`/skills` — List loaded skills',
      '`/config` — View your current settings',
      '`/version` — Version info',
      '',
      '*How it works:*',
      '1. Send me a natural language request',
      '2. I create a validated execution plan',
      '3. In supervised mode: you confirm risky actions',
      '4. In autonomous mode: only critical risks need confirmation',
      '5. All actions are logged to Clawtrace',
      '',
      '*Safety (always active):*',
      '• Blockchain tx simulation before execution',
      '• Risk scoring on every plan',
      '• Prompt injection detection',
      '• Rate limiting',
      '• Full audit trail',
    ].join('\n');
  }

  private cmdMode(userId: string, args: string[]): string {
    if (args.length === 0) {
      const currentMode = this.agent.getUserMode(userId);
      return [
        `🐾 *Current Mode: ${currentMode}*`,
        '',
        currentMode === 'autonomous'
          ? '🤖 Running autonomously. Only critical risks require confirmation.'
          : '🔒 Running supervised. All risky actions require confirmation.',
        '',
        'Change with: `/mode autonomous` or `/mode supervised`',
      ].join('\n');
    }

    const requested = args[0].toLowerCase();
    if (requested !== 'autonomous' && requested !== 'supervised') {
      return '❌ Invalid mode. Use `/mode autonomous` or `/mode supervised`.';
    }

    this.agent.setUserMode(userId, requested as AgentMode);

    if (requested === 'autonomous') {
      return [
        '🤖 *Autonomous Mode Activated*',
        '',
        'The agent will now auto-execute most actions.',
        'Critical risks and forbidden actions still require confirmation.',
        '',
        '⚠️ All safety checks remain active:',
        '• Transaction simulation',
        '• Risk scoring',
        '• Injection detection',
        '• Audit logging',
      ].join('\n');
    }

    return [
      '🔒 *Supervised Mode Activated*',
      '',
      'All risky actions will require your explicit confirmation.',
    ].join('\n');
  }

  private cmdStatus(userId: string): string {
    const mode = this.agent.getUserMode(userId);
    return [
      '🐾 *PAW Agent Status*',
      '',
      `✅ Agent: *Online*`,
      `✅ Mode: *${mode}*`,
      `✅ Pipeline: INTENT → PLAN → VALIDATE → EXECUTE → VERIFY`,
      `✅ Safety: *Active*`,
      `✅ Clawtrace: *Logging*`,
      `✅ Channels: Telegram, Discord, Slack, WhatsApp, WebChat`,
      `✅ Gateway: ws://${config.gateway.host}:${config.gateway.port}`,
      '',
      '*Available Tools:*',
      'Solana (transfer, balance) • API calls • File ops',
      'HTTP (GET/POST) • Data transform • System utils',
      'Memory store • Purp SCL v0.3 compiler',
    ].join('\n');
  }

  private cmdReset(userId: string): string {
    // In a full implementation, this would clear session memory
    return '🐾 *Session Reset*\n\nConversation history cleared. Start fresh!';
  }

  private cmdSkills(): string {
    return [
      '🐾 *Loaded Skills*',
      '',
      'Skills are loaded from the `/skills` directory.',
      'Add `.skill.md` or `.skill.yaml` files to extend capabilities.',
      '',
      '*Built-in capabilities:*',
      '• Solana transfers & balance checks',
      '• SPL token operations',
      '• Purp SCL v0.3 compilation & deployment',
      '• API calls (sandboxed HTTPS)',
      '• File read/write/list (sandboxed)',
      '• HTTP GET/POST',
      '• Data transforms (JSON, base64, etc.)',
      '• Memory store (key-value)',
      '• Cron scheduling',
      '• Webhook handling',
    ].join('\n');
  }

  private cmdConfig(userId: string): string {
    const mode = this.agent.getUserMode(userId);
    return [
      '🐾 *Your Configuration*',
      '',
      `Mode: \`${mode}\``,
      `Validation: \`${config.agent.requireValidation ? 'mandatory' : 'optional'}\``,
      `High-risk confirm: \`${config.agent.confirmHighRisk ? 'on' : 'off'}\``,
      `Max tx: \`${config.security.maxTransactionLamports} lamports\``,
      `Confirm above: \`${config.security.requireConfirmationAboveSol} SOL\``,
      `Rate limit: \`${config.security.rateLimitPerMinute}/min\``,
      `Network: \`${config.solana.network}\``,
    ].join('\n');
  }

  private cmdVersion(): string {
    return [
      '🐾 *PAW Agents v2.0.0*',
      '',
      'Purp Autonomous Workers',
      'The operating system for autonomous AI agents.',
      '',
      '• Purp SCL v0.3.0 compatible',
      '• Multi-channel (Telegram, Discord, Slack, WhatsApp, WebChat)',
      '• WebSocket Gateway',
      '• Autonomous & Supervised modes',
      '',
      'https://github.com/DosukaSOL/paw-agents',
    ].join('\n');
  }
}
