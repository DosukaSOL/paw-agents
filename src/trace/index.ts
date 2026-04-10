// ─── PAW Trace Logger — Full Agent Reasoning Trace ───
// Logs EVERYTHING: input, reasoning, plan, validation, execution, result.
// Fully structured, fully auditable.

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { TraceEntry, AgentPhase } from '../core/types';
import { config } from '../core/config';

const LOG_DIR = config.trace.logDir;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFilePath(sessionId: string): string {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `${date}_${sessionId}.jsonl`);
}

// Scrub sensitive data before logging
function scrub(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Redact anything that looks like a key, token, or secret
    return data
      .replace(/[1-9A-HJ-NP-Za-km-z]{87,88}/g, '[REDACTED_KEY]')
      .replace(/\b(sk-|pk-|token_|xai-|gsk_|Bearer\s+)[A-Za-z0-9\-_]+/gi, '[REDACTED_TOKEN]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]');
  }
  if (Array.isArray(data)) return data.map(scrub);
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor') continue;
      const lk = key.toLowerCase();
      if (lk.includes('secret') || lk.includes('private') || lk.includes('key') || lk.includes('password') || lk.includes('token') || lk.includes('authorization') || lk.includes('cookie') || lk.includes('credential')) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = scrub(value);
      }
    }
    return result;
  }
  return data;
}

export class TraceLogger {
  private sessionId: string;
  private entries: TraceEntry[] = [];

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? uuid();
    ensureLogDir();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  log(phase: AgentPhase, data: Partial<Omit<TraceEntry, 'trace_id' | 'session_id' | 'timestamp' | 'phase'>>): void {
    const entry: TraceEntry = {
      trace_id: uuid(),
      session_id: this.sessionId,
      timestamp: new Date().toISOString(),
      phase,
      duration_ms: data.duration_ms ?? 0,
      metadata: data.metadata ?? {},
      ...data,
    };

    // Scrub before storing/writing
    const scrubbed = scrub(entry) as TraceEntry;
    this.entries.push(scrubbed);

    // Append to file
    try {
      const filePath = getLogFilePath(this.sessionId);
      fs.appendFileSync(filePath, JSON.stringify(scrubbed) + '\n');
    } catch (err) {
      // Logging failure must not crash the agent
      console.error('[TraceLogger] Write error:', (err as Error).message);
    }
  }

  getEntries(): TraceEntry[] {
    return [...this.entries];
  }

  getTrace(): object {
    return {
      session_id: this.sessionId,
      entry_count: this.entries.length,
      phases: this.entries.map(e => e.phase),
      entries: this.entries,
    };
  }

  // Load a previous session's trace from disk
  static loadSession(sessionId: string): TraceEntry[] {
    ensureLogDir();
    const entries: TraceEntry[] = [];
    const files = fs.readdirSync(LOG_DIR).filter(f => f.includes(sessionId));
    for (const file of files) {
      const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // Skip malformed entries
        }
      }
    }
    return entries;
  }
}
