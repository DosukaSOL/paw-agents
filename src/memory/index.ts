// ─── PAW Memory System ───
// Multi-scope key-value memory with TTL support.
// Scopes: session (per conversation), user (per user across sessions), global (shared).

import { MemoryEntry, MemoryScope } from '../core/types';

export class MemorySystem {
  private store = new Map<string, MemoryEntry>();
  private readonly maxEntries = 50_000;

  // Compose a scoped key
  private key(scope: MemoryScope, namespace: string, key: string): string {
    return `${scope}:${namespace}:${key}`;
  }

  // Set a value
  set(scope: MemoryScope, namespace: string, key: string, value: unknown, ttlMs?: number): void {
    const k = this.key(scope, namespace, key);
    // Evict oldest entry if at capacity
    if (this.store.size >= this.maxEntries && !this.store.has(k)) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(k, {
      key,
      value,
      scope,
      created_at: new Date().toISOString(),
      ttl_ms: ttlMs,
    });
  }

  // Get a value (respects TTL)
  get(scope: MemoryScope, namespace: string, key: string): unknown | null {
    const k = this.key(scope, namespace, key);
    const entry = this.store.get(k);
    if (!entry) return null;

    // Check TTL
    if (entry.ttl_ms) {
      const created = new Date(entry.created_at).getTime();
      if (Date.now() - created > entry.ttl_ms) {
        this.store.delete(k);
        return null;
      }
    }

    return entry.value;
  }

  // Check if key exists
  has(scope: MemoryScope, namespace: string, key: string): boolean {
    return this.get(scope, namespace, key) !== null;
  }

  // Delete a specific key
  delete(scope: MemoryScope, namespace: string, key: string): boolean {
    return this.store.delete(this.key(scope, namespace, key));
  }

  // List all entries in a scope+namespace
  list(scope: MemoryScope, namespace: string): MemoryEntry[] {
    const prefix = `${scope}:${namespace}:`;
    const results: MemoryEntry[] = [];

    for (const [k, entry] of this.store) {
      if (!k.startsWith(prefix)) continue;

      // Skip expired
      if (entry.ttl_ms) {
        const created = new Date(entry.created_at).getTime();
        if (Date.now() - created > entry.ttl_ms) {
          this.store.delete(k);
          continue;
        }
      }

      results.push(entry);
    }

    return results;
  }

  // Clear all entries for a scope+namespace (e.g., clear a session)
  clearScope(scope: MemoryScope, namespace: string): number {
    const prefix = `${scope}:${namespace}:`;
    let count = 0;

    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        count++;
      }
    }

    return count;
  }

  // Clear everything (use carefully)
  clearAll(): void {
    this.store.clear();
  }

  // Get memory statistics
  stats(): { total: number; by_scope: Record<string, number> } {
    const byScope: Record<string, number> = { session: 0, user: 0, global: 0 };

    for (const k of this.store.keys()) {
      const scope = k.split(':')[0];
      byScope[scope] = (byScope[scope] ?? 0) + 1;
    }

    return { total: this.store.size, by_scope: byScope };
  }
}

// Singleton instance for global use
export const memory = new MemorySystem();
