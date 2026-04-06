// ─── Fast Path — Low-Latency Small Model Router ───
// Routes simple, well-understood tasks to fast inference providers (Groq/DeepSeek)
// instead of sending everything through the full-size model. Saves latency and cost.

import { config } from '../core/config';
import { TaskType, TaskClassification, ModelPerformanceRecord } from '../core/types';
import * as fs from 'fs';
import * as path from 'path';

// ─── Task classification patterns ───
const TASK_PATTERNS: Array<{ pattern: RegExp; task_type: TaskType; complexity: 'simple' | 'moderate' | 'complex' }> = [
  // Simple QA — factual, short-answer
  { pattern: /^(what|who|when|where|how much|how many)\b/i, task_type: 'simple_qa', complexity: 'simple' },
  { pattern: /\b(define|meaning of|explain briefly)\b/i, task_type: 'simple_qa', complexity: 'simple' },

  // Code tasks
  { pattern: /\b(write|create|build|implement|code|function|class|script|debug|fix bug)\b/i, task_type: 'code', complexity: 'moderate' },
  { pattern: /\b(refactor|optimize|review code)\b/i, task_type: 'code', complexity: 'complex' },

  // Math
  { pattern: /\b(calculate|compute|solve|formula|equation|math)\b/i, task_type: 'math', complexity: 'moderate' },
  { pattern: /\b(sum|average|percentage|multiply|divide)\b/i, task_type: 'math', complexity: 'simple' },

  // Creative
  { pattern: /\b(write a story|poem|creative|brainstorm|imagine|generate ideas)\b/i, task_type: 'creative', complexity: 'moderate' },

  // Analysis
  { pattern: /\b(analyze|compare|evaluate|assess|review|audit)\b/i, task_type: 'analysis', complexity: 'complex' },

  // Blockchain
  { pattern: /\b(send|transfer|swap|stake|balance|wallet|sol|token|nft|deploy|contract)\b/i, task_type: 'blockchain', complexity: 'moderate' },
  { pattern: /\b(solana|defi|jupiter|raydium|orca)\b/i, task_type: 'blockchain', complexity: 'moderate' },

  // Data processing
  { pattern: /\b(parse|transform|filter|sort|extract|csv|json|convert)\b/i, task_type: 'data_processing', complexity: 'simple' },

  // Complex reasoning (catch-all for multi-step)
  { pattern: /\b(plan|strategy|design|architect|then.*then|step by step)\b/i, task_type: 'complex_reasoning', complexity: 'complex' },
];

// ─── Model recommendations per task type + complexity ───
const MODEL_RECOMMENDATIONS: Record<string, { provider: string; reason: string }> = {
  // Simple tasks → fast provider (Groq with Llama)
  'simple_qa:simple': { provider: 'groq', reason: 'Fast inference for simple factual queries' },
  'math:simple': { provider: 'groq', reason: 'Fast inference for basic math' },
  'data_processing:simple': { provider: 'groq', reason: 'Fast inference for data transforms' },

  // Moderate tasks → balanced provider
  'code:moderate': { provider: 'anthropic', reason: 'Best code generation quality' },
  'math:moderate': { provider: 'openai', reason: 'Strong mathematical reasoning' },
  'creative:moderate': { provider: 'anthropic', reason: 'High-quality creative output' },
  'blockchain:moderate': { provider: 'openai', reason: 'Strong reasoning for blockchain ops' },
  'simple_qa:moderate': { provider: 'groq', reason: 'Fast inference sufficient' },
  'data_processing:moderate': { provider: 'deepseek', reason: 'Good at structured data tasks' },

  // Complex tasks → strongest model
  'code:complex': { provider: 'anthropic', reason: 'Best for complex code and architecture' },
  'analysis:complex': { provider: 'openai', reason: 'Strong analytical reasoning' },
  'complex_reasoning:complex': { provider: 'anthropic', reason: 'Best multi-step reasoning' },
  'blockchain:complex': { provider: 'openai', reason: 'Careful reasoning for high-risk ops' },
  'creative:complex': { provider: 'anthropic', reason: 'Highest creative quality' },
  'math:complex': { provider: 'openai', reason: 'Strong advanced math' },
};

export class FastPathRouter {
  private performanceLog: ModelPerformanceRecord[] = [];
  private storePath: string;

  constructor(storePath?: string) {
    this.storePath = path.resolve(storePath ?? config.intelligence.performanceStorePath);
    this.ensureDir();
    this.loadPerformance();
  }

  // ─── Classify a task based on the user's input ───
  classifyTask(input: string): TaskClassification {
    // Try pattern matching
    for (const { pattern, task_type, complexity } of TASK_PATTERNS) {
      if (pattern.test(input)) {
        const rec = this.getRecommendation(task_type, complexity);
        return {
          task_type,
          confidence: 0.8,
          complexity,
          recommended_model: rec.model,
          recommended_provider: rec.provider,
        };
      }
    }

    // Default: moderate complexity, use default provider
    return {
      task_type: 'complex_reasoning',
      confidence: 0.4,
      complexity: 'moderate',
      recommended_model: '',
      recommended_provider: config.models.defaultProvider,
    };
  }

  // ─── Get the best provider for a task, learning from performance history ───
  getRecommendation(taskType: TaskType, complexity: string): { provider: string; model: string; reason: string } {
    // Check if we have enough performance data to override defaults
    const relevant = this.performanceLog.filter(
      r => r.task_type === taskType && r.success,
    );

    if (relevant.length >= 10) {
      // We have data — pick the provider with lowest avg latency + highest quality
      const byProvider = new Map<string, { totalLatency: number; totalQuality: number; count: number }>();

      for (const record of relevant.slice(-50)) { // Last 50 entries
        const stats = byProvider.get(record.provider) ?? { totalLatency: 0, totalQuality: 0, count: 0 };
        stats.totalLatency += record.latency_ms;
        stats.totalQuality += record.quality_score;
        stats.count++;
        byProvider.set(record.provider, stats);
      }

      let bestProvider = '';
      let bestScore = -Infinity;

      for (const [provider, stats] of byProvider) {
        const avgLatency = stats.totalLatency / stats.count;
        const avgQuality = stats.totalQuality / stats.count;
        // Score: quality (0-1) normalized, minus latency penalty
        const score = avgQuality * 100 - (avgLatency / 100);
        if (score > bestScore) {
          bestScore = score;
          bestProvider = provider;
        }
      }

      if (bestProvider) {
        return {
          provider: bestProvider,
          model: '',
          reason: `Learned from ${relevant.length} past ${taskType} tasks`,
        };
      }
    }

    // Fall back to static recommendations
    const key = `${taskType}:${complexity}`;
    const rec = MODEL_RECOMMENDATIONS[key];
    if (rec) {
      return { provider: rec.provider, model: '', reason: rec.reason };
    }

    return { provider: config.models.defaultProvider, model: '', reason: 'Default provider' };
  }

  // ─── Should this task use the fast path? ───
  shouldUseFastPath(input: string): boolean {
    if (!config.intelligence.fastPathEnabled) return false;

    const classification = this.classifyTask(input);

    // Fast path only for simple tasks with high confidence
    return classification.complexity === 'simple' && classification.confidence >= 0.7;
  }

  // ─── Record model performance for learning ───
  recordPerformance(record: ModelPerformanceRecord): void {
    this.performanceLog.push(record);

    // Keep last 1000 records
    if (this.performanceLog.length > 1000) {
      this.performanceLog = this.performanceLog.slice(-1000);
    }

    this.savePerformance();
  }

  // ─── Get performance stats ───
  getStats(): Record<string, { avg_latency_ms: number; success_rate: number; avg_quality: number; count: number }> {
    const stats: Record<string, { totalLatency: number; totalQuality: number; successes: number; count: number }> = {};

    for (const record of this.performanceLog) {
      const key = record.provider;
      if (!stats[key]) {
        stats[key] = { totalLatency: 0, totalQuality: 0, successes: 0, count: 0 };
      }
      stats[key].totalLatency += record.latency_ms;
      stats[key].totalQuality += record.quality_score;
      if (record.success) stats[key].successes++;
      stats[key].count++;
    }

    const result: Record<string, { avg_latency_ms: number; success_rate: number; avg_quality: number; count: number }> = {};
    for (const [key, s] of Object.entries(stats)) {
      result[key] = {
        avg_latency_ms: Math.round(s.totalLatency / s.count),
        success_rate: Math.round((s.successes / s.count) * 100) / 100,
        avg_quality: Math.round((s.totalQuality / s.count) * 100) / 100,
        count: s.count,
      };
    }

    return result;
  }

  // ─── Persistence ───
  private loadPerformance(): void {
    try {
      const filePath = path.join(this.storePath, 'performance.json');
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (Array.isArray(data)) this.performanceLog = data;
      }
    } catch {
      this.performanceLog = [];
    }
  }

  private savePerformance(): void {
    try {
      fs.writeFileSync(
        path.join(this.storePath, 'performance.json'),
        JSON.stringify(this.performanceLog),
        'utf-8',
      );
    } catch {
      // Silent fail
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
