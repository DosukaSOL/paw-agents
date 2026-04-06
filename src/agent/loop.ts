// ─── PAW Agent Loop ───
// The complete agent pipeline: INTENT → PLAN → VALIDATION → EXECUTION → VERIFICATION
// This is the central orchestrator.

import { v4 as uuid } from 'uuid';
import { AgentBrain } from './brain';
import { ModelRouter } from '../models/router';
import { SkillEngine } from '../skills/engine';
import { ValidationEngine } from '../validation/engine';
import { ExecutionEngine, ToolHandler } from '../execution/engine';
import { Clawtrace } from '../clawtrace/index';
import { SolanaExecutor } from '../integrations/solana/executor';
import { PurpEngine } from '../integrations/purp/engine';
import { SelfHealingSystem } from '../self-healing/index';
import { sanitizeInput } from '../security/sanitizer';
import { checkRateLimit } from '../security/rate-limiter';
import { AgentPlan, ExecutionResult, ValidationResult } from '../core/types';

export interface AgentResponse {
  success: boolean;
  message: string;
  plan_id?: string;
  requires_confirmation?: boolean;
  plan_summary?: string;
  trace_id?: string;
  error?: string;
}

// Pending confirmations stored per user
const pendingConfirmations = new Map<string, { plan: AgentPlan; trace: Clawtrace }>();

export class PawAgent {
  private brain: AgentBrain;
  private skills: SkillEngine;
  private validator: ValidationEngine;
  private executor: ExecutionEngine;
  private solana: SolanaExecutor;
  private purp: PurpEngine;
  private healer: SelfHealingSystem;
  private router: ModelRouter;

  constructor() {
    this.router = new ModelRouter();
    this.brain = new AgentBrain(this.router);
    this.skills = new SkillEngine();
    this.validator = new ValidationEngine();
    this.solana = new SolanaExecutor();
    this.purp = new PurpEngine();
    this.executor = new ExecutionEngine(this.solana, this.purp);
    this.healer = new SelfHealingSystem();

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

  // ─── Main agent loop ───
  async process(userId: string, rawMessage: string): Promise<AgentResponse> {
    const trace = new Clawtrace();
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
      const availableTools = [
        'solana_transfer', 'solana_balance', 'api_call',
        'internal_log', 'internal_assert', 'internal_variable',
      ];

      // ═══ STEP 5: Generate plan (LLM reasoning) ═══
      trace.log('planning', {
        input: sanitized.sanitized,
        metadata: { skills: relevantSkills.map(s => s.metadata.name) },
        duration_ms: 0,
      });

      let plan: AgentPlan;
      try {
        plan = await this.brain.generatePlan(
          sanitized.sanitized,
          relevantSkills,
          availableTools,
        );
      } catch (err) {
        trace.log('planning', {
          error: (err as Error).message,
          duration_ms: Date.now() - startTime,
        });
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
      const validation = await this.validator.validate(plan);

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
          (p) => this.validator.validate(p),
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
        pendingConfirmations.set(userId, { plan, trace });

        const summary = this.summarizePlan(plan, validation);

        return {
          success: true,
          message: `⚠️ This action requires your confirmation:\n\n${summary}\n\nRisk score: ${validation.risk_score}/100\n\nReply "yes" to confirm or "no" to cancel.`,
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
  private async handleConfirmation(userId: string, confirmed: boolean, trace: Clawtrace): Promise<AgentResponse> {
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
  private async executePlan(plan: AgentPlan, trace: Clawtrace, startTime: number): Promise<AgentResponse> {
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
        (p) => this.validator.validate(p),
        (p) => this.executor.execute(p),
      );

      if (healResult.final_status !== 'healed') {
        return {
          success: false,
          message: `Action failed: ${result.error.message}`,
          plan_id: plan.id,
          error: result.error.code,
          trace_id: trace.getSessionId(),
        };
      }
    }

    // ═══ STEP 10: Log (Clawtrace) ═══
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

    return {
      success: true,
      message: this.formatResult(plan, result),
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
