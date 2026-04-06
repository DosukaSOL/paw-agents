// ─── Self-Healing System ───
// On ANY failure: diagnose, attempt fix, re-validate, retry safely, escalate or abort.

import { ExecutionResult, AgentPlan, ValidationResult } from '../core/types';

export interface DiagnosisResult {
  error_type: 'schema' | 'validation' | 'execution' | 'timeout' | 'network' | 'blockchain' | 'unknown';
  recoverable: boolean;
  suggested_fix: string | null;
  should_retry: boolean;
  should_escalate: boolean;
}

export interface HealingResult {
  original_error: string;
  diagnosis: DiagnosisResult;
  fix_applied: string | null;
  fixed_plan: AgentPlan | null;
  retry_count: number;
  final_status: 'healed' | 'escalated' | 'aborted';
}

const MAX_HEALING_ATTEMPTS = 3;

export class SelfHealingSystem {
  // ─── Diagnose a failure ───
  diagnose(error: string, context: { plan?: AgentPlan; execution?: ExecutionResult; validation?: ValidationResult }): DiagnosisResult {
    const lowerError = error.toLowerCase();

    // Network errors
    if (lowerError.includes('timeout') || lowerError.includes('econnrefused') || lowerError.includes('fetch failed')) {
      return {
        error_type: 'network',
        recoverable: true,
        suggested_fix: 'Retry with exponential backoff',
        should_retry: true,
        should_escalate: false,
      };
    }

    // Blockchain errors
    if (lowerError.includes('insufficient funds') || lowerError.includes('insufficient lamports')) {
      return {
        error_type: 'blockchain',
        recoverable: false,
        suggested_fix: 'Insufficient balance — cannot proceed',
        should_retry: false,
        should_escalate: true,
      };
    }

    if (lowerError.includes('simulation failed') || lowerError.includes('blockhash')) {
      return {
        error_type: 'blockchain',
        recoverable: true,
        suggested_fix: 'Re-fetch blockhash and retry',
        should_retry: true,
        should_escalate: false,
      };
    }

    // Validation errors
    if (lowerError.includes('validation') || lowerError.includes('schema')) {
      return {
        error_type: 'validation',
        recoverable: true,
        suggested_fix: 'Re-generate plan with stricter constraints',
        should_retry: true,
        should_escalate: false,
      };
    }

    // Execution errors
    if (lowerError.includes('unknown tool') || lowerError.includes('step failed')) {
      return {
        error_type: 'execution',
        recoverable: false,
        suggested_fix: 'Plan references unknown tools — regenerate',
        should_retry: true,
        should_escalate: false,
      };
    }

    // Unknown
    return {
      error_type: 'unknown',
      recoverable: false,
      suggested_fix: null,
      should_retry: false,
      should_escalate: true,
    };
  }

  // ─── Attempt to heal a failed plan ───
  async heal(
    error: string,
    plan: AgentPlan,
    replanFn: (hint: string) => Promise<AgentPlan>,
    validateFn: (plan: AgentPlan) => Promise<ValidationResult>,
    executeFn: (plan: AgentPlan) => Promise<ExecutionResult>,
  ): Promise<HealingResult> {
    let lastDiagnosis: DiagnosisResult;
    let fixedPlan: AgentPlan | null = null;

    for (let attempt = 0; attempt < MAX_HEALING_ATTEMPTS; attempt++) {
      lastDiagnosis = this.diagnose(error, { plan });

      if (!lastDiagnosis.should_retry) {
        return {
          original_error: error,
          diagnosis: lastDiagnosis,
          fix_applied: null,
          fixed_plan: null,
          retry_count: attempt,
          final_status: lastDiagnosis.should_escalate ? 'escalated' : 'aborted',
        };
      }

      try {
        // Re-generate plan with healing hint
        const hint = `Previous attempt failed with: "${error}". ${lastDiagnosis.suggested_fix ?? 'Try a different approach.'}`;
        fixedPlan = await replanFn(hint);

        // Re-validate
        const validation = await validateFn(fixedPlan);
        if (!validation.valid) {
          error = `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`;
          continue;
        }

        // Re-execute
        const result = await executeFn(fixedPlan);
        if (result.success) {
          return {
            original_error: error,
            diagnosis: lastDiagnosis,
            fix_applied: lastDiagnosis.suggested_fix,
            fixed_plan: fixedPlan,
            retry_count: attempt + 1,
            final_status: 'healed',
          };
        }

        error = result.error?.message ?? 'Unknown execution error';
      } catch (err) {
        error = (err as Error).message;
      }
    }

    return {
      original_error: error,
      diagnosis: this.diagnose(error, { plan }),
      fix_applied: null,
      fixed_plan: fixedPlan,
      retry_count: MAX_HEALING_ATTEMPTS,
      final_status: 'escalated',
    };
  }
}
