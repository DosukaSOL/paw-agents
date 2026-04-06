// ─── Validation Engine ───
// Schema validation, logical validation, safety policy, blockchain simulation.
// This is the GATEKEEPER — nothing executes without passing through here.
// In autonomous mode, validation still runs but confirmation threshold is raised.

import { AgentPlan, ValidationResult, ValidationError, ValidationWarning, SecurityPolicy, RiskLevel, AgentMode } from '../core/types';
import { config, getSecurityPolicy } from '../core/config';

export class ValidationEngine {
  private policy: SecurityPolicy;

  constructor(policy?: SecurityPolicy) {
    this.policy = policy ?? getSecurityPolicy();
  }

  async validate(plan: AgentPlan, modeOverride?: AgentMode): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let risk_score = 0;

    // 1. Schema validation
    this.validateSchema(plan, errors);

    // 2. Logical validation
    this.validateLogic(plan, errors, warnings);

    // 3. Safety policy enforcement
    risk_score = this.enforceSafetyPolicy(plan, errors, warnings);

    // 4. Risk assessment
    const mode = modeOverride ?? config.agent.mode;
    const requires_confirmation = this.requiresConfirmation(plan, risk_score, mode);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      risk_score,
      requires_confirmation,
    };
  }

  // ─── Schema Validation ───
  private validateSchema(plan: AgentPlan, errors: ValidationError[]): void {
    if (!plan.id) {
      errors.push({ code: 'MISSING_ID', field: 'id', message: 'Plan must have an ID', severity: 'fatal' });
    }
    if (!plan.intent || plan.intent.trim().length === 0) {
      errors.push({ code: 'MISSING_INTENT', field: 'intent', message: 'Plan must have an intent', severity: 'fatal' });
    }
    if (!Array.isArray(plan.plan) || plan.plan.length === 0) {
      errors.push({ code: 'EMPTY_PLAN', field: 'plan', message: 'Plan must have at least one step', severity: 'fatal' });
    }
    if (!plan.execution_mode || !['purp', 'js', 'api', 'system'].includes(plan.execution_mode)) {
      errors.push({ code: 'INVALID_EXEC_MODE', field: 'execution_mode', message: 'Invalid execution mode', severity: 'fatal' });
    }

    // Validate each step
    for (let i = 0; i < (plan.plan?.length ?? 0); i++) {
      const step = plan.plan[i];
      if (!step.action) {
        errors.push({ code: 'STEP_NO_ACTION', field: `plan[${i}].action`, message: `Step ${i} missing action`, severity: 'error' });
      }
      if (!step.tool) {
        errors.push({ code: 'STEP_NO_TOOL', field: `plan[${i}].tool`, message: `Step ${i} missing tool`, severity: 'error' });
      }
    }
  }

  // ─── Logical Validation ───
  private validateLogic(plan: AgentPlan, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // Max steps
    if (plan.plan.length > this.policy.max_plan_steps) {
      errors.push({
        code: 'TOO_MANY_STEPS',
        field: 'plan',
        message: `Plan has ${plan.plan.length} steps, max is ${this.policy.max_plan_steps}`,
        severity: 'error',
      });
    }

    // Check for duplicate step numbers
    const stepNums = plan.plan.map(s => s.step);
    const uniqueSteps = new Set(stepNums);
    if (uniqueSteps.size !== stepNums.length) {
      warnings.push({ code: 'DUPLICATE_STEPS', field: 'plan', message: 'Plan contains duplicate step numbers' });
    }

    // Verify step order
    for (let i = 1; i < plan.plan.length; i++) {
      if (plan.plan[i].step <= plan.plan[i - 1].step) {
        warnings.push({ code: 'STEP_ORDER', field: `plan[${i}]`, message: 'Steps should be in ascending order' });
      }
    }

    // Check tools are declared
    const usedTools = new Set(plan.plan.map(s => s.tool));
    for (const tool of usedTools) {
      if (!plan.tools.includes(tool)) {
        warnings.push({ code: 'UNDECLARED_TOOL', field: 'tools', message: `Tool "${tool}" used but not declared in tools array` });
      }
    }
  }

  // ─── Safety Policy ───
  private enforceSafetyPolicy(plan: AgentPlan, errors: ValidationError[], warnings: ValidationWarning[]): number {
    let risk_score = 0;

    // Check for forbidden instructions
    for (const step of plan.plan) {
      const actionLower = step.action.toLowerCase();
      for (const forbidden of this.policy.forbidden_instructions) {
        if (actionLower.includes(forbidden.toLowerCase())) {
          errors.push({
            code: 'FORBIDDEN_ACTION',
            field: `plan[${step.step}].action`,
            message: `Forbidden action detected: ${forbidden}`,
            severity: 'fatal',
          });
          risk_score += 50;
        }
      }
    }

    // Assess risks
    for (const risk of (plan.risks ?? [])) {
      switch (risk.level) {
        case 'low': risk_score += 5; break;
        case 'medium': risk_score += 15; break;
        case 'high': risk_score += 30; break;
        case 'critical': risk_score += 50; break;
      }
    }

    // Blockchain-specific checks
    if (plan.execution_mode === 'purp' || plan.tools.some(t => t.includes('solana'))) {
      risk_score += 10; // On-chain always adds risk

      // Check transaction amounts in params
      for (const step of plan.plan) {
        const lamports = this.extractLamports(step.params);
        if (lamports > this.policy.max_transaction_lamports) {
          errors.push({
            code: 'EXCEEDS_MAX_TX',
            field: `plan[${step.step}].params`,
            message: `Transaction amount ${lamports} exceeds max ${this.policy.max_transaction_lamports} lamports`,
            severity: 'fatal',
          });
        }
        if (lamports > this.policy.require_confirmation_above_lamports) {
          risk_score += 20;
        }
      }
    }

    // DeFi-specific safety checks
    if (plan.tools.some(t => t.startsWith('defi_'))) {
      risk_score += 15; // DeFi operations carry inherent risk

      for (const step of plan.plan) {
        if (!step.tool.startsWith('defi_')) continue;

        // Validate slippage is within bounds
        const slippage = Number(step.params.slippage_bps ?? 0);
        if (slippage > 500) {
          errors.push({
            code: 'DEFI_EXCESSIVE_SLIPPAGE',
            field: `plan[${step.step}].params.slippage_bps`,
            message: `Slippage ${slippage}bps exceeds maximum 500bps (5%)`,
            severity: 'fatal',
          });
        } else if (slippage > 200) {
          warnings.push({
            code: 'DEFI_HIGH_SLIPPAGE',
            field: `plan[${step.step}].params.slippage_bps`,
            message: `Slippage ${slippage}bps is elevated (${slippage / 100}%)`,
          });
          risk_score += 10;
        }

        // Validate swap amounts
        const amount = Number(step.params.amount ?? 0);
        if (amount > 0) {
          if (amount > this.policy.max_transaction_lamports) {
            errors.push({
              code: 'DEFI_EXCEEDS_MAX_SWAP',
              field: `plan[${step.step}].params.amount`,
              message: `DeFi swap amount ${amount} exceeds max ${this.policy.max_transaction_lamports}`,
              severity: 'fatal',
            });
          }
          if (amount > this.policy.require_confirmation_above_lamports) {
            risk_score += 25;
          }
        }

        // defi_swap always adds more risk than defi_quote or defi_simulate
        if (step.tool === 'defi_swap') {
          risk_score += 10;
        }
      }
    }

    // Cap risk score
    return Math.min(100, risk_score);
  }

  // ─── Confirmation Check ───
  private requiresConfirmation(plan: AgentPlan, risk_score: number, mode: AgentMode): boolean {
    // Free mode: no confirmation gates — full autonomy over all actions
    if (mode === 'free') return false;

    // In autonomous mode: only confirm for critical risks or when confirmHighRisk is set
    if (mode === 'autonomous') {
      // Critical risks ALWAYS require confirmation regardless of mode
      if (plan.risks?.some(r => r.level === 'critical')) return true;
      // If confirmHighRisk is on, also confirm for high-risk actions
      if (config.agent.confirmHighRisk && risk_score >= 70) return true;
      if (config.agent.confirmHighRisk && plan.risks?.some(r => r.level === 'high')) return true;
      // Autonomous mode: skip confirmation for everything else
      return false;
    }

    // Supervised mode: original behavior — confirm for anything above low risk
    if (plan.requires_confirmation) return true;
    if (risk_score >= 30) return true;
    if (plan.risks?.some(r => r.level === 'high' || r.level === 'critical')) return true;
    if (plan.execution_mode === 'purp') return true; // All on-chain actions require confirmation
    if (plan.tools.some(t => t === 'defi_swap')) return true; // All DeFi swaps require confirmation
    return false;
  }

  // ─── Helpers ───
  private extractLamports(params: Record<string, unknown>): number {
    for (const key of ['lamports', 'amount', 'value']) {
      if (typeof params[key] === 'number') return params[key] as number;
    }
    return 0;
  }
}
