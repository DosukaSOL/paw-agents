// ─── PAW Extended Thinking Engine ───
// Unified extended thinking / reasoning support across all AI providers.
// Supports Claude's extended thinking (budget_tokens), OpenAI's reasoning models (o1/o3),
// and chain-of-thought across any provider.

// ─── Types ───

export type ThinkingProvider = 'claude' | 'openai' | 'generic';

export interface ThinkingConfig {
  enabled: boolean;
  provider: ThinkingProvider;
  budgetTokens?: number;         // Claude: max tokens for thinking
  maxThinkingTime?: number;      // ms timeout for thinking phase
  adaptive?: boolean;            // Auto-adjust thinking depth based on complexity
  showThinking?: boolean;        // Expose thinking process to user
  streamThinking?: boolean;      // Stream thinking tokens in real-time
  chainOfThought?: boolean;      // Force chain-of-thought for non-reasoning models
}

export interface ThinkingBlock {
  type: 'thinking' | 'redacted';
  content: string;
  tokens?: number;
  duration_ms?: number;
}

export interface ThinkingResult {
  thinking: ThinkingBlock[];
  response: string;
  totalThinkingTokens: number;
  totalResponseTokens: number;
  thinkingDuration_ms: number;
  model: string;
  provider: ThinkingProvider;
}

export interface ComplexityAssessment {
  score: number;           // 0-1 complexity score
  factors: string[];       // What makes it complex
  recommendedBudget: number;
}

// ─── Provider Adapter ───

export type ThinkingLLMAdapter = (params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  thinkingBudget?: number;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  onThinkingToken?: (token: string) => void;
  onResponseToken?: (token: string) => void;
}) => Promise<{ thinking: string; response: string; thinkingTokens: number; responseTokens: number }>;

// ─── Extended Thinking Engine ───

export class ExtendedThinkingEngine {
  private config: ThinkingConfig;
  private adapter: ThinkingLLMAdapter;
  private complexityCache: Map<string, ComplexityAssessment> = new Map();

  constructor(config: ThinkingConfig, adapter: ThinkingLLMAdapter) {
    this.config = config;
    this.adapter = adapter;
  }

  // ─── Main Think Method ───

  async think(
    systemPrompt: string,
    userPrompt: string,
    options?: Partial<ThinkingConfig>,
  ): Promise<ThinkingResult> {
    const cfg = { ...this.config, ...options };
    const startTime = Date.now();

    if (!cfg.enabled) {
      // Direct response without thinking
      const result = await this.adapter({
        model: this.getModel(cfg.provider),
        systemPrompt,
        userPrompt,
        maxTokens: 4096,
      });
      return {
        thinking: [],
        response: result.response,
        totalThinkingTokens: 0,
        totalResponseTokens: result.responseTokens,
        thinkingDuration_ms: 0,
        model: this.getModel(cfg.provider),
        provider: cfg.provider,
      };
    }

    // Assess complexity for adaptive budget
    let budget = cfg.budgetTokens ?? 10000;
    if (cfg.adaptive) {
      const complexity = await this.assessComplexity(userPrompt);
      budget = complexity.recommendedBudget;
    }

    // Build thinking prompt
    const thinkingSystemPrompt = this.buildThinkingSystemPrompt(cfg, systemPrompt);

    const thinkingBlocks: ThinkingBlock[] = [];

    const result = await this.adapter({
      model: this.getModel(cfg.provider),
      systemPrompt: thinkingSystemPrompt,
      userPrompt,
      thinkingBudget: budget,
      maxTokens: cfg.provider === 'claude' ? budget + 8192 : 16384,
      stream: cfg.streamThinking,
      onThinkingToken: cfg.streamThinking ? (token) => {
        // Accumulate thinking tokens for streaming
        if (thinkingBlocks.length === 0 || thinkingBlocks[thinkingBlocks.length - 1].type !== 'thinking') {
          thinkingBlocks.push({ type: 'thinking', content: '', tokens: 0 });
        }
        const block = thinkingBlocks[thinkingBlocks.length - 1];
        block.content += token;
        block.tokens = (block.tokens ?? 0) + 1;
      } : undefined,
      onResponseToken: cfg.streamThinking ? () => { /* response streaming handled by caller */ } : undefined,
    });

    const duration = Date.now() - startTime;

    // Parse thinking blocks if not streamed
    if (thinkingBlocks.length === 0 && result.thinking) {
      thinkingBlocks.push({
        type: 'thinking',
        content: result.thinking,
        tokens: result.thinkingTokens,
        duration_ms: duration,
      });
    }

    return {
      thinking: cfg.showThinking ? thinkingBlocks : thinkingBlocks.map(b => ({ ...b, content: '[thinking hidden]' })),
      response: result.response,
      totalThinkingTokens: result.thinkingTokens,
      totalResponseTokens: result.responseTokens,
      thinkingDuration_ms: duration,
      model: this.getModel(cfg.provider),
      provider: cfg.provider,
    };
  }

  // ─── Multi-Step Thinking ───

  async thinkDeep(
    systemPrompt: string,
    userPrompt: string,
    steps: number = 3,
  ): Promise<ThinkingResult> {
    if (steps <= 0) throw new Error('thinkDeep steps must be > 0');
    let accumulatedThinking: ThinkingBlock[] = [];
    let currentPrompt = userPrompt;
    let totalThinkingTokens = 0;
    let totalResponseTokens = 0;
    const startTime = Date.now();

    for (let i = 0; i < steps; i++) {
      const stepSystemPrompt = i === 0
        ? `${systemPrompt}\n\nThink deeply about this problem. This is step ${i + 1} of ${steps} thinking steps.`
        : `${systemPrompt}\n\nBuilding on your previous thinking, deepen your analysis. Step ${i + 1} of ${steps}.\n\nPrevious conclusions: ${accumulatedThinking.map(t => t.content).join('\n')}`;

      const result = await this.think(stepSystemPrompt, currentPrompt, {
        showThinking: true,
        budgetTokens: Math.floor((this.config.budgetTokens ?? 10000) / steps),
      });

      accumulatedThinking = [...accumulatedThinking, ...result.thinking];
      totalThinkingTokens += result.totalThinkingTokens;
      totalResponseTokens += result.totalResponseTokens;

      // Use the response as context for next step
      if (i < steps - 1) {
        currentPrompt = `Previous analysis:\n${result.response}\n\nNow deepen this analysis further.`;
      } else {
        // Final step: synthesize
        return {
          thinking: accumulatedThinking,
          response: result.response,
          totalThinkingTokens,
          totalResponseTokens,
          thinkingDuration_ms: Date.now() - startTime,
          model: this.getModel(this.config.provider),
          provider: this.config.provider,
        };
      }
    }

    // Should not reach here
    return {
      thinking: accumulatedThinking,
      response: '',
      totalThinkingTokens,
      totalResponseTokens,
      thinkingDuration_ms: Date.now() - startTime,
      model: this.getModel(this.config.provider),
      provider: this.config.provider,
    };
  }

  // ─── Complexity Assessment ───

  async assessComplexity(prompt: string): Promise<ComplexityAssessment> {
    const cacheKey = prompt.slice(0, 100);
    if (this.complexityCache.has(cacheKey)) {
      return this.complexityCache.get(cacheKey)!;
    }

    const factors: string[] = [];
    let score = 0;

    // Heuristic-based complexity scoring
    const wordCount = prompt.split(/\s+/).length;
    if (wordCount > 500) { score += 0.2; factors.push('long-input'); }
    if (wordCount > 1000) { score += 0.1; factors.push('very-long-input'); }

    // Technical indicators
    const techPatterns = [/code|program|algorithm|implement|debug|optimize/i, /math|equation|calcul|proof|theorem/i, /analyz|compar|evaluat|synthesiz/i, /multi.?step|complex|intricate|nuanced/i];
    for (const pattern of techPatterns) {
      if (pattern.test(prompt)) { score += 0.15; factors.push(pattern.source.slice(0, 20)); }
    }

    // Question complexity
    const questionMarks = (prompt.match(/\?/g) ?? []).length;
    if (questionMarks > 3) { score += 0.1; factors.push('multi-question'); }

    score = Math.min(score, 1);

    // Map score to budget
    const minBudget = 2000;
    const maxBudget = this.config.budgetTokens ?? 50000;
    const recommendedBudget = Math.floor(minBudget + score * (maxBudget - minBudget));

    const assessment = { score, factors, recommendedBudget };
    this.complexityCache.set(cacheKey, assessment);
    return assessment;
  }

  // ─── Chain-of-Thought Wrapper (for non-reasoning models) ───

  async chainOfThought(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<ThinkingResult> {
    const cotSystemPrompt = `${systemPrompt}

IMPORTANT: Before answering, think through this step-by-step:
1. Identify what the question/task is really asking
2. Break it down into sub-problems
3. Solve each sub-problem
4. Synthesize your answer
5. Verify your reasoning

Format your response as:
<thinking>
[Your step-by-step reasoning here]
</thinking>

<answer>
[Your final answer here]
</answer>`;

    const result = await this.adapter({
      model: this.getModel(this.config.provider),
      systemPrompt: cotSystemPrompt,
      userPrompt,
      maxTokens: 8192,
    });

    // Parse thinking and answer
    const thinkingMatch = result.response.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const answerMatch = result.response.match(/<answer>([\s\S]*?)<\/answer>/);

    const thinking = thinkingMatch?.[1]?.trim() ?? '';
    const answer = answerMatch?.[1]?.trim() ?? result.response;

    return {
      thinking: thinking ? [{ type: 'thinking', content: thinking, tokens: result.thinkingTokens }] : [],
      response: answer,
      totalThinkingTokens: result.thinkingTokens,
      totalResponseTokens: result.responseTokens,
      thinkingDuration_ms: 0,
      model: this.getModel(this.config.provider),
      provider: this.config.provider,
    };
  }

  // ─── Private Helpers ───

  private buildThinkingSystemPrompt(cfg: ThinkingConfig, basePrompt: string): string {
    switch (cfg.provider) {
      case 'claude':
        return `${basePrompt}\n\nYou have extended thinking enabled. Use your thinking to deeply reason about the problem before responding.`;
      case 'openai':
        return basePrompt; // o1/o3 models handle thinking internally
      case 'generic':
      default:
        if (cfg.chainOfThought) {
          return `${basePrompt}\n\nThink step-by-step before answering. Show your reasoning process.`;
        }
        return basePrompt;
    }
  }

  private getModel(provider: ThinkingProvider): string {
    switch (provider) {
      case 'claude': return 'claude-sonnet-4-20250514';
      case 'openai': return 'o3-mini';
      case 'generic': return 'default';
    }
  }

  updateConfig(updates: Partial<ThinkingConfig>): void {
    Object.assign(this.config, updates);
  }

  getConfig(): ThinkingConfig {
    return { ...this.config };
  }
}
