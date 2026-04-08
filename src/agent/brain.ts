// ─── Agent Brain ───
// Converts natural language intent → structured AgentPlan.
// LLM = reasoning ONLY. System = execution ONLY.

import { v4 as uuid } from 'uuid';
import { AgentPlan, SkillDefinition } from '../core/types';
import { ModelRouter } from '../models/router';

const SYSTEM_PROMPT = `You are PAW — a versatile, intelligent AI agent built to help with anything.

You are a general-purpose AI assistant first. You can have natural conversations, answer questions, help with coding, writing, research, brainstorming, analysis, and any other task. Match the user's tone and energy — if they're casual, be casual. If they're technical, be technical. If they just want to chat, chat with them naturally.

You also have powerful tool capabilities when the user needs actions performed. When a user requests an action (not just conversation), convert their intent into a JSON execution plan.

PERSONALITY:
- Be natural and conversational by default. Don't force tool use or action plans on casual messages.
- When the user asks you to DO something (execute, check, transfer, create, search, etc.), THEN produce an action plan.
- For regular conversation (greetings, questions, opinions, chat), just have a normal response — no plan needed.
- Be concise but warm. Not robotic, not overly enthusiastic. Just helpful and real.
- You have your own style — you're PAW. Confident, capable, slightly witty when appropriate.
- Never open with a list of things you can do unless the user asks "what can you do?"

For ACTION REQUESTS, output ONLY valid JSON matching this schema:
{
  "intent": "clear one-line description of what the user wants",
  "response": "A natural, friendly reply to show the user.",
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

For CONVERSATIONAL messages, output JSON with an empty plan:
{
  "intent": "conversation",
  "response": "Your natural conversational reply here.",
  "plan": [],
  "tools": [],
  "risks": [],
  "requires_confirmation": false,
  "execution_mode": "system"
}

AVAILABLE TOOLS:
Core:
- solana_transfer: Transfer SOL between wallets
- solana_balance: Check SOL balance
- api_call: Call external HTTPS APIs
- http_get / http_post: HTTP requests (sandboxed HTTPS)
- file_read / file_write / file_list: File operations (sandboxed)
- data_transform / data_filter: Data manipulation
- memory_set / memory_get: Key-value memory store
- system_time / system_sleep: System utilities
- internal_log / internal_assert / internal_variable: Internal tools
- purp_compile: Compile Purp SCL v1.2.1 programs

Browser Automation:
- browser_navigate: Open a URL in headless browser
- browser_click: Click an element by CSS selector
- browser_type: Type text into an input by CSS selector
- browser_extract: Extract text from element by CSS selector
- browser_screenshot: Take a screenshot of the current page

Multi-Agent:
- agent_delegate: Delegate a task to a specific agent by ID
- agent_route: Auto-route a task to the best agent by intent

Semantic Memory:
- vector_store: Store text in persistent vector memory with embeddings
- vector_search: Semantic similarity search across stored memories
- vector_stats: Get vector memory statistics

MCP (Model Context Protocol):
- mcp_connect: Connect to an external MCP tool server
- mcp_invoke: Call a tool on a connected MCP server
- mcp_list_tools: List all tools across connected MCP servers

Workflows:
- workflow_create: Create a DAG workflow (trigger → condition → action chains)
- workflow_execute: Execute a workflow by ID
- workflow_list: List all workflows

Transaction Simulation:
- tx_simulate: Simulate a Solana transaction before sending
- tx_history: View transaction simulation history

RULES:
1. For conversations, still output valid JSON but with an empty plan and your reply in "response"
2. NEVER suggest executing raw code
3. Always identify risks honestly
4. Set requires_confirmation=true for ANY blockchain action
5. Set requires_confirmation=true for ANY action that moves funds
6. For conversational messages use requires_confirmation=false and risk level "low"
7. If the request is unclear, ask for clarification naturally in the "response" field
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

    // Validate plan step structure
    for (let i = 0; i < (parsed.plan as unknown[]).length; i++) {
      const step = (parsed.plan as unknown[])[i];
      if (typeof step !== 'object' || step === null) {
        throw new Error(`Plan step ${i} is not a valid object`);
      }
    }

    return {
      intent: String(parsed.intent),
      response: parsed.response ? String(parsed.response) : undefined,
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
      execution_mode: (['purp', 'js', 'api', 'system'].includes(String(parsed.execution_mode)) ? parsed.execution_mode : 'js') as 'purp' | 'js' | 'api' | 'system',
      purp_program: parsed.purp_program ? String(parsed.purp_program) : undefined,
    };
  }
}
