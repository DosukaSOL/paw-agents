// ─── Model Catalog ───
// Curated list of the latest, hackathon-ready models per provider.
// This is the single source of truth used by the Hub picker and the
// /api/providers endpoint. Add or update entries here when new flagship
// models are released — no other code needs to change.
//
// Conventions:
//   - tier: "flagship" (best, highest cost) | "balanced" | "fast" | "code" | "reasoning" | "free"
//   - Mark `recommended: true` on the default model the Hub should preselect
//     when the user picks the company.
//   - All ids must match the provider's API model identifier exactly.

export type ModelTier = 'flagship' | 'balanced' | 'fast' | 'code' | 'reasoning' | 'free';

export interface ModelEntry {
  id: string;                // Provider-specific model id
  label: string;             // Human-friendly name shown in UI
  tier: ModelTier;
  context?: number;          // Context window in tokens
  notes?: string;            // Short one-line description
  recommended?: boolean;
}

export interface ProviderEntry {
  id: string;                // Internal provider id used by ModelRouter
  label: string;             // Display name (company)
  envKey: string;            // .env var that activates the provider
  docsUrl: string;
  signupUrl: string;
  free?: boolean;            // True if no API key needed (e.g. ollama)
  models: ModelEntry[];
}

export const MODEL_CATALOG: ProviderEntry[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    signupUrl: 'https://console.anthropic.com/',
    models: [
      { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1', tier: 'flagship', context: 200000, notes: 'Top reasoning + long-horizon agentic work.' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', tier: 'balanced', context: 200000, notes: 'Best price / performance for agents and code.', recommended: true },
      { id: 'claude-haiku-4-20250915', label: 'Claude Haiku 4', tier: 'fast', context: 200000, notes: 'Cheapest + fastest Claude.' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    docsUrl: 'https://platform.openai.com/docs/models',
    signupUrl: 'https://platform.openai.com/',
    models: [
      { id: 'gpt-5', label: 'GPT-5', tier: 'flagship', context: 400000, notes: 'Frontier reasoning + tool use.', recommended: true },
      { id: 'gpt-5-mini', label: 'GPT-5 mini', tier: 'balanced', context: 400000, notes: 'Cheap, fast, strong agentic loop.' },
      { id: 'gpt-4o', label: 'GPT-4o', tier: 'balanced', context: 128000, notes: 'Multimodal, very reliable.' },
      { id: 'o4-mini', label: 'o4-mini', tier: 'reasoning', context: 200000, notes: 'Step-by-step reasoning model.' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', tier: 'fast', context: 128000, notes: 'Lowest-cost legacy 4o tier.' },
    ],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    envKey: 'XAI_API_KEY',
    docsUrl: 'https://docs.x.ai/docs/models',
    signupUrl: 'https://console.x.ai/',
    models: [
      { id: 'grok-4', label: 'Grok 4', tier: 'flagship', context: 256000, notes: 'Latest Grok flagship — strong reasoning + real-time data.', recommended: true },
      { id: 'grok-3', label: 'Grok 3', tier: 'balanced', context: 131072, notes: 'Solid general-purpose model.' },
      { id: 'grok-3-mini', label: 'Grok 3 mini', tier: 'fast', context: 131072, notes: 'Cheaper / faster.' },
    ],
  },
  {
    id: 'google',
    label: 'Google',
    envKey: 'GOOGLE_AI_API_KEY',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    signupUrl: 'https://aistudio.google.com/',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'flagship', context: 2000000, notes: 'Long context + reasoning.', recommended: true },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'balanced', context: 1000000, notes: 'Fast multimodal.' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'fast', context: 1000000, notes: 'Very low latency.' },
      { id: 'gemma-3-27b-it', label: 'Gemma 3 27B', tier: 'free', context: 128000, notes: 'Open weights via API.' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    docsUrl: 'https://api-docs.deepseek.com/',
    signupUrl: 'https://platform.deepseek.com/',
    models: [
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1 (Reasoner)', tier: 'reasoning', context: 128000, notes: 'Open reasoning model — very capable.', recommended: true },
      { id: 'deepseek-chat', label: 'DeepSeek-V3 (Chat)', tier: 'balanced', context: 128000, notes: 'General-purpose.' },
      { id: 'deepseek-coder', label: 'DeepSeek Coder', tier: 'code', context: 128000, notes: 'Code-specialized.' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    docsUrl: 'https://docs.mistral.ai/getting-started/models/',
    signupUrl: 'https://console.mistral.ai/',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large', tier: 'flagship', context: 128000, notes: 'Top Mistral model.', recommended: true },
      { id: 'mistral-medium-latest', label: 'Mistral Medium', tier: 'balanced', context: 128000 },
      { id: 'codestral-latest', label: 'Codestral', tier: 'code', context: 256000, notes: 'Code completion + generation.' },
      { id: 'open-mistral-nemo', label: 'Mistral Nemo', tier: 'fast', context: 128000 },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    docsUrl: 'https://console.groq.com/docs/models',
    signupUrl: 'https://console.groq.com/',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', tier: 'flagship', context: 131072, notes: 'Fast inference on Groq.', recommended: true },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', tier: 'fast', context: 131072, notes: 'Sub-second responses.' },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', tier: 'balanced', context: 32768 },
      { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill 70B', tier: 'reasoning', context: 131072 },
    ],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    envKey: 'COHERE_API_KEY',
    docsUrl: 'https://docs.cohere.com/docs/models',
    signupUrl: 'https://dashboard.cohere.com/',
    models: [
      { id: 'command-a-03-2025', label: 'Command A', tier: 'flagship', context: 256000, notes: 'Latest flagship for agents + RAG.', recommended: true },
      { id: 'command-r-plus', label: 'Command R+', tier: 'balanced', context: 128000 },
      { id: 'command-r', label: 'Command R', tier: 'fast', context: 128000 },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    envKey: 'OLLAMA_ENABLED',
    docsUrl: 'https://ollama.com/library',
    signupUrl: 'https://ollama.com/download',
    free: true,
    models: [
      { id: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B', tier: 'code', notes: 'Strong local coder. Tested.', recommended: true },
      { id: 'qwen2.5:14b', label: 'Qwen 2.5 14B', tier: 'balanced' },
      { id: 'llama3.3:70b', label: 'Llama 3.3 70B', tier: 'flagship', notes: 'Needs ~40GB RAM.' },
      { id: 'llama3.2:3b', label: 'Llama 3.2 3B', tier: 'fast' },
      { id: 'gemma2:9b', label: 'Gemma 2 9B', tier: 'balanced' },
      { id: 'mistral-nemo:12b', label: 'Mistral Nemo 12B', tier: 'balanced' },
      { id: 'deepseek-r1:7b', label: 'DeepSeek R1 7B', tier: 'reasoning' },
      { id: 'phi3:mini', label: 'Phi-3 Mini', tier: 'fast' },
    ],
  },
];

export function findProvider(id: string): ProviderEntry | undefined {
  return MODEL_CATALOG.find(p => p.id === id);
}

export function findModel(providerId: string, modelId: string): ModelEntry | undefined {
  return findProvider(providerId)?.models.find(m => m.id === modelId);
}

export function recommendedModel(providerId: string): ModelEntry | undefined {
  const p = findProvider(providerId);
  if (!p) return undefined;
  return p.models.find(m => m.recommended) ?? p.models[0];
}
