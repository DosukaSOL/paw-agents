// ─── Agent Brain ───
// Converts natural language intent → structured AgentPlan.
// LLM = reasoning ONLY. System = execution ONLY.

import { v4 as uuid } from 'uuid';
import { AgentPlan, SkillDefinition } from '../core/types';
import { ModelRouter } from '../models/router';

const SYSTEM_PROMPT = `You are PAW Agent Brain v2 — an autonomous AI worker for the Purp/Solana ecosystem.

Your ONLY job is to convert a user's natural language intent into a STRICT JSON execution plan.

You MUST output ONLY valid JSON matching this exact schema:
{
  "intent": "clear one-line description of what the user wants",
  "plan": [
    {
      "step": 1,
      "action": "action_name",
      "tool": "tool_name",
      "params": {},
      "description": "what this step does"
    }
  ],
  "tools": ["list", "of", "tools", "used"],
  "risks": [
    {
      "category": "risk category",
      "level": "low|medium|high|critical",
      "description": "what could go wrong",
      "mitigation": "how to handle it"
    }
  ],
  "requires_confirmation": true,
  "execution_mode": "purp|js|api|system"
}

AVAILABLE TOOLS:
- solana_transfer: Transfer SOL between wallets
- solana_balance: Check SOL balance
- api_call: Call external HTTPS APIs
- http_get: Fetch data from HTTPS URLs
- http_post: POST data to HTTPS URLs
- file_read: Read files (sandboxed to data/)
- file_write: Write files (sandboxed to data/)
- file_list: List directory contents (sandboxed)
- data_transform: Transform data (json_parse, base64, uppercase, etc.)
- data_filter: Filter arrays by field/value
- memory_set: Store key-value in memory
- memory_get: Retrieve from memory
- system_time: Get current UTC time
- system_sleep: Wait N milliseconds (max 10s)
- internal_log: Log a message
- internal_assert: Assert a condition
- internal_variable: Set a variable
- purp_compile: Compile Purp SCL v0.3 program

RULES:
1. NEVER output anything except valid JSON
2. NEVER suggest executing raw code
3. Always identify risks honestly
4. Set requires_confirmation=true for ANY blockchain action
5. Set requires_confirmation=true for ANY action that moves funds
6. Use the most conservative risk assessment
7. If the request is unclear, output a plan with a single "clarify" step
8. NEVER include private keys, secrets, or sensitive data in plans
9. Limit plans to 10 steps maximum
10. Each step must use a defined tool — no arbitrary execution`;

export class AgentBrain {
  private router: ModelRouter;

  constructor(router: ModelRouter) {
    this.router = router;
  }

  async generatePlan(
    userMessage: string,
    availableSkills: SkillDefinition[],
    availableTools: string[],
    healingHint?: string,
  ): Promise<AgentPlan> {
    const start = Date.now();

    const skillContext = availableSkills.length > 0
      ? `\n\nAvailable skills:\n${availableSkills.map(s =>
        `- ${s.metadata.name}: ${s.metadata.description} (actions: ${s.capability.actions.join(', ')})`
      ).join('\n')}`
      : '';

    const toolContext = `\n\nAvailable tools: ${availableTools.join(', ')}`;

    const healingContext = healingHint
      ? `\n\n⚠️ HEALING MODE: ${healingHint}\nGenerate an improved plan that avoids the previous failure.`
      : '';

    const prompt = `User request: "${userMessage}"${skillContext}${toolContext}${healingContext}

Generate the execution plan as strict JSON. Nothing else.`;

    const { text, model_used } = await this.router.generate(SYSTEM_PROMPT, prompt);

    // Parse the JSON response
    const plan = this.parseResponse(text);

    return {
      ...plan,
      id: uuid(),
      metadata: {
        model_used,
        skills_loaded: availableSkills.map(s => s.metadata.name),
        generation_time_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private parseResponse(raw: string): Omit<AgentPlan, 'id' | 'metadata'> {
    // Extract JSON from response (handle markdown code blocks)
    let json = raw.trim();

    // Strip markdown code fences if present
    const jsonMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      json = jsonMatch[1].trim();
    }

    // Strip any text before the first { and after the last }
    const firstBrace = json.indexOf('{');
    const lastBrace = json.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      json = json.slice(firstBrace, lastBrace + 1);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error(`Failed to parse AI response as JSON. Raw: ${raw.slice(0, 200)}`);
    }

    // Validate structure
    if (!parsed.intent || !Array.isArray(parsed.plan)) {
      throw new Error('AI response missing required fields: intent, plan');
    }

    return {
      intent: String(parsed.intent),
      plan: (parsed.plan as Array<Record<string, unknown>>).map((step, i) => ({
        step: (step.step as number) ?? i + 1,
        action: String(step.action ?? 'unknown'),
        tool: String(step.tool ?? 'unknown'),
        params: (step.params as Record<string, unknown>) ?? {},
        description: String(step.description ?? ''),
        rollback: step.rollback as AgentPlan['plan'][0]['rollback'],
      })),
      tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : [],
      risks: Array.isArray(parsed.risks) ? (parsed.risks as Array<Record<string, unknown>>).map(r => ({
        category: String(r.category ?? 'general'),
        level: (r.level as 'low' | 'medium' | 'high' | 'critical') ?? 'medium',
        description: String(r.description ?? ''),
        mitigation: String(r.mitigation ?? ''),
      })) : [],
      requires_confirmation: Boolean(parsed.requires_confirmation ?? true),
      execution_mode: (['purp', 'js', 'api'].includes(String(parsed.execution_mode)) ? parsed.execution_mode : 'js') as 'purp' | 'js' | 'api',
      purp_program: parsed.purp_program ? String(parsed.purp_program) : undefined,
    };
  }
}
