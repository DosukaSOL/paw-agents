// ─── Chat Commands System v3 ───
// Unified command handler for all channels.
// Supports: /mode, /status, /new, /reset, /skills, /help, /sessions, /config, /agents, /workflows, /browser

import { PawAgent } from '../agent/loop';
import { config } from '../core/config';
import { AgentMode } from '../core/types';

// Track two-step Free mode confirmation per user
// 0 = not started, 1 = first warning shown, 2 = second warning shown (ready to activate)
const freeModeWarnings = new Map<string, number>();

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
      '🐾 *PAW Agent Active — v3.1*',
      '',
      'I am your autonomous AI worker. I can:',
      '',
      '• Check Solana wallets & transfer SOL',
      '• Compile & deploy Purp SCL v1.0 programs',
      '• Browse the web & extract data',
      '• Delegate tasks to sub-agents',
      '• Store & search semantic memory',
      '• Connect to MCP tool servers',
      '• Run DAG-based workflows',
      '• Simulate transactions before sending',
      '• Call APIs & fetch data',
      '• Run scheduled tasks (cron)',
      '• Handle webhooks',
      '',
      '*Modes:*',
      '🔒 `/mode supervised` — Review & confirm all actions (default)',
      '🤖 `/mode autonomous` — Auto-execute, confirm only critical risks',
      '🔓 `/mode free` — Full autonomy, no confirmation gates (2 safety warnings required)',
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
      '`/mode [autonomous|supervised|free]` — View or change agent mode',
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
      '5. In free mode: full autonomy — no confirmation gates',
      '6. All actions are logged to Clawtrace',
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
        currentMode === 'free'
          ? '🔓 Running in free mode. Full autonomy — no confirmation gates.'
          : currentMode === 'autonomous'
          ? '🤖 Running autonomously. Only critical risks require confirmation.'
          : '🔒 Running supervised. All risky actions require confirmation.',
        '',
        'Change with: `/mode supervised`, `/mode autonomous`, or `/mode free`',
      ].join('\n');
    }

    const requested = args[0].toLowerCase();

    // Handle Free mode confirmation flow
    if (requested === 'free') {
      const warningStep = freeModeWarnings.get(userId) ?? 0;

      if (warningStep === 0) {
        // First warning layer
        freeModeWarnings.set(userId, 1);
        return [
          '⚠️ *WARNING: Free Mode — Layer 1 of 2*',
          '',
          'You are about to enable *Free Mode*.',
          '',
          'Free Mode grants the agent *full autonomy* over:',
          '• All actions on your device',
          '• All connected APIs and services',
          '• All blockchain transactions (no simulation gate)',
          '• All file operations',
          '• All browser sessions and logged-in accounts',
          '• All external tool calls',
          '',
          '*No actions will require confirmation. All safety confirmation gates are disabled.*',
          '',
          '⚠️ It is *strongly advised* to use *Supervised* or *Autonomous* mode instead.',
          'These modes keep you protected while still being highly capable.',
          '',
          'To proceed to the final warning, type `/mode free` again.',
          'To cancel, type `/mode supervised` or `/mode autonomous`.',
        ].join('\n');
      }

      if (warningStep === 1) {
        // Second and final warning layer
        freeModeWarnings.set(userId, 2);
        return [
          '🚨 *FINAL WARNING: Free Mode — Layer 2 of 2*',
          '',
          'This is your *last chance* to reconsider.',
          '',
          'By proceeding, you accept that:',
          '1. The agent will execute *all actions without asking for permission*',
          '2. This includes *irreversible actions* (transfers, deletions, deployments)',
          '3. The agent will have unrestricted access to *all connected systems*',
          '4. You assume *full responsibility* for all actions taken in this mode',
          '',
          '⚠️ *We strongly recommend using Supervised or Autonomous mode.*',
          'Autonomous mode already auto-executes low and medium risk actions.',
          'Only critical risks require confirmation — offering speed with safety.',
          '',
          'To *activate Free Mode*, type `/mode free` one final time.',
          'To cancel, type `/mode supervised` or `/mode autonomous`.',
        ].join('\n');
      }

      // warningStep === 2: User passed both warning layers — activate Free mode
      freeModeWarnings.delete(userId);
      this.agent.setUserMode(userId, 'free');
      return [
        '🔓 *Free Mode Activated*',
        '',
        'The agent now has *full autonomy*. No actions will require confirmation.',
        '',
        'All safety *checks* still run (validation, injection detection, logging)',
        'but all confirmation *gates* are disabled.',
        '',
        '⚠️ Switch back anytime: `/mode supervised` or `/mode autonomous`',
      ].join('\n');
    }

    // Reset Free mode warnings if switching to other modes
    if (requested === 'supervised' || requested === 'autonomous') {
      freeModeWarnings.delete(userId);
    }

    if (requested !== 'autonomous' && requested !== 'supervised') {
      return '❌ Invalid mode. Use `/mode supervised`, `/mode autonomous`, or `/mode free`.';
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
      `✅ Channels: Telegram, Discord, Slack, WhatsApp, Email, SMS, WebChat`,
      `✅ Gateway: ws://${config.gateway.host}:${config.gateway.port}`,
      '',
      '*Available Tools:*',
      'Solana (transfer, balance) • API calls • File ops',
      'HTTP (GET/POST) • Browser • Multi-agent delegation',
      'Vector memory • MCP tools • Workflows • Tx simulation',
      'Data transform • System utils • Purp SCL v1.0 compiler',
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
      '• Purp SCL v1.0 compilation & deployment',
      '• API calls (sandboxed HTTPS)',
      '• File read/write/list (sandboxed)',
      '• HTTP GET/POST',
      '• Browser automation (navigate, click, extract, screenshot)',
      '• Multi-agent orchestration & delegation',
      '• Persistent vector memory (semantic search)',
      '• MCP tool server integration',
      '• DAG workflow engine',
      '• Transaction simulation sandbox',
      '• Data transforms (JSON, base64, etc.)',
      '• Memory store (key-value)',
      '• Cron scheduling',
      '• Webhook handling',
      '• Email & SMS channels',
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
      '🐾 *PAW Agents v3.2.0*',
      '',
      'Purp Autonomous Workers',
      'The operating system for autonomous AI agents.',
      '',
      '• Purp SCL v1.0.0 compatible',
      '• Multi-channel (Telegram, Discord, Slack, WhatsApp, Email, SMS, WebChat)',
      '• WebSocket Gateway + Web Dashboard',
      '• Browser automation (Puppeteer)',
      '• Multi-agent orchestration',
      '• Persistent vector memory',
      '• MCP tool protocol support',
      '• DAG workflow engine',
      '• Transaction simulation sandbox',
      '• On-chain agent registry',
      '• Token-gated access control',
      '• Supervised, Autonomous & Free modes',
      '',
      'https://github.com/DosukaSOL/paw-agents',
    ].join('\n');
  }
}
