# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    INTERFACE LAYER                       │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Telegram    │  │  Future:     │  │  Future:      │  │
│  │  Bot         │  │  Discord     │  │  REST API     │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼────────────────┼──────────────────┼───────────┘
          │                │                  │
          ▼                ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│                   SECURITY GATE                          │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Sanitizer│  │ Rate Limiter │  │ Injection Defense │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    AGENT BRAIN                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Model Router │  │ Skill Engine │  │ Plan Builder  │  │
│  │ (Multi-LLM)  │  │ (skill.md)   │  │ (Strict JSON) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  VALIDATION ENGINE                       │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐            │
│  │ Schema   │  │ Safety   │  │ Blockchain │            │
│  │ Check    │  │ Policy   │  │ Simulation │            │
│  └──────────┘  └──────────┘  └────────────┘            │
└─────────────────────────┬───────────────────────────────┘
                          │
                    ┌─────┴─────┐
                    │CONFIRMATION│ (if required)
                    │   GATE     │
                    └─────┬─────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  EXECUTION ENGINE                        │
│  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Solana   │  │ Purp     │  │ JS      │  │ API     │ │
│  │ Executor │  │ Engine   │  │ Tools   │  │ Caller  │ │
│  └──────────┘  └──────────┘  └─────────┘  └─────────┘ │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│               SELF-HEALING SYSTEM                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Diagnose │  │ Fix      │  │ Retry /  │              │
│  │          │  │          │  │ Escalate │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    CLAWTRACE                             │
│           Full reasoning trace logger                    │
│     Input → Plan → Validation → Execution → Result      │
└─────────────────────────────────────────────────────────┘
```

## Execution Pipeline

Every action follows this strict pipeline with NO exceptions:

```
INTENT → PLAN → VALIDATION → EXECUTION → VERIFICATION
```

1. **Intent**: User sends natural language message
2. **Plan**: LLM generates structured JSON plan (reasoning only)
3. **Validation**: Schema + logic + safety policy + blockchain simulation
4. **Execution**: System executes validated plan (execution only)
5. **Verification**: Results verified, logged, and reported

## Key Principles

- **LLM = reasoning only** — never executes actions directly
- **System = execution only** — only runs validated plans
- **All blockchain txs simulated first** — no blind execution
- **Keys encrypted at rest** — never exposed to LLM or logs
- **Everything logged** — full Clawtrace audit trail
- **Self-healing** — diagnose, fix, retry, escalate

## Module Dependency Graph

```
index.ts
  └── agent/loop.ts (PawAgent)
        ├── agent/brain.ts (AgentBrain)
        │     └── models/router.ts (ModelRouter)
        ├── skills/engine.ts (SkillEngine)
        ├── validation/engine.ts (ValidationEngine)
        ├── execution/engine.ts (ExecutionEngine)
        │     ├── integrations/solana/executor.ts
        │     └── integrations/purp/engine.ts
        ├── clawtrace/index.ts (Clawtrace)
        ├── security/sanitizer.ts
        ├── security/rate-limiter.ts
        └── self-healing/index.ts
```
