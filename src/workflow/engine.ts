// ─── PAW Workflow Engine — Reusable Workflow Templates & Execution ───
// Define, share, and execute multi-step workflows with triggers and conditions.

import {
  WorkflowTemplate,
  WorkflowStep,
  WorkflowVariable,
  WorkflowTrigger,
  WorkflowExecution,
  ChannelType,
} from '../core/types';
import { v4 as uuid } from 'uuid';
import { missionControl } from '../mission-control/index';

export class WorkflowEngine {
  private templates = new Map<string, WorkflowTemplate>();
  private executions = new Map<string, WorkflowExecution>();

  // ─── Template Management ───

  registerTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
    missionControl.log('info', 'workflow-engine', `Workflow template registered: ${template.name}`);
  }

  getTemplate(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  listTemplates(category?: string): WorkflowTemplate[] {
    const all = Array.from(this.templates.values());
    return category ? all.filter(t => t.category === category) : all;
  }

  removeTemplate(id: string): void {
    this.templates.delete(id);
  }

  // ─── Execution ───

  async startWorkflow(templateId: string, variables: Record<string, unknown> = {}, tenantId?: string): Promise<string> {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Workflow template ${templateId} not found`);

    // Validate required variables
    for (const v of template.variables) {
      if (v.required && !(v.name in variables) && v.default_value === undefined) {
        throw new Error(`Missing required variable: ${v.name}`);
      }
    }

    // Merge with defaults
    const mergedVars: Record<string, unknown> = {};
    for (const v of template.variables) {
      mergedVars[v.name] = variables[v.name] ?? v.default_value;
    }

    const executionId = uuid();
    const firstStep = template.steps[0];
    if (!firstStep) throw new Error('Workflow has no steps');

    const execution: WorkflowExecution = {
      id: executionId,
      template_id: templateId,
      tenant_id: tenantId,
      status: 'running',
      current_step: firstStep.id,
      variables: mergedVars,
      started_at: new Date().toISOString(),
      step_results: {},
    };

    this.executions.set(executionId, execution);
    template.uses++;

    missionControl.log('info', 'workflow-engine', `Workflow started: ${template.name} (${executionId})`);

    // Execute steps sequentially
    await this.executeSteps(execution, template);

    return executionId;
  }

  private async executeSteps(execution: WorkflowExecution, template: WorkflowTemplate): Promise<void> {
    for (const step of template.steps) {
      if (execution.status !== 'running') break;

      execution.current_step = step.id;

      try {
        const result = await this.executeStep(step, execution.variables);
        execution.step_results[step.id] = { status: 'completed', result };

        // Resolve next step
        if (step.on_success && step.on_success !== 'next') {
          const nextStep = template.steps.find(s => s.id === step.on_success);
          if (!nextStep) break;
        }
      } catch (err) {
        const errorMessage = (err as Error).message;
        execution.step_results[step.id] = { status: 'failed', error: errorMessage };

        if (step.on_failure) {
          const failureStep = template.steps.find(s => s.id === step.on_failure);
          if (failureStep) {
            try {
              await this.executeStep(failureStep, execution.variables);
            } catch {
              // Failure handler also failed
            }
          }
        }

        execution.status = 'failed';
        execution.error = errorMessage;
        execution.completed_at = new Date().toISOString();
        missionControl.log('error', 'workflow-engine', `Workflow failed: ${errorMessage}`);
        return;
      }
    }

    execution.status = 'completed';
    execution.completed_at = new Date().toISOString();
    missionControl.log('info', 'workflow-engine', `Workflow completed: ${execution.id}`);
  }

  private async executeStep(step: WorkflowStep, variables: Record<string, unknown>): Promise<unknown> {
    switch (step.type) {
      case 'delay': {
        const delayMs = Math.min(Number(step.config.delay_ms) || 1000, 300000); // Max 5 min
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return { delayed_ms: delayMs };
      }
      case 'condition': {
        const field = String(step.config.field ?? '');
        const operator = String(step.config.operator ?? 'eq');
        const value = step.config.value;
        const actual = variables[field];

        let result = false;
        switch (operator) {
          case 'eq': result = actual === value; break;
          case 'neq': result = actual !== value; break;
          case 'gt': result = Number(actual) > Number(value); break;
          case 'lt': result = Number(actual) < Number(value); break;
          case 'contains': result = String(actual).includes(String(value)); break;
        }
        return { condition_met: result };
      }
      case 'skill':
      case 'agent_call':
      case 'webhook':
      case 'loop':
        // These would integrate with the agent loop, skills, and external APIs
        return { type: step.type, config: step.config, executed: true };
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  // ─── Execution Management ───

  pauseWorkflow(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (execution && execution.status === 'running') {
      execution.status = 'paused';
    }
  }

  cancelWorkflow(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (execution && (execution.status === 'running' || execution.status === 'paused')) {
      execution.status = 'cancelled';
      execution.completed_at = new Date().toISOString();
    }
  }

  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id);
  }

  listExecutions(templateId?: string): WorkflowExecution[] {
    const all = Array.from(this.executions.values());
    return templateId ? all.filter(e => e.template_id === templateId) : all;
  }

  // ─── Built-in Templates ───

  static getBuiltinTemplates(): WorkflowTemplate[] {
    return [
      {
        id: 'daily-portfolio-check',
        name: 'Daily Portfolio Check',
        description: 'Check wallet balances, active DeFi positions, and send a summary.',
        category: 'defi',
        steps: [
          { id: 's1', name: 'Check Balances', type: 'skill', config: { skill: 'wallet_balance' }, on_success: 's2' },
          { id: 's2', name: 'Check DeFi', type: 'skill', config: { skill: 'defi_positions' }, on_success: 's3' },
          { id: 's3', name: 'Send Summary', type: 'agent_call', config: { prompt: 'Summarize my portfolio' } },
        ],
        variables: [{ name: 'wallet_address', type: 'string', required: true, description: 'Solana wallet address' }],
        triggers: [{ type: 'cron', config: { schedule: '0 9 * * *' } }],
        author: 'PAW Team',
        version: '1.0.0',
        public: true,
        uses: 0,
      },
      {
        id: 'onboarding-flow',
        name: 'New User Onboarding',
        description: 'Guide new users through PAW setup: wallet, preferences, and first task.',
        category: 'utility',
        steps: [
          { id: 's1', name: 'Welcome', type: 'agent_call', config: { prompt: 'Welcome the user and explain PAW features' } },
          { id: 's2', name: 'Setup Wallet', type: 'skill', config: { skill: 'wallet_setup' } },
          { id: 's3', name: 'Set Preferences', type: 'agent_call', config: { prompt: 'Ask about preferred communication style and risk tolerance' } },
        ],
        variables: [
          { name: 'user_name', type: 'string', required: false, default_value: 'User', description: 'Name of the user' },
        ],
        triggers: [{ type: 'event', config: { event: 'user_first_message' } }],
        author: 'PAW Team',
        version: '1.0.0',
        public: true,
        uses: 0,
      },
      {
        id: 'price-alert-workflow',
        name: 'Price Alert & Auto-Action',
        description: 'Monitor token price and execute an action when threshold is hit.',
        category: 'defi',
        steps: [
          { id: 's1', name: 'Check Price', type: 'skill', config: { skill: 'token_price' } },
          { id: 's2', name: 'Evaluate', type: 'condition', config: { field: 'price_change_pct', operator: 'gt', value: 5 }, on_success: 's3' },
          { id: 's3', name: 'Execute Action', type: 'agent_call', config: { prompt: 'Execute the configured action based on price alert' } },
        ],
        variables: [
          { name: 'token', type: 'string', required: true, description: 'Token symbol to monitor' },
          { name: 'threshold_pct', type: 'number', required: false, default_value: 5, description: 'Price change % to trigger' },
        ],
        triggers: [{ type: 'cron', config: { schedule: '*/15 * * * *' } }],
        author: 'PAW Team',
        version: '1.0.0',
        public: true,
        uses: 0,
      },
      {
        id: 'multi-channel-broadcast',
        name: 'Multi-Channel Broadcast',
        description: 'Send a message to all connected channels simultaneously.',
        category: 'utility',
        steps: [
          { id: 's1', name: 'Prepare Message', type: 'agent_call', config: { prompt: 'Format the broadcast message' } },
          { id: 's2', name: 'Send to All', type: 'skill', config: { skill: 'broadcast', channels: 'all' } },
        ],
        variables: [
          { name: 'message', type: 'string', required: true, description: 'Message to broadcast' },
          { name: 'channels', type: 'json', required: false, default_value: ['telegram', 'discord'], description: 'Target channels' },
        ],
        triggers: [{ type: 'manual', config: {} }],
        author: 'PAW Team',
        version: '1.0.0',
        public: true,
        uses: 0,
      },
    ];
  }
}

// Singleton
export const workflowEngine = new WorkflowEngine();

// Load built-in templates
for (const template of WorkflowEngine.getBuiltinTemplates()) {
  workflowEngine.registerTemplate(template);
}
