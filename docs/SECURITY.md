# Security Model

## Threat Model

PAW Agents assumes:
- All user input is adversarial
- LLM outputs are untrusted
- Network connections may be intercepted
- Skills from third parties may be malicious

## Defense Layers

### 1. Input Sanitization
- HTML stripping
- Control character removal
- Length truncation (4096 chars max)
- Prompt injection pattern detection (15+ patterns)

### 2. Prompt Injection Defense
Detects and blocks:
- "Ignore previous instructions"
- "You are now..." role overrides
- "Act as..." jailbreaks
- DAN-mode attempts
- Secret/key extraction attempts
- Template injection (`${...}`, `{{...}}`)
- Script injection (`<script>`)

### 3. Plan Validation
- Schema validation (all required fields present)
- Logic validation (step ordering, tool declarations)
- Safety policy enforcement (forbidden actions, limits)
- Risk scoring (0-100 scale)
- Blockchain simulation (before execution)

### 4. Key Security
- AES-256-GCM encryption at rest
- PBKDF2 key derivation (100,000 iterations)
- Keys decrypted only during signing, zeroed immediately
- Never exposed to LLM, logs, or trace output

### 5. Execution Sandbox
- Purp programs validated against instruction whitelist
- JS tools restricted to registered handlers only
- API calls restricted to HTTPS, no internal IPs
- No arbitrary code execution

### 6. Rate Limiting
- Per-user, per-minute sliding window
- Configurable via environment variables
- Automatic cleanup of stale buckets

### 7. Trace Log Scrubbing
- All keys, tokens, and secrets redacted before logging
- Pattern-based scrubbing (base58 keys, API tokens)
- Field-name-based scrubbing (any field containing "secret", "key", "password", "token")

## Separation of Concerns

```
┌──────────────────────┐     ┌──────────────────────┐
│     LLM (Brain)      │     │   System (Executor)   │
│                      │     │                       │
│  ✅ Reasoning        │     │  ✅ Execution          │
│  ✅ Plan generation  │     │  ✅ Blockchain signing  │
│  ✅ Risk assessment  │     │  ✅ API calls           │
│                      │     │                       │
│  ❌ NO execution     │     │  ❌ NO reasoning        │
│  ❌ NO key access    │     │  ❌ NO plan generation  │
│  ❌ NO direct tools  │     │  ❌ NO LLM calls        │
└──────────────────────┘     └──────────────────────┘
```

## Blockchain Safety

1. **Pre-simulation**: Every transaction simulated before execution
2. **Risk scoring**: Financial risk assessed and scored
3. **Confirmation gate**: High-risk actions require explicit user approval
4. **Amount limits**: Configurable max transaction size
5. **Program whitelist**: Only approved Solana programs
6. **Rollback support**: Failed steps trigger rollback of completed steps
