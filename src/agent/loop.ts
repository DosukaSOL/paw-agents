// ─── PAW Agent Loop ───
// The complete agent pipeline: INTENT → PLAN → VALIDATION → EXECUTION → VERIFICATION
// This is the central orchestrator.

import { v4 as uuid } from 'uuid';
import { AgentBrain } from './brain';
import { ModelRouter } from '../models/router';
import { SkillEngine } from '../skills/engine';
import { ValidationEngine } from '../validation/engine';
import { ExecutionEngine, ToolHandler } from '../execution/engine';
import { TraceLogger } from '../trace/index';
import { SolanaExecutor } from '../integrations/solana/executor';
import { PurpEngine } from '../integrations/purp/engine';
import { SelfHealingSystem } from '../self-healing/index';
import { sanitizeInput } from '../security/sanitizer';
import { checkRateLimit } from '../security/rate-limiter';
import { config } from '../core/config';
import { AgentPlan, ExecutionResult, ValidationResult, AgentMode } from '../core/types';
import { UserProfiler } from '../intelligence/profiler';
import { RAGEngine } from '../intelligence/rag';
import { ConversationBranching } from '../intelligence/branching';

export interface AgentResponse {
  success: boolean;
  message: string;
  plan_id?: string;
  requires_confirmation?: boolean;
  plan_summary?: string;
  trace_id?: string;
  error?: string;
}

// Pending confirmations stored per user (with expiry to prevent memory leaks)
const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const pendingConfirmations = new Map<string, { plan: AgentPlan; trace: TraceLogger; created_at: number }>();

// Periodic cleanup of expired confirmations
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingConfirmations) {
    if (now - val.created_at > CONFIRMATION_TTL_MS) {
      pendingConfirmations.delete(key);
    }
  }
}, 60_000).unref();

// Per-user mode overrides (defaults to config) — cap at 10,000 entries
const MAX_USER_MODES = 10_000;
const userModes = new Map<string, AgentMode>();

export class PawAgent {
  private brain: AgentBrain;
  private skills: SkillEngine;
  private validator: ValidationEngine;
  private executor: ExecutionEngine;
  private solana: SolanaExecutor;
  private purp: PurpEngine;
  private healer: SelfHealingSystem;
  private router: ModelRouter;
  private profiler: UserProfiler;
  private rag: RAGEngine;
  private branching: ConversationBranching;

  constructor() {
    this.router = new ModelRouter();
    this.brain = new AgentBrain(this.router);
    this.skills = new SkillEngine();
    this.validator = new ValidationEngine();
    this.solana = new SolanaExecutor();
    this.purp = new PurpEngine();
    this.executor = new ExecutionEngine(this.solana, this.purp);
    this.healer = new SelfHealingSystem();
    this.profiler = new UserProfiler();
    this.rag = new RAGEngine();
    this.branching = new ConversationBranching();

    // Load skills
    const { loaded, errors } = this.skills.loadAll();
    if (loaded.length > 0) {
      console.log(`[PAW] Loaded skills: ${loaded.join(', ')}`);
    }
    if (errors.length > 0) {
      console.warn(`[PAW] Skill errors:`, errors);
    }
  }

  // ─── Register custom tools ───
  registerTool(name: string, handler: ToolHandler): void {
    this.executor.registerTool(name, handler);
  }

  // ─── Set user mode ───
  setUserMode(userId: string, mode: AgentMode): void {
    if (userModes.size >= MAX_USER_MODES && !userModes.has(userId)) {
      // Evict oldest entry (first inserted)
      const oldest = userModes.keys().next().value;
      if (oldest) userModes.delete(oldest);
    }
    userModes.set(userId, mode);
  }

  getUserMode(userId: string): AgentMode {
    return userModes.get(userId) ?? config.agent.mode;
  }

  // ─── Expose intelligence modules ───
  getProfiler(): UserProfiler { return this.profiler; }
  getRAG(): RAGEngine { return this.rag; }
  getBranching(): ConversationBranching { return this.branching; }
  getRouter(): ModelRouter { return this.router; }

  // ─── Main agent loop ───
  async process(userId: string, rawMessage: string): Promise<AgentResponse> {
    const trace = new TraceLogger();
    const startTime = Date.now();

    try {
      // ═══ STEP 1: Rate limit ═══
      const rateCheck = checkRateLimit(userId);
      if (!rateCheck.allowed) {
        return {
          success: false,
          message: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.reset_in_ms / 1000)}s.`,
          error: 'RATE_LIMITED',
        };
      }

      // ═══ STEP 2: Sanitize input ═══
      trace.log('intake', { input: rawMessage, duration_ms: 0 });

      const sanitized = sanitizeInput(rawMessage);
      if (sanitized.injection_detected) {
        trace.log('intake', {
          input: rawMessage,
          reasoning: 'Prompt injection detected',
          metadata: { patterns: sanitized.injection_patterns_matched },
          duration_ms: Date.now() - startTime,
        });
        return {
          success: false,
          message: 'I cannot process that request. Please rephrase your message.',
          error: 'INJECTION_DETECTED',
          trace_id: trace.getSessionId(),
        };
      }

      // ═══ STEP 3: Check for confirmation response ═══
      const lowerMsg = sanitized.sanitized.toLowerCase();
      if (lowerMsg === 'yes' || lowerMsg === 'confirm' || lowerMsg === 'approve') {
        return this.handleConfirmation(userId, true, trace);
      }
      if (lowerMsg === 'no' || lowerMsg === 'cancel' || lowerMsg === 'reject') {
        return this.handleConfirmation(userId, false, trace);
      }

      // ═══ STEP 4: Load relevant skills ═══
      const relevantSkills = this.skills.findSkillsForIntent(sanitized.sanitized);

      // ═══ STEP 4b: RAG context augmentation ═══
      let ragContext = '';
      if (config.intelligence.ragEnabled) {
        ragContext = this.rag.buildContext(sanitized.sanitized);
      }

      // ═══ STEP 4c: User personalization hints ═══
      let personalizationHints = '';
      if (config.intelligence.profilingEnabled) {
        personalizationHints = this.profiler.getPersonalizationHints(userId);
      }

      // ═══ STEP 4d: Track message in conversation branching ═══
      if (config.intelligence.branchingEnabled) {
        this.branching.addMessage(userId, {
          role: 'user',
          content: sanitized.sanitized,
          timestamp: new Date().toISOString(),
        });
      }

      const availableTools = [
        'solana_transfer', 'solana_balance', 'api_call',
        'internal_log', 'internal_assert', 'internal_variable',
        'file_read', 'file_write', 'file_list',
        'http_get', 'http_post',
        'data_transform', 'data_filter',
        'system_time', 'system_sleep',
        'memory_get', 'memory_set',
        'browser_navigate', 'browser_click', 'browser_type', 'browser_extract', 'browser_screenshot',
        'agent_delegate', 'agent_route',
        'vector_store', 'vector_search', 'vector_stats',
        'mcp_connect', 'mcp_invoke', 'mcp_list_tools',
        'workflow_create', 'workflow_execute', 'workflow_list',
        'tx_simulate', 'tx_history',
        'rag_index', 'rag_search', 'rag_list',
        'branch_create', 'branch_list', 'branch_switch', 'branch_rollback',
        'profile_get', 'profile_update',
      ];

      // ═══ STEP 5: Generate plan (LLM reasoning) ═══
      // Augment the input with RAG context and personalization
      const augmentedInput = [
        sanitized.sanitized,
        ragContext,
        personalizationHints ? `\nUser context: ${personalizationHints}` : '',
      ].filter(Boolean).join('\n');

      trace.log('planning', {
        input: sanitized.sanitized,
        metadata: {
          skills: relevantSkills.map(s => s.metadata.name),
          rag_augmented: ragContext.length > 0,
          personalized: personalizationHints.length > 0,
        },
        duration_ms: 0,
      });

      let plan: AgentPlan;
      try {
        plan = await this.brain.generatePlan(
          augmentedInput,
          relevantSkills,
          availableTools,
        );
      } catch (err) {
        const errMsg = (err as Error).message;
        trace.log('planning', {
          error: errMsg,
          duration_ms: Date.now() - startTime,
        });

        // Surface specific, actionable error messages to the user
        if (errMsg.includes('No AI model providers available')) {
          return {
            success: false,
            message: 'No AI model providers are configured. Please add at least one API key (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY) to your .env file, then restart the agent.',
            error: 'NO_MODEL_CONFIGURED',
            trace_id: trace.getSessionId(),
          };
        }

        return {
          success: false,
          message: 'I had trouble understanding that request. Could you rephrase it?',
          error: 'PLAN_GENERATION_FAILED',
          trace_id: trace.getSessionId(),
        };
      }

      trace.log('planning', {
        plan,
        reasoning: plan.intent,
        duration_ms: Date.now() - startTime,
      });

      // ═══ STEP 6: Validate plan ═══
      const userMode = this.getUserMode(userId);
      const validation = await this.validator.validate(plan, userMode);

      trace.log('validation', {
        validation,
        duration_ms: Date.now() - startTime,
      });

      if (!validation.valid) {
        // ═══ STEP 6b: Self-healing attempt ═══
        const healResult = await this.healer.heal(
          `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
          plan,
          (hint) => this.brain.generatePlan(sanitized.sanitized, relevantSkills, availableTools, hint),
          (p) => this.validator.validate(p, userMode),
          (p) => this.executor.execute(p),
        );

        if (healResult.final_status === 'healed' && healResult.fixed_plan) {
          plan = healResult.fixed_plan;
        } else {
          return {
            success: false,
            message: `I couldn't create a safe plan for this request. Issues: ${validation.errors.map(e => e.message).join('; ')}`,
            error: 'VALIDATION_FAILED',
            trace_id: trace.getSessionId(),
          };
        }
      }

      // ═══ STEP 7: Confirmation gate ═══
      if (validation.requires_confirmation) {
        pendingConfirmations.set(userId, { plan, trace, created_at: Date.now() });

        const summary = this.summarizePlan(plan, validation);
        const modeHint = userMode === 'free'
          ? '\n\n🔓 _Running in free mode — this confirmation should not appear. Please report this bug._'
          : userMode === 'autonomous'
          ? '\n\n🤖 _Running in autonomous mode — only critical actions require confirmation._'
          : '';

        return {
          success: true,
          message: `⚠️ This action requires your confirmation:\n\n${summary}\n\nRisk score: ${validation.risk_score}/100${modeHint}\n\nReply "yes" to confirm or "no" to cancel.`,
          plan_id: plan.id,
          requires_confirmation: true,
          plan_summary: summary,
          trace_id: trace.getSessionId(),
        };
      }

      // ═══ STEP 8: Execute ═══
      return this.executePlan(plan, trace, startTime);

    } catch (err) {
      trace.log('execution', {
        error: (err as Error).message,
        duration_ms: Date.now() - startTime,
      });
      return {
        success: false,
        message: 'An unexpected error occurred. The issue has been logged.',
        error: (err as Error).message,
        trace_id: trace.getSessionId(),
      };
    }
  }

  // ─── Handle confirmation ───
  private async handleConfirmation(userId: string, confirmed: boolean, trace: TraceLogger): Promise<AgentResponse> {
    const pending = pendingConfirmations.get(userId);
    if (!pending) {
      return {
        success: false,
        message: 'No pending action to confirm.',
        error: 'NO_PENDING_CONFIRMATION',
      };
    }

    pendingConfirmations.delete(userId);

    if (!confirmed) {
      pending.trace.log('confirmation', {
        reasoning: 'User rejected the plan',
        duration_ms: 0,
      });
      return {
        success: true,
        message: '✅ Action cancelled.',
        plan_id: pending.plan.id,
        trace_id: pending.trace.getSessionId(),
      };
    }

    pending.trace.log('confirmation', {
      reasoning: 'User confirmed the plan',
      duration_ms: 0,
    });

    return this.executePlan(pending.plan, pending.trace, Date.now());
  }

  // ─── Execute a confirmed plan ───
  private async executePlan(plan: AgentPlan, trace: TraceLogger, startTime: number): Promise<AgentResponse> {
    trace.log('execution', {
      plan,
      metadata: { execution_mode: plan.execution_mode },
      duration_ms: 0,
    });

    const result = await this.executor.execute(plan);

    // ═══ STEP 9: Verify result ═══
    if (!result.success && result.error) {
      // Attempt self-healing
      trace.log('execution', {
        execution: result,
        error: result.error.message,
        duration_ms: Date.now() - startTime,
      });

      const healResult = await this.healer.heal(
        result.error.message,
        plan,
        (hint) => this.brain.generatePlan(plan.intent, [], ['solana_transfer', 'solana_balance', 'api_call', 'internal_log'], hint),
        (p) => this.validator.validate(p, this.getUserMode(`webhook:${plan.id}`)),
        (p) => this.executor.execute(p),
      );

      if (healResult.final_status === 'healed' && healResult.fixed_plan) {
        // Use the healed plan and re-execute
        const healedResult = await this.executor.execute(healResult.fixed_plan);
        trace.log('logging', {
          execution: healedResult,
          output: healedResult.final_output,
          duration_ms: Date.now() - startTime,
        });
        trace.log('response', {
          output: healedResult.final_output,
          duration_ms: Date.now() - startTime,
        });
        return {
          success: healedResult.success,
          message: this.formatResult(healResult.fixed_plan, healedResult),
          plan_id: healResult.fixed_plan.id,
          trace_id: trace.getSessionId(),
        };
      }

      return {
        success: false,
        message: `Action failed: ${result.error.message}`,
        plan_id: plan.id,
        error: result.error.code,
        trace_id: trace.getSessionId(),
      };
    }

    // ═══ STEP 10: Log (Trace) ═══
    trace.log('logging', {
      execution: result,
      output: result.final_output,
      duration_ms: Date.now() - startTime,
    });

    // ═══ STEP 11: Respond ═══
    trace.log('response', {
      output: result.final_output,
      duration_ms: Date.now() - startTime,
    });

    // ═══ STEP 12: Record profile & branch ═══
    const responseMsg = this.formatResult(plan, result);
    const durationMs = Date.now() - startTime;

    if (config.intelligence.profilingEnabled) {
      this.profiler.recordInteraction('cli:default', {
        intent: plan.intent,
        tools_used: plan.tools,
        risk_score: 0,
        model_used: plan.metadata.model_used,
        success: result.success,
        duration_ms: durationMs,
      });
    }

    if (config.intelligence.branchingEnabled) {
      this.branching.addMessage('cli:default', {
        role: 'agent',
        content: responseMsg,
        timestamp: new Date().toISOString(),
        plan_id: plan.id,
      });
    }

    return {
      success: true,
      message: responseMsg,
      plan_id: plan.id,
      trace_id: trace.getSessionId(),
    };
  }

  // ─── Format result for user ───
  private formatResult(plan: AgentPlan, result: ExecutionResult): string {
    const lines = [`✅ Done: ${plan.intent}`];

    for (const step of result.steps_completed) {
      const status = step.success ? '✓' : '✗';
      const planStep = plan.plan.find(s => s.step === step.step);
      lines.push(`  ${status} Step ${step.step}: ${planStep?.description ?? 'Unknown'}`);
    }

    lines.push(`\n⏱ Completed in ${result.duration_ms}ms`);

    return lines.join('\n');
  }

  // ─── Summarize plan for confirmation ───
  private summarizePlan(plan: AgentPlan, validation: ValidationResult): string {
    const lines = [`Intent: ${plan.intent}\n`];

    lines.push('Steps:');
    for (const step of plan.plan) {
      lines.push(`  ${step.step}. ${step.description}`);
    }

    if (plan.risks.length > 0) {
      lines.push('\nRisks:');
      for (const risk of plan.risks) {
        lines.push(`  ⚠️ [${risk.level.toUpperCase()}] ${risk.description}`);
      }
    }

    if (validation.warnings.length > 0) {
      lines.push('\nWarnings:');
      for (const w of validation.warnings) {
        lines.push(`  ⚡ ${w.message}`);
      }
    }

    return lines.join('\n');
  }
}
