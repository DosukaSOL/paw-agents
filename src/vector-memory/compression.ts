// ─── Intelligent Memory Compression ───
// Summarizes old vectors using AI to reduce storage while maintaining semantic value.
// Follows claude-mem pattern: compress when memory grows large, aggregate similar concepts.

import { VectorEntry, VectorMemory } from './index';

export interface CompressedMemory {
  id: string;
  summary: string;
  original_count: number;
  original_tokens: number;
  compressed_tokens: number;
  compression_ratio: number;
  merged_entries: string[];
  created_at: string;
  compressed_at: string;
  scope: 'session' | 'user' | 'global';
  namespace: string;
}

export class MemoryCompressionEngine {
  private compressionThreshold = 1000; // Compress when memory > 1000 entries
  private minCompressionSize = 5; // Min entries to compress as a batch
  private compressionHistory: CompressedMemory[] = [];

  constructor(private vectorMemory: VectorMemory, private modelRouter: any) {}

  // ─── Run compression on old entries ───
  async compress(olderThanDays: number = 7): Promise<CompressedMemory[]> {
    const now = Date.now();
    const cutoffTime = now - olderThanDays * 24 * 60 * 60 * 1000;

    // Get old entries
    const oldEntries = this.vectorMemory.getAllEntries()
      .filter(e => new Date(e.created_at).getTime() < cutoffTime)
      .slice(0, 100); // Max 100 at a time to avoid overwhelming the model

    if (oldEntries.length < this.minCompressionSize) {
      return [];
    }

    // Group by namespace for compression
    const groupedByNamespace = new Map<string, VectorEntry[]>();
    for (const entry of oldEntries) {
      if (!groupedByNamespace.has(entry.namespace)) {
        groupedByNamespace.set(entry.namespace, []);
      }
      groupedByNamespace.get(entry.namespace)!.push(entry);
    }

    const compressed: CompressedMemory[] = [];

    // Compress each namespace group
    for (const [namespace, entries] of groupedByNamespace) {
      if (entries.length < this.minCompressionSize) continue;

      try {
        const summary = await this.generateSummary(entries);
        const compressed_entry: CompressedMemory = {
          id: `compressed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          summary,
          original_count: entries.length,
          original_tokens: entries.reduce((sum, e) => sum + (e.text?.split(/\s+/).length ?? 0), 0),
          compressed_tokens: summary.split(/\s+/).length,
          compression_ratio: entries.length / 1, // Represents reduction factor
          merged_entries: entries.map(e => e.id),
          created_at: entries[0].created_at,
          compressed_at: new Date().toISOString(),
          scope: entries[0].scope,
          namespace,
        };

        compressed.push(compressed_entry);
        this.compressionHistory.push(compressed_entry);

        // Archive original entries (mark them as archived rather than deleting)
        for (const entry of entries) {
          entry.metadata = entry.metadata || {};
          (entry.metadata as any).archived = true;
          (entry.metadata as any).archived_by = compressed_entry.id;
        }
      } catch (err) {
        console.error(`[MemoryCompression] Failed to compress ${namespace}:`, (err as Error).message);
      }
    }

    return compressed;
  }

  // ─── Generate AI-powered summary ───
  private async generateSummary(entries: VectorEntry[]): Promise<string> {
    const textsToSummarize = entries.map(e => e.text).join('\n---\n');
    const prompt = `Provide a concise 1-2 sentence summary of these memories, capturing the key themes and important details:

${textsToSummarize}

Summary:`;

    try {
      const summary = await this.modelRouter.generate(
        'You are a memory compression assistant. Summarize memories efficiently while preserving semantic meaning.',
        prompt,
      );
      return summary.trim();
    } catch (err) {
      // Fallback: simple extractive summary
      console.warn('[MemoryCompression] AI summary failed, using fallback');
      return entries.slice(0, 3).map(e => e.text).join(' | ');
    }
  }

  // ─── Get compression stats ───
  getStats(): {
    total_compressed: number;
    total_original_entries: number;
    average_compression_ratio: number;
    storage_saved_percent: number;
  } {
    const totalOriginal = this.compressionHistory.reduce((sum, c) => sum + c.original_count, 0);
    const totalCompressed = this.compressionHistory.length;
    const avgRatio = totalOriginal > 0 ? (totalOriginal / (totalCompressed || 1)) : 0;
    const originalTokens = this.compressionHistory.reduce((sum, c) => sum + c.original_tokens, 0);
    const compressedTokens = this.compressionHistory.reduce((sum, c) => sum + c.compressed_tokens, 0);
    const storageSavedPercent = originalTokens > 0 ? ((originalTokens - compressedTokens) / originalTokens) * 100 : 0;

    return {
      total_compressed: totalCompressed,
      total_original_entries: totalOriginal,
      average_compression_ratio: Math.round(avgRatio * 100) / 100,
      storage_saved_percent: Math.round(storageSavedPercent),
    };
  }

  // ─── Get compression history ───
  getHistory(limit: number = 100): CompressedMemory[] {
    return this.compressionHistory.slice(-limit);
  }
}
