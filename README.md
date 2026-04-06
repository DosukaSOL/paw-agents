<p align="center">
  <img src="assets/logo.png" alt="PAW Agents" width="180" />
</p>

<h1 align="center">PAW Agents</h1>

<p align="center">
  <strong>The operating system for autonomous AI agents.</strong><br>
  Multi-channel · Multi-model · Solana-native · Purp SCL v0.3
</p>

<p align="center">
  <a href="https://github.com/DosukaSOL/paw-agents/releases"><img src="https://img.shields.io/badge/version-2.0.0-blue?style=flat-square" alt="Version" /></a>
  <a href="https://github.com/DosukaSOL/paw-agents/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.6-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://solana.com"><img src="https://img.shields.io/badge/Solana-native-purple?style=flat-square&logo=solana&logoColor=white" alt="Solana" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#channels">Channels</a> ·
  <a href="#autonomous-mode">Autonomous Mode</a> ·
  <a href="#purp-scl">Purp SCL</a> ·
  <a href="#safety">Safety</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

---

## What is PAW?

**PAW Agents** (Purp Autonomous Workers) is a production-grade autonomous AI agent system that converts natural language into safe, validated, traceable actions across **Solana**, **APIs**, **files**, and the **Purp ecosystem**.

Every action follows a strict pipeline:

```
INTENT → PLAN → VALIDATE → EXECUTE → VERIFY → LOG
```

Choose your mode:
- 🔒 **Supervised** — Review and confirm all risky actions (default)
- 🤖 **Autonomous** — Agent auto-executes, confirms only critical risks

```
You : "Send 0.5 SOL to GkXn..."
PAW : ⚠️ This action requires confirmation:
      Intent: Transfer 0.5 SOL
      Steps:
        1. Validate recipient address
        2. Check sender balance
        3. Simulate transaction
        4. Execute transfer
      Risk score: 35/100
      Reply "yes" to confirm.
You : "yes"
PAW : ✅ Done: Transfer 0.5 SOL
        ✓ Step 1: Address validated
        ✓ Step 2: Balance sufficient
        ✓ Step 3: Simulation passed
        ✓ Step 4: Transfer complete (sig: 4xR7...)
      ⏱ Completed in 2340ms
```

---

<a id="quick-start"></a>
## Quick Start

```bash
git clone https://github.com/DosukaSOL/paw-agents.git
cd paw-agents
npm install
cp .env.example .env   # Edit with your tokens and API keys
npm run build
npm start
```

### Requirements
- **Node.js 20+**
- At least one AI API key (OpenAI or Anthropic)
- At least one channel token (Telegram, Discord, Slack, or use WebChat)

---

<a id="features"></a>
## Feature Overview

| Category | Capabilities |
|----------|-------------|
| **Agent Modes** | Autonomous / Supervised toggle per user. Validation pipeline configurable. |
| **Channels** | Telegram, Discord, Slack, WhatsApp, WebChat (browser), Webhooks |
| **Models** | OpenAI (GPT-4o), Anthropic (Claude) with automatic failover |
| **Blockchain** | Solana transfers, balance checks, SPL tokens, tx simulation |
| **Purp SCL** | v0.3.0 parser, Anchor Rust codegen, TypeScript SDK generation |
| **Tools** | HTTP, file ops, data transforms, memory store, cron, webhooks |
| **Safety** | Prompt injection (15+ patterns), rate limiting, risk scoring, sandboxing |
| **Keys** | AES-256-GCM encryption, Ed25519 signing, zeroed after use |
| **Logging** | Clawtrace JSONL audit trail, auto-redacted secrets |
| **Recovery** | Self-healing: diagnose → fix → retry → escalate |
| **Gateway** | WebSocket control plane with auth, health checks, broadcast |
| **Commands** | `/mode`, `/status`, `/skills`, `/config`, `/help`, `/new`, `/version` |
| **Extensibility** | Skill files (`.skill.md`), custom tool registration, plugin-ready |

---

<a id="channels"></a>
## Multi-Channel Support

PAW connects to users wherever they are. Configure one or all:

| Channel | Setup | Protocol |
|---------|-------|----------|
| **Telegram** | `TELEGRAM_BOT_TOKEN` | Telegraf (long polling) |
| **Discord** | `DISCORD_BOT_TOKEN` | discord.js (gateway) |
| **Slack** | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | Bolt (socket mode) |
| **WhatsApp** | QR code pairing | Baileys (multi-device) |
| **WebChat** | Built-in via Gateway | WebSocket |
| **Webhooks** | `POST /webhook/:id` | HTTP |

All channels share the same agent brain, tools, and safety pipeline. Channel adapters are loaded dynamically — install only what you need.

---

<a id="autonomous-mode"></a>
## Autonomous Mode

The validation pipeline is **always active** — but the confirmation gate is configurable.

```
/mode autonomous    → Auto-execute, confirm only critical risks
/mode supervised    → Confirm all risky actions (default)
```

### How It Works

| Risk Level | Supervised | Autonomous |
|------------|-----------|------------|
| Low | ✅ Auto | ✅ Auto |
| Medium | ⚠️ Confirm | ✅ Auto |
| High | ⚠️ Confirm | ⚠️ Confirm* |
| Critical | 🛑 Confirm | 🛑 Confirm |

\* High-risk confirmation in autonomous mode is controlled by `CONFIRM_HIGH_RISK=true|false`

**What's always enforced regardless of mode:**
- Schema validation
- Forbidden action blocking
- Transaction simulation
- Prompt injection detection
- Rate limiting
- Full Clawtrace logging

```env
AGENT_MODE=autonomous        # Default mode for new users
REQUIRE_VALIDATION=true      # Can't be turned off — safety always on
CONFIRM_HIGH_RISK=true       # Confirm high-risk even in autonomous mode
```

---

<a id="purp-scl"></a>
## Purp SCL v0.3 Integration

PAW ships with a full Purp Smart Contract Language v0.3.0 integration:

### Native `.purp` Syntax

```purp
program TokenVault {
}

account VaultState {
  owner: pubkey
  balance: u64
  is_locked: bool
}

instruction Deposit {
  accounts:
    #[mut] vault_state
    #[signer] depositor
  args:
    amount: u64
  body:
    require(amount > 0, InsufficientFunds)
    vault_state.balance += amount
    emit(DepositMade, { depositor: depositor.key, amount: amount })
}

event DepositMade {
  depositor: pubkey
  amount: u64
}

error VaultErrors {
  InsufficientFunds = "Not enough funds"
  Unauthorized = "Only the owner can do this"
}
```

### Compiler Pipeline

```
.purp source → Parse → Validate → Anchor Rust → TypeScript SDK
```

- **Types**: `u8`–`u128`, `i8`–`i128`, `f32`, `f64`, `bool`, `string`, `pubkey`, `bytes`
- **Blocks**: `program`, `account`, `instruction`, `event`, `error`, `client`, `frontend`
- **Output**: Anchor-compatible Rust + ready-to-use TypeScript SDK
- **Backward compatible** with legacy JSON Purp format

### Purp.toml Support

```toml
[package]
name = "my-dapp"
version = "0.1.0"

[dependencies]
spl-token = "0.4"
```

---

## How It Works

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  INTENT  │ → │   PLAN   │ → │ VALIDATE │ → │ EXECUTE  │ → │  VERIFY  │ → │   LOG    │
│          │   │          │   │          │   │          │   │          │   │          │
│ Sanitize │   │ LLM gen  │   │ Schema   │   │ Solana   │   │ Confirm  │   │ Claw-    │
│ Rate lim │   │ Strict   │   │ Safety   │   │ Purp     │   │ Heal     │   │ trace    │
│ Inject   │   │ JSON     │   │ Simulate │   │ API/File │   │ Report   │   │ Redact   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

### Key Principles
- **LLM = reasoning only.** Generates plans, never executes code.
- **System = execution only.** Runs validated plans, never reasons.
- **Everything is logged.** Full Clawtrace audit trail.
- **Self-healing.** Failures → diagnose → fix → retry → escalate.

---

<a id="safety"></a>
## Safety Guarantees

| Layer | Protection |
|-------|-----------|
| **Input** | HTML stripping, injection detection (15+ patterns), length limits |
| **Planning** | LLM never executes — produces strict JSON only |
| **Validation** | Schema + logic + safety policy + blockchain simulation |
| **Keys** | AES-256-GCM encrypted at rest, zeroed after use, never logged |
| **Execution** | Sandboxed — Purp whitelist, file sandbox, HTTPS-only APIs, blocked internal IPs |
| **Blockchain** | Mandatory simulation, risk scoring, confirmation gate |
| **Logging** | All secrets auto-redacted from Clawtrace |
| **Recovery** | Self-healing: diagnose → fix → retry → escalate |
| **Rate Limit** | Per-user token bucket with configurable limits |

See [Security Model](docs/SECURITY.md) for the full threat model.

---

## Built-in Tools

| Tool | Description | Safety |
|------|------------|--------|
| `solana_transfer` | Transfer SOL between wallets | Simulation + confirmation |
| `solana_balance` | Check wallet balance | Read-only |
| `api_call` / `http_get` / `http_post` | Call external APIs | HTTPS-only, no internal IPs |
| `file_read` / `file_write` / `file_list` | File operations | Sandboxed to `data/` directory |
| `data_transform` | JSON, base64, case transforms | Pure functions |
| `data_filter` | Filter arrays by field/value | Pure functions |
| `memory_set` / `memory_get` | Key-value memory store | In-process, scoped |
| `system_time` | Current UTC time | Read-only |
| `purp_compile` | Compile Purp SCL programs | Validated output |

Register custom tools:
```typescript
agent.registerTool('my_tool', async (params) => {
  return { result: 'done' };
});
```

---

## Chat Commands

Available across all channels:

| Command | Description |
|---------|------------|
| `/start` | Welcome message |
| `/help` | Command reference |
| `/mode [autonomous\|supervised]` | View or switch agent mode |
| `/status` | System health and current settings |
| `/new` / `/reset` | Clear conversation |
| `/skills` | List loaded skills |
| `/config` | View your configuration |
| `/version` | Version info |

---

## WebSocket Gateway

Real-time control plane for browser UIs and external integrations.

```
ws://127.0.0.1:18789
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|------------|
| `/health` | GET | Health check + uptime |
| `/api/status` | GET | Agent status, channels, mode |
| `/webhook/:id` | POST | Trigger webhook actions |
| `ws://` | WebSocket | Real-time agent communication |

### WebSocket Protocol

```json
// Send a message
{ "type": "message", "channel": "webchat", "from": "user", "payload": "Check my balance" }

// Set mode
{ "type": "command", "payload": { "command": "set_mode", "mode": "autonomous" } }

// Receive response
{ "type": "response", "from": "agent", "payload": { "success": true, "message": "..." } }
```

---

## Skills

Extend PAW with `.skill.md` files:

```yaml
---
metadata:
  name: solana-balance
  version: "1.0.0"
  description: Check SOL balance of any wallet
  category: blockchain

capability:
  purpose: Query Solana wallet balance
  actions: [check_balance, get_balance]

input_schema:
  - name: address
    type: string
    required: true

safety:
  forbidden_actions: [transfer, sign_transaction]
  rate_limit_per_minute: 60
---
```

Skills are validated at startup. Invalid skills are rejected entirely.

See [skills/examples/](skills/examples/) for working examples.

---

## Project Structure

```
paw-agents/
├── src/
│   ├── index.ts                    # Entry point (multi-channel boot)
│   ├── agent/
│   │   ├── brain.ts                # LLM → structured plan
│   │   └── loop.ts                 # Main agent orchestrator
│   ├── core/
│   │   ├── types.ts                # All type definitions
│   │   └── config.ts               # Configuration loader
│   ├── models/
│   │   └── router.ts               # Multi-model with failover
│   ├── gateway/
│   │   └── index.ts                # WebSocket gateway
│   ├── commands/
│   │   └── index.ts                # Chat command handler
│   ├── memory/
│   │   └── index.ts                # Multi-scope memory system
│   ├── cron/
│   │   └── index.ts                # Cron scheduler + webhooks
│   ├── skills/
│   │   └── engine.ts               # Skill parser & validator
│   ├── validation/
│   │   └── engine.ts               # Plan validation & safety
│   ├── execution/
│   │   └── engine.ts               # Plan executor + 15 tools
│   ├── integrations/
│   │   ├── telegram/bot.ts         # Telegram adapter
│   │   ├── discord/adapter.ts      # Discord adapter
│   │   ├── slack/adapter.ts        # Slack adapter
│   │   ├── whatsapp/adapter.ts     # WhatsApp adapter
│   │   ├── webchat/adapter.ts      # WebChat adapter
│   │   ├── solana/executor.ts      # Blockchain execution
│   │   └── purp/engine.ts          # Purp SCL v0.3 engine
│   ├── security/
│   │   ├── sanitizer.ts            # Input sanitization
│   │   ├── keystore.ts             # AES-256-GCM keys
│   │   └── rate-limiter.ts         # Rate limiting
│   ├── clawtrace/
│   │   └── index.ts                # JSONL audit logger
│   └── self-healing/
│       └── index.ts                # Failure recovery
├── skills/examples/                # Example skill definitions
├── tests/system.test.ts            # 53 tests
├── docs/                           # Architecture, security, spec
└── .env.example                    # Configuration template
```

---

## Multi-Model Support

| Provider | Models | Failover |
|----------|--------|----------|
| **OpenAI** | GPT-4o, GPT-4 Turbo | ✅ Primary → Anthropic |
| **Anthropic** | Claude Sonnet 4 | ✅ Primary → OpenAI |

```env
DEFAULT_MODEL_PROVIDER=openai
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Clawtrace Logging

Every action is logged in structured JSONL with auto-redacted secrets:

```json
{
  "trace_id": "abc-123",
  "session_id": "sess-456",
  "timestamp": "2026-04-06T12:00:00Z",
  "phase": "execution",
  "plan": { "intent": "Transfer 0.5 SOL" },
  "execution": { "success": true, "duration_ms": 1200 },
  "metadata": {}
}
```

---

## Example Workflows

### Check Balance
```
"What's the balance of GkXn5M4qR..."
→ 1 step (read-only) → No confirmation → 12.5 SOL
```

### Transfer SOL
```
"Send 1 SOL to 7Yh2..."
→ 4 steps → ⚠️ Confirmation (risk: 35) → Execute → Done
```

### Deploy Purp Contract
```
"Compile and deploy my token vault"
→ Parse .purp → Validate → Generate Rust + SDK → Deploy → Done
```

### Schedule a Task
```
"Check SOL price every 5 minutes"
→ Cron task created → Runs automatically → Results logged
```

### Autonomous Mode
```
/mode autonomous
"Get the latest SOL price and save to a file"
→ 2 steps (low risk) → Auto-executed → Done in 800ms
```

---

## Why PAW?

| Feature | PAW Agents | Typical Agent Frameworks |
|---------|-----------|-------------------------|
| Validation pipeline | ✅ Always on | ❌ Execute directly |
| Autonomous + Supervised modes | ✅ Per-user toggle | ❌ One mode only |
| Multi-channel | ✅ 6 channels | ⚠️ Usually 1 |
| Blockchain simulation | ✅ Before every tx | ❌ |
| Purp SCL integration | ✅ v0.3 compiler | ❌ |
| Encrypted key management | ✅ AES-256-GCM | ❌ Plaintext keys |
| Prompt injection defense | ✅ 15+ patterns | ❌ |
| WebSocket gateway | ✅ Auth + broadcast | ❌ |
| Self-healing | ✅ Diagnose → fix → retry | ❌ Basic retry |
| Full audit trail | ✅ Clawtrace | ⚠️ Minimal |
| 53 automated tests | ✅ | ⚠️ Varies |

---

## Contributing

1. Fork the repo
2. Create a skill in `skills/` following the [spec](docs/SKILL_SPEC.md)
3. Add tests
4. Submit a PR

---

## License

MIT

---

<p align="center">
  <strong>🐾 PAW Agents v2.0</strong><br>
  <em>The operating system for autonomous AI agents.</em><br><br>
  Built for the <a href="https://github.com/DosukaSOL/purp-scl">Purp</a> ecosystem on <a href="https://solana.com">Solana</a>.
</p>
