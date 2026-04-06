// ─── RAG Engine — Retrieval-Augmented Generation ───
// Index user documents, chunk them, embed locally, and retrieve relevant context
// to augment LLM prompts. No external embedding API required.

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../core/config';
import { RAGDocument, RAGChunk, RAGSearchResult } from '../core/types';

// ─── Simple text → vector embedding (TF-IDF inspired, same as vector-memory) ───
function textToVector(text: string, vocabSize: number = 512): number[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const vector = new Array(vocabSize).fill(0);

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % vocabSize;
    vector[idx] += 1;
  }

  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= magnitude;
    }
  }

  return vector;
}

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

export class RAGEngine {
  private documents: RAGDocument[] = [];
  private chunks: RAGChunk[] = [];
  private storePath: string;
  private chunkSize: number;
  private chunkOverlap: number;
  private dirty = false;

  constructor(storePath?: string) {
    this.storePath = path.resolve(storePath ?? config.intelligence.ragStorePath);
    this.chunkSize = config.intelligence.ragChunkSize;
    this.chunkOverlap = config.intelligence.ragChunkOverlap;
    this.ensureDir();
    this.load();
  }

  // ─── Index a document ───
  indexDocument(source: string, content: string, metadata: Record<string, unknown> = {}): RAGDocument {
    // Check for duplicates by source
    const existingIdx = this.documents.findIndex(d => d.source === source);
    if (existingIdx !== -1) {
      // Re-index: remove old document and its chunks
      const oldDoc = this.documents[existingIdx];
      this.chunks = this.chunks.filter(c => c.document_id !== oldDoc.id);
      this.documents.splice(existingIdx, 1);
    }

    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Chunk the content
    const textChunks = this.chunkText(content);
    const ragChunks: RAGChunk[] = textChunks.map((text, idx) => ({
      id: `chunk_${docId}_${idx}`,
      document_id: docId,
      content: text,
      embedding: textToVector(text),
      position: idx,
      metadata: {},
    }));

    const doc: RAGDocument = {
      id: docId,
      source,
      content: content.slice(0, 500), // Store preview only, not full content
      chunk_count: ragChunks.length,
      metadata,
      indexed_at: new Date().toISOString(),
    };

    this.documents.push(doc);
    this.chunks.push(...ragChunks);
    this.dirty = true;
    this.save();

    return doc;
  }

  // ─── Index a file from disk ───
  indexFile(filePath: string, metadata: Record<string, unknown> = {}): RAGDocument | null {
    const resolved = path.resolve(filePath);

    // Safety: only allow text-based files
    const ext = path.extname(resolved).toLowerCase();
    const allowedExts = ['.txt', '.md', '.json', '.csv', '.ts', '.js', '.py', '.yaml', '.yml', '.toml', '.env', '.html', '.css', '.sol', '.rs'];
    if (!allowedExts.includes(ext)) {
      throw new Error(`Unsupported file type: ${ext}. Allowed: ${allowedExts.join(', ')}`);
    }

    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      // Safety: max 1MB per document
      if (content.length > 1_048_576) {
        throw new Error('File too large (max 1MB). Split into smaller files.');
      }
      return this.indexDocument(resolved, content, { ...metadata, file_ext: ext });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw err;
    }
  }

  // ─── Search for relevant chunks ───
  search(query: string, options: { limit?: number; minScore?: number; documentId?: string } = {}): RAGSearchResult[] {
    const limit = options.limit ?? config.intelligence.ragMaxResults;
    const minScore = options.minScore ?? config.intelligence.ragMinScore;
    const queryVec = textToVector(query);

    let candidates = this.chunks;
    if (options.documentId) {
      candidates = candidates.filter(c => c.document_id === options.documentId);
    }

    const scored: RAGSearchResult[] = candidates.map(chunk => {
      const doc = this.documents.find(d => d.id === chunk.document_id);
      return {
        chunk,
        score: cosineSimilarity(queryVec, chunk.embedding),
        document_source: doc?.source ?? 'unknown',
      };
    });

    return scored
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ─── Build RAG context string for LLM prompt augmentation ───
  buildContext(query: string, maxTokenEstimate: number = 2000): string {
    const results = this.search(query);
    if (results.length === 0) return '';

    const contextParts: string[] = [];
    let estimatedTokens = 0;

    for (const result of results) {
      const part = `[Source: ${result.document_source} | Relevance: ${(result.score * 100).toFixed(0)}%]\n${result.chunk.content}`;
      const partTokens = Math.ceil(part.length / 4); // Rough token estimate

      if (estimatedTokens + partTokens > maxTokenEstimate) break;

      contextParts.push(part);
      estimatedTokens += partTokens;
    }

    if (contextParts.length === 0) return '';

    return `\n--- Relevant Context (from user documents) ---\n${contextParts.join('\n\n')}\n--- End Context ---\n`;
  }

  // ─── List indexed documents ───
  listDocuments(): RAGDocument[] {
    return [...this.documents];
  }

  // ─── Remove a document ───
  removeDocument(documentId: string): boolean {
    const idx = this.documents.findIndex(d => d.id === documentId);
    if (idx === -1) return false;

    this.documents.splice(idx, 1);
    this.chunks = this.chunks.filter(c => c.document_id !== documentId);
    this.dirty = true;
    this.save();
    return true;
  }

  // ─── Stats ───
  stats(): { documents: number; chunks: number; storage_bytes: number } {
    const docsPath = path.join(this.storePath, 'documents.json');
    const chunksPath = path.join(this.storePath, 'chunks.json');
    let storageBytes = 0;
    try {
      if (fs.existsSync(docsPath)) storageBytes += fs.statSync(docsPath).size;
      if (fs.existsSync(chunksPath)) storageBytes += fs.statSync(chunksPath).size;
    } catch {
      // ignore
    }
    return {
      documents: this.documents.length,
      chunks: this.chunks.length,
      storage_bytes: storageBytes,
    };
  }

  // ─── Private: Chunk text into overlapping segments ───
  private chunkText(text: string): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];

    if (words.length <= this.chunkSize) {
      return [text.trim()];
    }

    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + this.chunkSize, words.length);
      chunks.push(words.slice(start, end).join(' '));
      start += this.chunkSize - this.chunkOverlap;
      if (start >= words.length) break;
    }

    return chunks.filter(c => c.length > 0);
  }

  // ─── Persistence ───
  private load(): void {
    try {
      const docsPath = path.join(this.storePath, 'documents.json');
      const chunksPath = path.join(this.storePath, 'chunks.json');

      if (fs.existsSync(docsPath)) {
        const docsData = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
        if (Array.isArray(docsData)) this.documents = docsData;
      }

      if (fs.existsSync(chunksPath)) {
        const chunksData = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));
        if (Array.isArray(chunksData)) this.chunks = chunksData;
      }
    } catch {
      this.documents = [];
      this.chunks = [];
    }
  }

  private save(): void {
    if (!this.dirty) return;
    try {
      fs.writeFileSync(
        path.join(this.storePath, 'documents.json'),
        JSON.stringify(this.documents),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(this.storePath, 'chunks.json'),
        JSON.stringify(this.chunks),
        'utf-8',
      );
      this.dirty = false;
    } catch {
      // Silent fail — RAG still works in-memory
    }
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.storePath)) {
        fs.mkdirSync(this.storePath, { recursive: true });
      }
    } catch {
      // Non-fatal
    }
  }
}
