// ─── Vector Memory Store ───
// Persistent semantic memory with cosine similarity search.
// Stores text + embeddings, enables cross-session recall.
// Uses local JSON-backed storage with in-memory vector index.

import * as fs from 'fs';
import * as path from 'path';

export interface VectorEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  scope: 'session' | 'user' | 'global';
  namespace: string;
  created_at: string;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number;
}

// ─── Simple text → vector embedding (TF-IDF inspired, no external API needed) ───
function textToVector(text: string, vocabSize: number = 512): number[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const vector = new Array(vocabSize).fill(0);

  for (const word of words) {
    // Simple hash to vector position
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % vocabSize;
    vector[idx] += 1;
  }

  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= magnitude;
    }
  }

  return vector;
}

// ─── Cosine similarity ───
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export class VectorMemory {
  private entries: VectorEntry[] = [];
  private storePath: string;
  private dirty = false;
  private vocabSize: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storePath: string = './data/vector-memory.json', vocabSize: number = 512) {
    this.storePath = path.resolve(storePath);
    this.vocabSize = vocabSize;
    this.load();
  }

  // ─── Add an entry ───
  add(text: string, scope: 'session' | 'user' | 'global', namespace: string, metadata: Record<string, unknown> = {}): VectorEntry {
    const embedding = textToVector(text, this.vocabSize);
    const entry: VectorEntry = {
      id: `vec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      embedding,
      metadata,
      scope,
      namespace,
      created_at: new Date().toISOString(),
    };

    this.entries.push(entry);
    this.dirty = true;
    this.save();
    return entry;
  }

  // ─── Search by semantic similarity ───
  search(query: string, options: { scope?: string; namespace?: string; limit?: number; threshold?: number } = {}): SearchResult[] {
    const queryVec = textToVector(query, this.vocabSize);
    const limit = options.limit ?? 5;
    const threshold = options.threshold ?? 0.1;

    let candidates = this.entries;

    if (options.scope) {
      candidates = candidates.filter(e => e.scope === options.scope);
    }
    if (options.namespace) {
      candidates = candidates.filter(e => e.namespace === options.namespace);
    }

    const scored = candidates.map(entry => ({
      entry,
      score: cosineSimilarity(queryVec, entry.embedding),
    }));

    return scored
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ─── Get entry by ID ───
  get(id: string): VectorEntry | null {
    return this.entries.find(e => e.id === id) ?? null;
  }

  // ─── Delete entry ───
  delete(id: string): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    this.dirty = true;
    this.save();
    return true;
  }

  // ─── Clear scope ───
  clearScope(scope: string, namespace: string): number {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => !(e.scope === scope && e.namespace === namespace));
    const removed = before - this.entries.length;
    if (removed > 0) {
      this.dirty = true;
      this.save();
    }
    return removed;
  }

  // ─── Get all entries ───
  getAllEntries(): VectorEntry[] {
    return [...this.entries];
  }

  // ─── Stats ───
  stats(): { total: number; by_scope: Record<string, number>; storage_bytes: number } {
    const byScope: Record<string, number> = { session: 0, user: 0, global: 0 };
    for (const e of this.entries) {
      byScope[e.scope] = (byScope[e.scope] ?? 0) + 1;
    }
    return {
      total: this.entries.length,
      by_scope: byScope,
      storage_bytes: fs.existsSync(this.storePath) ? fs.statSync(this.storePath).size : 0,
    };
  }

  // ─── Persistence ───
  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
        if (Array.isArray(data)) {
          this.entries = data;
        }
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    if (!this.dirty) return;
    // Debounce: batch writes to max 1x per 5 seconds
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushToDisk();
    }, 5_000);
  }

  private flushToDisk(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = JSON.stringify(this.entries);
      fs.writeFile(this.storePath, data, 'utf-8', (err) => {
        if (err) { /* disk error — memory still works in-process */ }
      });
      this.dirty = false;
    } catch {
      // Silently fail — memory still works in-process
    }
  }
}
