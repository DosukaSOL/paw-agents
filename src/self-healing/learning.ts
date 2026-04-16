// ─── Self-Improving Agents System ───
// Agents learn from execution outcomes to improve planning and decision-making.
// Uses execution history to refine strategies, detect failures, and optimize tool selection.
// Follows Hermes pattern: analyze outcomes → identify improvements → adjust prompts/behaviors.

import { AgentPlan, ExecutionResult } from '../core/types';
import { v4 as uuid } from 'uuid';

export interface ExecutionOutcome {
  id: string;
  plan_id: string;
  execution_result: ExecutionResult;
  success: boolean;
  duration_ms: number;
  tools_used: string[];
  error?: string;
  user_feedback?: string;
  lessons_learned?: string[];
  timestamp: string;
}

export interface LearningPattern {
  id: string;
  pattern_type: 'tool_success_rate' | 'failure_mode' | 'performance_improvement' | 'user_preference';
  description: string;
  confidence: number; // 0-1
  examples: string[];
  recommendation: string;
  discovered_at: string;
  evidence_count: number;
}

export class SelfImprovingAgentEngine {
  private outcomes: ExecutionOutcome[] = [];
  private patterns: LearningPattern[] = [];
  private toolSuccessRates = new Map<string, { success: number; total: number }>();
  private failureModes = new Map<string, { count: number; contexts: string[] }>();

  // ─── Record execution outcome ───
  recordOutcome(plan: AgentPlan, result: ExecutionResult, durationMs: number): ExecutionOutcome {
    const outcome: ExecutionOutcome = {
      id: `outcome_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      plan_id: plan.id ?? uuid(),
      execution_result: result,
      success: result.success,
      duration_ms: durationMs,
      tools_used: plan.tools ?? [],
      error: result.success ? undefined : result.error?.message,
      timestamp: new Date().toISOString(),
    };

    this.outcomes.push(outcome);

    // Update tool success rates
    for (const tool of plan.tools ?? []) {
      const stats = this.toolSuccessRates.get(tool) ?? { success: 0, total: 0 };
      stats.total++;
      if (result.success) stats.success++;
      this.toolSuccessRates.set(tool, stats);
    }

    // Track failure modes
    if (!result.success && result.error?.message) {
      const mode = this.categorizeError(result.error.message);
      const modeData = this.failureModes.get(mode) ?? { count: 0, contexts: [] };
      modeData.count++;
      modeData.contexts.push((plan.intent ?? 'unknown').substring(0, 100));
      this.failureModes.set(mode, modeData);
    }

    return outcome;
  }

  // ─── Analyze patterns from recent outcomes ───
  async analyzePatterns(): Promise<LearningPattern[]> {
    const newPatterns: LearningPattern[] = [];

    // Pattern 1: Tool success rates
    for (const [tool, stats] of this.toolSuccessRates) {
      if (stats.total >= 5) {
        const successRate = stats.success / stats.total;
        const pattern: LearningPattern = {
          id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          pattern_type: 'tool_success_rate',
          description: `Tool "${tool}" has ${(successRate * 100).toFixed(1)}% success rate`,
          confidence: Math.min(stats.total / 20, 1), // Higher confidence with more samples
          examples: this.outcomes
            .filter(o => o.tools_used.includes(tool))
            .slice(-3)
            .map(o => o.plan_id),
          recommendation:
            successRate < 0.5
              ? `Reduce reliance on "${tool}" - consider alternatives`
              : `Continue using "${tool}" - it has proven effectiveness`,
          discovered_at: new Date().toISOString(),
          evidence_count: stats.total,
        };
        newPatterns.push(pattern);
      }
    }

    // Pattern 2: Failure modes
    for (const [mode, data] of this.failureModes) {
      if (data.count >= 3) {
        const pattern: LearningPattern = {
          id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          pattern_type: 'failure_mode',
          description: `Failure mode detected: ${mode} (${data.count} occurrences)`,
          confidence: Math.min(data.count / 10, 1),
          examples: data.contexts.slice(0, 3),
          recommendation: `When planning for: [${data.contexts[0]}], avoid conditions that cause: "${mode}"`,
          discovered_at: new Date().toISOString(),
          evidence_count: data.count,
        };
        newPatterns.push(pattern);
      }
    }

    this.patterns = newPatterns;
    return newPatterns;
  }

  // ─── Get improvement recommendations ───
  getImprovementRecommendations(): {
    improved_system_prompt: string;
    tool_recommendations: Record<string, string>;
    strategy_adjustments: string[];
  } {
    const toolRecs: Record<string, string> = {};
    const strategies: string[] = [];

    for (const pattern of this.patterns) {
      if (pattern.pattern_type === 'tool_success_rate') {
        toolRecs[pattern.description] = pattern.recommendation;
      } else if (pattern.pattern_type === 'failure_mode') {
        strategies.push(pattern.recommendation);
      }
    }

    // Build improved system prompt based on learnings
    let improvedPrompt = `You are a self-improving AI agent that learns from experience.

Based on recent execution analysis:
${this.patterns.slice(0, 5).map(p => `- ${p.description}: confidence ${(p.confidence * 100).toFixed(0)}%`).join('\n')}

Adjust your planning accordingly. Prioritize proven-effective tools and avoid known failure modes.`;

    return {
      improved_system_prompt: improvedPrompt,
      tool_recommendations: toolRecs,
      strategy_adjustments: strategies,
    };
  }

  // ─── Record user feedback for specific outcome ───
  recordFeedback(outcomeId: string, feedback: string, lessonsLearned: string[] = []): void {
    const outcome = this.outcomes.find(o => o.id === outcomeId);
    if (outcome) {
      outcome.user_feedback = feedback;
      outcome.lessons_learned = lessonsLearned;
    }
  }

  // ─── Get execution history for learning ───
  getRecentOutcomes(limit: number = 50): ExecutionOutcome[] {
    return this.outcomes.slice(-limit);
  }

  // ─── Categorize errors into modes ───
  private categorizeError(errorMsg: string): string {
    if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) return 'TIMEOUT_ERROR';
    if (errorMsg.includes('not found') || errorMsg.includes('404')) return 'NOT_FOUND_ERROR';
    if (errorMsg.includes('unauthorized') || errorMsg.includes('403')) return 'AUTH_ERROR';
    if (errorMsg.includes('invalid') || errorMsg.includes('validation')) return 'VALIDATION_ERROR';
    if (errorMsg.includes('network') || errorMsg.includes('connection')) return 'NETWORK_ERROR';
    if (errorMsg.includes('rate limit') || errorMsg.includes('429')) return 'RATE_LIMIT_ERROR';
    return 'OTHER_ERROR';
  }

  // ─── Get stats ───
  getStats(): {
    total_outcomes: number;
    success_rate: number;
    total_patterns: number;
    high_confidence_patterns: number;
    average_duration_ms: number;
  } {
    const successful = this.outcomes.filter(o => o.success).length;
    const successRate = this.outcomes.length > 0 ? successful / this.outcomes.length : 0;
    const avgDuration = this.outcomes.length > 0
      ? this.outcomes.reduce((sum, o) => sum + o.duration_ms, 0) / this.outcomes.length
      : 0;

    return {
      total_outcomes: this.outcomes.length,
      success_rate: Math.round(successRate * 10000) / 100,
      total_patterns: this.patterns.length,
      high_confidence_patterns: this.patterns.filter(p => p.confidence > 0.7).length,
      average_duration_ms: Math.round(avgDuration),
    };
  }
}
