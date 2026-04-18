// ─── PAW Streaming Engine ───
// Token-by-token streaming for all 7 AI providers + Ollama.
// Streams over WebSocket and can pipe to voice TTS sentence-by-sentence.

import { EventEmitter } from 'events';
import { config } from '../core/config';

export interface StreamChunk {
  text: string;
  done: boolean;
  provider: string;
  model: string;
  token_count: number;
}

export type StreamCallback = (chunk: StreamChunk) => void;

// ─── Provider Streaming Interfaces ───
interface StreamProvider {
  name: string;
  model: string;
  available(): boolean;
  stream(system: string, prompt: string, onChunk: StreamCallback): Promise<string>;
}

// ─── OpenAI Streaming ───
class OpenAIStream implements StreamProvider {
  name = 'openai';
  model: string;
  private apiKey: string;

  constructor() {
    this.apiKey = config.models.openai.apiKey;
    this.model = config.models.openai.model;
  }

  available(): boolean { return this.apiKey.length > 0; }

  async stream(system: string, prompt: string, onChunk: StreamCallback): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
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
          stream: true,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    return this.processSSE(response, 'openai', this.model, onChunk);
  }

  private async processSSE(response: Response, provider: string, model: string, onChunk: StreamCallback): Promise<string> {
    if (!response.ok) throw new Error(`${provider} stream error: ${response.status}`);
    if (!response.body) throw new Error(`${provider} stream: no body`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let tokenCount = 0;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.substring(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            tokenCount++;
            onChunk({ text: content, done: false, provider, model, token_count: tokenCount });
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    onChunk({ text: '', done: true, provider, model, token_count: tokenCount });
    return fullText;
  }
}

// ─── Anthropic Streaming ───
class AnthropicStream implements StreamProvider {
  name = 'anthropic';
  model = 'claude-sonnet-4-20250514';
  private apiKey: string;

  constructor() {
    this.apiKey = config.models.anthropic.apiKey;
  }

  available(): boolean { return this.apiKey.length > 0; }

  async stream(system: string, prompt: string, onChunk: StreamCallback): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
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
          stream: true,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`Anthropic stream error: ${response.status}`);
    if (!response.body) throw new Error('Anthropic stream: no body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let tokenCount = 0;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.substring(6);

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            tokenCount++;
            onChunk({ text: parsed.delta.text, done: false, provider: 'anthropic', model: this.model, token_count: tokenCount });
          }
        } catch {
          // Skip
        }
      }
    }

    onChunk({ text: '', done: true, provider: 'anthropic', model: this.model, token_count: tokenCount });
    return fullText;
  }
}

// ─── Google AI Streaming ───
class GoogleStream implements StreamProvider {
  name = 'google';
  model: string;
  private apiKey: string;

  constructor() {
    this.apiKey = config.models.google.apiKey;
    this.model = config.models.google.model;
  }

  available(): boolean { return this.apiKey.length > 0; }

  async stream(system: string, prompt: string, onChunk: StreamCallback): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
          }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`Google stream error: ${response.status}`);
    if (!response.body) throw new Error('Google stream: no body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let tokenCount = 0;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const parsed = JSON.parse(trimmed.substring(6));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullText += text;
            tokenCount++;
            onChunk({ text, done: false, provider: 'google', model: this.model, token_count: tokenCount });
          }
        } catch {
          // Skip
        }
      }
    }

    onChunk({ text: '', done: true, provider: 'google', model: this.model, token_count: tokenCount });
    return fullText;
  }
}

// ─── OpenAI-Compatible Stream (Mistral, DeepSeek, Groq, Ollama) ───
class OpenAICompatibleStream implements StreamProvider {
  name: string;
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(name: string, baseUrl: string, apiKey: string, model: string) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
  }

  available(): boolean {
    if (this.name === 'ollama') return config.models.ollama.enabled;
    return this.apiKey.length > 0;
  }

  async stream(system: string, prompt: string, onChunk: StreamCallback): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const controller = new AbortController();
    const timeoutMs = this.name === 'ollama' ? 60_000 : 30_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 4096,
          stream: true,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`${this.name} stream error: ${response.status}`);
    if (!response.body) throw new Error(`${this.name} stream: no body`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let tokenCount = 0;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.substring(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            tokenCount++;
            onChunk({ text: content, done: false, provider: this.name, model: this.model, token_count: tokenCount });
          }
        } catch {
          // Skip
        }
      }
    }

    onChunk({ text: '', done: true, provider: this.name, model: this.model, token_count: tokenCount });
    return fullText;
  }
}

// ─── Main Streaming Engine ───
export class StreamingEngine extends EventEmitter {
  private providers: StreamProvider[] = [];

  constructor() {
    super();

    this.providers.push(new OpenAIStream());
    this.providers.push(new AnthropicStream());
    this.providers.push(new GoogleStream());

    // Mistral
    this.providers.push(new OpenAICompatibleStream(
      'mistral', 'https://api.mistral.ai/v1',
      config.models.mistral.apiKey, config.models.mistral.model
    ));

    // DeepSeek
    this.providers.push(new OpenAICompatibleStream(
      'deepseek', 'https://api.deepseek.com',
      config.models.deepseek.apiKey, config.models.deepseek.model
    ));

    // Groq
    this.providers.push(new OpenAICompatibleStream(
      'groq', 'https://api.groq.com/openai/v1',
      config.models.groq.apiKey, config.models.groq.model
    ));

    // Ollama
    this.providers.push(new OpenAICompatibleStream(
      'ollama', `${config.models.ollama.baseUrl}/v1`,
      '', config.models.ollama.model
    ));

    // xAI (Grok) — OpenAI-compatible
    if ((config.models as any).xai?.apiKey) {
      this.providers.push(new OpenAICompatibleStream(
        'xai', 'https://api.x.ai/v1',
        (config.models as any).xai.apiKey, (config.models as any).xai.model ?? 'grok-3'
      ));
    }

    // Cohere — uses different streaming format, register as OpenAI-compatible for now
    if ((config.models as any).cohere?.apiKey) {
      this.providers.push(new OpenAICompatibleStream(
        'cohere', 'https://api.cohere.com/compatibility/v1',
        (config.models as any).cohere.apiKey, (config.models as any).cohere.model ?? 'command-r-plus'
      ));
    }
  }

  // ─── Stream from preferred provider ───
  async stream(system: string, prompt: string, onChunk: StreamCallback, preferredProvider?: string): Promise<string> {
    const providerName = preferredProvider ?? config.models.defaultProvider;

    // Try preferred
    const preferred = this.providers.find(p => p.name === providerName);
    if (preferred?.available()) {
      try {
        return await preferred.stream(system, prompt, onChunk);
      } catch (err) {
        console.error(`[Stream] ${preferred.name} failed, trying fallback:`, (err as Error).message);
      }
    }

    // Fallback
    for (const provider of this.providers) {
      if (provider.name === providerName) continue;
      if (provider.available()) {
        try {
          return await provider.stream(system, prompt, onChunk);
        } catch (err) {
          console.error(`[Stream] ${provider.name} fallback failed:`, (err as Error).message);
        }
      }
    }

    throw new Error('No streaming providers available');
  }

  // ─── Stream with sentence buffering (for TTS) ───
  async streamSentences(system: string, prompt: string, onSentence: (sentence: string, done: boolean) => void, preferredProvider?: string): Promise<string> {
    let sentenceBuffer = '';
    let fullText = '';

    const result = await this.stream(system, prompt, (chunk) => {
      if (chunk.done) {
        // Flush remaining buffer
        if (sentenceBuffer.trim()) {
          onSentence(sentenceBuffer.trim(), true);
        }
        return;
      }

      sentenceBuffer += chunk.text;
      fullText += chunk.text;

      // Check for sentence boundaries
      const sentenceEnd = sentenceBuffer.match(/[.!?]\s/);
      if (sentenceEnd && sentenceEnd.index !== undefined) {
        const sentence = sentenceBuffer.substring(0, sentenceEnd.index + 1).trim();
        sentenceBuffer = sentenceBuffer.substring(sentenceEnd.index + 2);

        if (sentence.length > 0) {
          onSentence(sentence, false);
        }
      }
    }, preferredProvider);

    return result;
  }

  // ─── Get available streaming providers ───
  getAvailableProviders(): string[] {
    return this.providers.filter(p => p.available()).map(p => p.name);
  }
}
