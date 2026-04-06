<p align="center">
  <img src="assets/logo.png" alt="PAW Agents" width="200" />
</p>

<h1 align="center">PAW Agents</h1>

<p align="center">
  <strong>The operating system for autonomous AI workers.</strong>
</p>

<p align="center">
  <a href="#install">Install in 2 minutes</a> •
  <a href="#how-it-works">How it works</a> •
  <a href="#skills">Skills</a> •
  <a href="#safety">Safety</a> •
  <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

---

## What is PAW Agents?

PAW Agents (Purp Autonomous Workers) is a production-grade autonomous agent system that converts natural language into safe, validated, traceable actions across Solana, APIs, and the Purp ecosystem.

Every action follows a strict pipeline: **INTENT → PLAN → VALIDATION → EXECUTION → VERIFICATION**. No exceptions.

```
You: "Send 0.5 SOL to GkXn..."
PAW: ⚠️ This action requires confirmation:
     Intent: Transfer 0.5 SOL
     Steps:
       1. Validate recipient address
       2. Check sender balance
       3. Simulate transaction
       4. Execute transfer
     Risk score: 35/100
     Reply "yes" to confirm.
You: "yes"
PAW: ✅ Done: Transfer 0.5 SOL
       ✓ Step 1: Address validated
       ✓ Step 2: Balance sufficient
       ✓ Step 3: Simulation passed
       ✓ Step 4: Transfer complete (sig: 4xR7...)
     ⏱ Completed in 2340ms
```

---

<a id="install"></a>
## Install in 2 Minutes

```bash
# Clone
git clone https://github.com/user/paw-agents.git
cd paw-agents

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env with your Telegram bot token and API keys

# Build
npm run build

# Start
npm start
```

### Requirements
- Node.js 20+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An AI API key (OpenAI or Anthropic)

---

<a id="how-it-works"></a>
## How It Works

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  INTENT  │ → │   PLAN   │ → │ VALIDATE │ → │ EXECUTE  │ → │  VERIFY  │
│          │   │          │   │          │   │          │   │          │
│ Sanitize │   │ LLM gen  │   │ Schema   │   │ Solana   │   │ Confirm  │
│ input    │   │ strict   │   │ Safety   │   │ Purp     │   │ Log      │
│          │   │ JSON     │   │ Simulate │   │ JS/API   │   │ Report   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

### Key Principles
- **LLM = reasoning only.** It generates plans, never executes.
- **System = execution only.** It runs validated plans, never reasons.
- **Everything is logged.** Full Clawtrace audit trail.
- **Self-healing.** Failures are diagnosed, fixed, and retried.

---

<a id="skills"></a>
## Skills

Skills extend what PAW can do. Each skill is a `.skill.md` file with structured YAML frontmatter.

```yaml
---
metadata:
  name: solana-balance
  version: "1.0.0"
  description: Check SOL balance of any wallet
  category: blockchain
  tags: [solana, balance, wallet]

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

Skills are auto-parsed, validated, and registered at startup. Invalid skills are rejected entirely — no partial loading.

See [Skill Spec](docs/SKILL_SPEC.md) for the full specification.

See [skills/examples/](skills/examples/) for working examples.

---

<a id="safety"></a>
## Safety Guarantees

| Layer | Protection |
|-------|-----------|
| **Input** | HTML stripping, injection detection (15+ patterns), length limits |
| **Planning** | LLM never executes — produces strict JSON only |
| **Validation** | Schema + logic + safety policy + blockchain simulation |
| **Keys** | AES-256-GCM encrypted at rest, zeroed after use, never logged |
| **Execution** | Sandboxed — Purp whitelist, JS restricted, HTTPS-only APIs |
| **Blockchain** | Mandatory simulation, risk scoring, confirmation gate |
| **Logging** | All secrets auto-redacted from Clawtrace |
| **Recovery** | Self-healing: diagnose → fix → retry → escalate |

See [Security Model](docs/SECURITY.md) for the full threat model.

---

## Project Structure

```
paw-agents/
├── src/
│   ├── index.ts              # Entry point
│   ├── agent/
│   │   ├── brain.ts          # LLM → structured plan
│   │   └── loop.ts           # Main agent orchestrator
│   ├── core/
│   │   ├── types.ts          # All type definitions
│   │   └── config.ts         # Configuration loader
│   ├── models/
│   │   └── router.ts         # Multi-model abstraction
│   ├── skills/
│   │   └── engine.ts         # Skill parser & validator
│   ├── validation/
│   │   └── engine.ts         # Plan validation & safety
│   ├── execution/
│   │   └── engine.ts         # Plan executor & rollback
│   ├── integrations/
│   │   ├── telegram/bot.ts   # Telegram interface
│   │   ├── solana/executor.ts # Blockchain execution
│   │   └── purp/engine.ts    # Purp language engine
│   ├── security/
│   │   ├── sanitizer.ts      # Input sanitization
│   │   ├── keystore.ts       # Key encryption
│   │   └── rate-limiter.ts   # Rate limiting
│   ├── clawtrace/
│   │   └── index.ts          # Full reasoning logger
│   └── self-healing/
│       └── index.ts          # Failure diagnosis & recovery
├── skills/
│   └── examples/             # Example skill definitions
├── tests/
│   └── system.test.ts        # Full system tests
├── docs/
│   ├── ARCHITECTURE.md       # System architecture
│   ├── SKILL_SPEC.md         # Skill format spec
│   └── SECURITY.md           # Security model
└── .env.example              # Configuration template
```

---

## Multi-Model Support

PAW supports multiple AI providers with automatic fallback:

| Provider | Models | Status |
|----------|--------|--------|
| OpenAI | GPT-4o, GPT-4 | ✅ Supported |
| Anthropic | Claude Sonnet 4 | ✅ Supported |

Configure in `.env`:
```
DEFAULT_MODEL_PROVIDER=openai
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

If the primary provider fails, PAW automatically falls back to the next available provider.

---

## Clawtrace

Every agent action is fully logged in structured JSONL format:

```json
{
  "trace_id": "abc-123",
  "session_id": "sess-456",
  "timestamp": "2026-04-06T12:00:00Z",
  "phase": "execution",
  "plan": { "...": "..." },
  "execution": { "success": true, "duration_ms": 1200 },
  "metadata": {}
}
```

Sensitive data (keys, tokens, secrets) is automatically redacted before logging.

Logs are stored in `./logs/clawtrace/` as daily JSONL files per session.

---

## Example Workflows

### Check Wallet Balance
```
"What's the balance of GkXn5M4qR..."
→ Plan: 1 step (read-only)
→ No confirmation needed
→ Result: 12.5 SOL
```

### Transfer SOL
```
"Send 1 SOL to 7Yh2..."
→ Plan: 4 steps (validate, check balance, simulate, transfer)
→ ⚠️ Confirmation required (risk: 35/100)
→ User confirms
→ Transaction executed and confirmed
```

### API Query
```
"Get the current SOL price"
→ Plan: 1 step (HTTPS API call)
→ No confirmation needed
→ Result: $150.23
```

---

## Why PAW Agents?

| Feature | PAW Agents | Other Agent Frameworks |
|---------|-----------|----------------------|
| Mandatory validation pipeline | ✅ | ❌ Most execute directly |
| Blockchain simulation before execution | ✅ | ❌ |
| Encrypted key management | ✅ | ❌ Keys often in plaintext |
| Prompt injection defense | ✅ 15+ patterns | ❌ Usually none |
| Full audit trail (Clawtrace) | ✅ | ❌ Minimal logging |
| Self-healing with diagnosis | ✅ | ❌ Basic retry at best |
| Skill-based extensibility | ✅ Validated specs | ⚠️ Unvalidated plugins |
| Multi-model with fallback | ✅ | ⚠️ Usually single provider |
| LLM/Execution separation | ✅ Strict | ❌ LLM often executes |

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
  <strong>🐾 PAW Agents — Purp Autonomous Workers</strong><br>
  The operating system for autonomous AI workers.
</p>
