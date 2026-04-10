# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         INTERFACE LAYER (21+ Channels)                  │
│  Telegram · Discord · Slack · WhatsApp · Email · SMS · WebChat · LINE  │
│  Reddit · Matrix · Twitter/X · GitHub · Notion · Calendar · Desktop    │
│  REST API · MQTT · RSS · Voice · Browser Extension · VS Code           │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          GATEWAY LAYER                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐                │
│  │ WS Gateway    │  │ MCP Server    │  │ REST API    │                │
│  │ (auth, stream)│  │ (JSON-RPC 2.0)│  │ (HTTP)      │                │
│  └───────────────┘  └───────────────┘  └─────────────┘                │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          SECURITY GATE                                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐                │
│  │ Sanitizer│  │ Rate Limiter │  │ Injection Defense │                │
│  └──────────┘  └──────────────┘  └───────────────────┘                │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           AGENT BRAIN                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Model Router │  │ Skill Engine │  │ Plan Builder │  │ Thinking  │ │
│  │ (9 providers)│  │ (skill.md)   │  │ (Strict JSON)│  │ (CoT)     │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └───────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │ User Profiler│  │ RAG Engine   │  │ Branching    │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       VALIDATION ENGINE                                 │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌─────────────────────┐ │
│  │ Schema   │  │ Safety   │  │ Blockchain │  │ Confirmation Gate   │ │
│  │ Check    │  │ Policy   │  │ Simulation │  │ (per mode)          │ │
│  └──────────┘  └──────────┘  └────────────┘  └─────────────────────┘ │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       EXECUTION ENGINE                                  │
│  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐│
│  │ Solana   │  │ Purp     │  │ JS      │  │ API     │  │ Browser  ││
│  │ Executor │  │ Engine   │  │ Sandbox │  │ Caller  │  │ Engine   ││
│  └──────────┘  └──────────┘  └─────────┘  └─────────┘  └──────────┘│
│  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐              │
│  │ MCP      │  │ Workflows│  │ Vector  │  │ DeFi    │              │
│  │ Client   │  │ (DAG)    │  │ Memory  │  │ Engine  │              │
│  └──────────┘  └──────────┘  └─────────┘  └─────────┘              │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     SELF-HEALING SYSTEM                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                             │
│  │ Diagnose │  │ Fix      │  │ Retry /  │                             │
│  │          │  │          │  │ Escalate │                             │
│  └──────────┘  └──────────┘  └──────────┘                             │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐    │
│  │ Trace Logger │  │ Mission Ctrl  │  │ Cross-App Sync           │    │
│  │ (full audit) │  │ (metrics, UI) │  │ (sessions, actions)      │    │
│  └──────────────┘  └───────────────┘  └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Execution Pipeline

Every action follows this strict pipeline with NO exceptions:

```
INTENT → PLAN → VALIDATION → EXECUTION → VERIFICATION
```

1. **Intent**: User sends natural language message via any of 21+ channels
2. **Plan**: LLM generates structured JSON plan (reasoning only)
3. **Validation**: Schema + logic + safety policy + blockchain simulation
4. **Execution**: System executes validated plan (execution only)
5. **Verification**: Results verified, logged, and reported

## Key Principles

- **LLM = reasoning only** — never executes actions directly
- **System = execution only** — only runs validated plans
- **All blockchain txs simulated first** — no blind execution
- **Keys encrypted at rest** — never exposed to LLM or logs
- **Everything logged** — full audit trail with sensitive data scrubbing
- **Self-healing** — diagnose, fix, retry, escalate

## Module Dependency Graph

```
index.ts
  └── agent/loop.ts (PawAgent)
        ├── agent/brain.ts (AgentBrain)
        │     └── models/router.ts (ModelRouter — 9 providers + failover)
        ├── skills/engine.ts (SkillEngine)
        ├── validation/engine.ts (ValidationEngine)
        ├── execution/engine.ts (ExecutionEngine)
        │     ├── integrations/solana/executor.ts
        │     ├── integrations/purp/engine.ts (Purp SCL v1.2.1)
        │     ├── browser/index.ts (BrowserEngine — Playwright)
        │     ├── orchestrator/index.ts (AgentOrchestrator)
        │     ├── vector-memory/index.ts (VectorMemory — cosine similarity)
        │     ├── mcp/index.ts (MCPClient)
        │     ├── workflow/index.ts (WorkflowEngine)
        │     ├── simulation/index.ts (TransactionSimulator)
        │     └── defi/engine.ts (DeFiEngine)
        ├── intelligence/profiler.ts (UserProfiler)
        ├── intelligence/rag.ts (RAGEngine)
        ├── intelligence/branching.ts (ConversationBranching)
        ├── trace/index.ts (TraceLogger)
        ├── security/sanitizer.ts
        ├── security/rate-limiter.ts
        └── self-healing/index.ts

  ├── gateway/index.ts (PawGateway — WS + HTTP + webhooks)
  ├── mcp/server.ts (PawMCPServer — JSON-RPC 2.0)
  ├── crews/engine.ts (CrewEngine — sequential/parallel/hierarchical)
  ├── research/engine.ts (ResearchEngine — multi-step web research)
  ├── thinking/engine.ts (ThinkingEngine — extended CoT)
  ├── sandbox/executor.ts (SandboxExecutor — isolated JS execution)
  ├── workflows/graph.ts (WorkflowGraphEngine — DAG + events)
  ├── plugins/manager.ts (PluginManager — discovery/loading/lifecycle)
  ├── daemon/index.ts (pawDaemon — scheduler, watchers, notifications)
  ├── voice/voice-agent.ts (VoiceAgent — 5 STT + 5 TTS)
  ├── browser/live-browser.ts (LiveBrowser — headed Playwright)
  ├── streaming/index.ts (StreamingEngine — all providers)
  ├── sync/cross-app.ts (CrossAppSync)
  ├── mission-control/index.ts (MissionControl — metrics + UI)
  └── cron/index.ts (CronEngine)
```
