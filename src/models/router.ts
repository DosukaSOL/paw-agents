// ─── Model Router — Multi-Model Abstraction Layer ───
// Supports multiple AI providers with dynamic selection and fallback.

import { ModelProvider, ModelConfig } from '../core/types';
import { config } from '../core/config';

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

// ─── Router ───
export class ModelRouter {
  private providers: ModelProvider[] = [];
  private defaultProviderName: string;

  constructor() {
    this.defaultProviderName = config.models.defaultProvider;

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
}
