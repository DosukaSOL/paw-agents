// ─── Model Router — Multi-Model Abstraction Layer ───
// Supports multiple AI providers with dynamic selection, fallback, and smart routing.
// Smart routing picks the best model per task type automatically.

import { ModelProvider, ModelConfig, TaskType, ModelPerformanceRecord } from '../core/types';
import { config } from '../core/config';
import { FastPathRouter } from '../intelligence/fast-path';

// ─── OpenAI Provider ───
class OpenAIProvider implements ModelProvider {
  name = 'openai';
  model: string;
  private apiKey: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(system: string, prompt: string): Promise<string> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    const response = await client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from OpenAI');
    return content;
  }
}

// ─── Anthropic Provider ───
class AnthropicProvider implements ModelProvider {
  name = 'anthropic';
  model = 'claude-sonnet-4-20250514';
  private apiKey: string;

  constructor(cfg: { apiKey: string }) {
    this.apiKey = cfg.apiKey;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(system: string, prompt: string): Promise<string> {
    // Anthropic SDK call
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content?.find((c: { type: string }) => c.type === 'text')?.text;
    if (!text) throw new Error('Empty response from Anthropic');
    return text;
  }
}

// ─── Google AI Provider (Gemma 3) ───
class GoogleProvider implements ModelProvider {
  name = 'google';
  model: string;
  private apiKey: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(system: string, prompt: string): Promise<string> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Google AI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Google AI');
    return text;
  }
}

// ─── Mistral Provider ───
class MistralProvider implements ModelProvider {
  name = 'mistral';
  model: string;
  private apiKey: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(system: string, prompt: string): Promise<string> {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mistral API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from Mistral');
    return text;
  }
}

// ─── DeepSeek Provider ───
class DeepSeekProvider implements ModelProvider {
  name = 'deepseek';
  model: string;
  private apiKey: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(system: string, prompt: string): Promise<string> {
    // DeepSeek uses OpenAI-compatible API
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from DeepSeek');
    return text;
  }
}

// ─── Groq Provider (Llama, fast inference) ───
class GroqProvider implements ModelProvider {
  name = 'groq';
  model: string;
  private apiKey: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(system: string, prompt: string): Promise<string> {
    // Groq uses OpenAI-compatible API
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from Groq');
    return text;
  }
}

// ─── xAI Provider (Grok — OpenAI-compatible) ───
class XAIProvider implements ModelProvider {
  name = 'xai';
  model: string;
  private apiKey: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(system: string, prompt: string): Promise<string> {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`xAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from xAI');
    return text;
  }
}

// ─── Cohere Provider (Command R+) ───
class CohereProvider implements ModelProvider {
  name = 'cohere';
  model: string;
  private apiKey: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async generate(system: string, prompt: string): Promise<string> {
    const response = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { message?: { content?: Array<{ text: string }> } };
    const text = data.message?.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Cohere');
    return text;
  }
}

// ─── Ollama Provider (Local — Gemma 4, Llama, etc.) ───
class OllamaProvider implements ModelProvider {
  name = 'ollama';
  model: string;
  private baseUrl: string;

  constructor(cfg: { baseUrl: string; model: string }) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.model = cfg.model;
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(system: string, prompt: string): Promise<string> {
    // Ollama exposes an OpenAI-compatible endpoint
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from Ollama');
    return text;
  }
}

// ─── Router ───
export class ModelRouter {
  private providers: ModelProvider[] = [];
  private defaultProviderName: string;
  private fastPath: FastPathRouter;

  constructor() {
    this.defaultProviderName = config.models.defaultProvider;
    this.fastPath = new FastPathRouter();

    // Register providers
    if (config.models.openai.apiKey) {
      this.providers.push(new OpenAIProvider({
        apiKey: config.models.openai.apiKey,
        model: config.models.openai.model,
      }));
    }

    if (config.models.anthropic.apiKey) {
      this.providers.push(new AnthropicProvider({
        apiKey: config.models.anthropic.apiKey,
      }));
    }

    if (config.models.google.apiKey) {
      this.providers.push(new GoogleProvider({
        apiKey: config.models.google.apiKey,
        model: config.models.google.model,
      }));
    }

    if (config.models.mistral.apiKey) {
      this.providers.push(new MistralProvider({
        apiKey: config.models.mistral.apiKey,
        model: config.models.mistral.model,
      }));
    }

    if (config.models.deepseek.apiKey) {
      this.providers.push(new DeepSeekProvider({
        apiKey: config.models.deepseek.apiKey,
        model: config.models.deepseek.model,
      }));
    }

    if (config.models.groq.apiKey) {
      this.providers.push(new GroqProvider({
        apiKey: config.models.groq.apiKey,
        model: config.models.groq.model,
      }));
    }

    // xAI (Grok) — OpenAI-compatible
    if ((config.models as any).xai?.apiKey) {
      this.providers.push(new XAIProvider({
        apiKey: (config.models as any).xai.apiKey,
        model: (config.models as any).xai.model ?? 'grok-3',
      }));
    }

    // Cohere (Command R+)
    if ((config.models as any).cohere?.apiKey) {
      this.providers.push(new CohereProvider({
        apiKey: (config.models as any).cohere.apiKey,
        model: (config.models as any).cohere.model ?? 'command-r-plus',
      }));
    }

    // Ollama — local, no API key needed
    if (config.models.ollama.enabled) {
      this.providers.push(new OllamaProvider({
        baseUrl: config.models.ollama.baseUrl,
        model: config.models.ollama.model,
      }));
    }

    // Diagnostic logging
    const registered = this.providers.map(p => p.name);
    console.log(`[ModelRouter] Registered providers: ${registered.length > 0 ? registered.join(', ') : 'NONE'}`);
    if (registered.length === 0) {
      console.warn('[ModelRouter] ⚠ No providers registered. Check your .env keys.');
    } else {
      console.log(`[ModelRouter] Default provider: ${this.defaultProviderName}`);
    }
  }

  async generate(system: string, prompt: string, preferredProvider?: string): Promise<{ text: string; model_used: string }> {
    const providerName = preferredProvider ?? this.defaultProviderName;

    // Try preferred provider first
    const preferred = this.providers.find(p => p.name === providerName);
    if (preferred && await preferred.available()) {
      try {
        const text = await preferred.generate(system, prompt);
        return { text, model_used: `${preferred.name}/${preferred.model}` };
      } catch (err) {
        console.error(`[ModelRouter] ${preferred.name} failed, trying fallback:`, (err as Error).message);
      }
    }

    // Fallback to any available provider
    for (const provider of this.providers) {
      if (provider.name === providerName) continue; // Already tried
      if (await provider.available()) {
        try {
          const text = await provider.generate(system, prompt);
          return { text, model_used: `${provider.name}/${provider.model}` };
        } catch (err) {
          console.error(`[ModelRouter] ${provider.name} fallback failed:`, (err as Error).message);
        }
      }
    }

    throw new Error('No AI model providers available. Check your API keys in .env');
  }

  getAvailableProviders(): string[] {
    return this.providers.map(p => p.name);
  }

  // ─── Smart Routing: pick the best model for the task type ───
  async smartGenerate(system: string, prompt: string, userInput: string): Promise<{ text: string; model_used: string; task_type: TaskType; latency_ms: number }> {
    if (!config.intelligence.smartRoutingEnabled) {
      const result = await this.generate(system, prompt);
      return { ...result, task_type: 'complex_reasoning', latency_ms: 0 };
    }

    const startTime = Date.now();
    const classification = this.fastPath.classifyTask(userInput);
    const preferredProvider = classification.recommended_provider;

    const result = await this.generate(system, prompt, preferredProvider);
    const latencyMs = Date.now() - startTime;

    // Record performance for learning
    this.fastPath.recordPerformance({
      provider: result.model_used.split('/')[0],
      model: result.model_used.split('/')[1] ?? '',
      task_type: classification.task_type,
      latency_ms: latencyMs,
      success: true,
      quality_score: classification.confidence,
      timestamp: new Date().toISOString(),
    });

    return {
      text: result.text,
      model_used: result.model_used,
      task_type: classification.task_type,
      latency_ms: latencyMs,
    };
  }

  // ─── Check if fast path should be used ───
  shouldUseFastPath(input: string): boolean {
    return this.fastPath.shouldUseFastPath(input);
  }

  // ─── Get the fast path provider name ───
  getFastPathProvider(): string {
    return config.intelligence.fastPathProvider;
  }

  // ─── Get task classification without generating ───
  classifyTask(input: string): { task_type: TaskType; provider: string } {
    const c = this.fastPath.classifyTask(input);
    return { task_type: c.task_type, provider: c.recommended_provider };
  }

  // ─── Get model performance stats ───
  getPerformanceStats(): Record<string, { avg_latency_ms: number; success_rate: number; avg_quality: number; count: number }> {
    return this.fastPath.getStats();
  }
}
