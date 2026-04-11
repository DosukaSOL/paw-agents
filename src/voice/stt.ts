// ─── PAW Voice: Speech-to-Text Engine ───
// Provider-agnostic STT with free local (Whisper) and cloud options.
// User chooses provider and brings their own API keys for cloud services.

import { config } from '../core/config';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

export type STTProvider = 'whisper' | 'google' | 'azure' | 'deepgram' | 'assemblyai';

export interface STTConfig {
  provider: STTProvider;
  apiKey?: string;        // Required for cloud providers
  language?: string;       // e.g. 'en', 'es', 'nl'
  model?: string;          // Provider-specific model name
  whisperModelSize?: string; // tiny, base, small, medium, large
  sampleRate?: number;     // Audio sample rate (default: 16000)
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language?: string;
  duration_ms: number;
  provider: STTProvider;
  is_final: boolean;
}

export interface STTEvents {
  'transcription': (result: TranscriptionResult) => void;
  'partial': (text: string) => void;
  'error': (error: Error) => void;
  'listening': () => void;
  'stopped': () => void;
  'wake-word': (word: string) => void;
}

// ─── Abstract STT Provider ───
interface STTProviderEngine {
  name: STTProvider;
  available(): Promise<boolean>;
  transcribeFile(audioPath: string): Promise<TranscriptionResult>;
  transcribeBuffer(audio: Buffer, format?: string): Promise<TranscriptionResult>;
  startStreaming?(onResult: (result: TranscriptionResult) => void): Promise<void>;
  stopStreaming?(): Promise<void>;
}

// ─── Whisper Provider (FREE, LOCAL) ───
class WhisperSTT implements STTProviderEngine {
  name: STTProvider = 'whisper';
  private modelSize: string;
  private whisperPath: string | null = null;

  constructor(modelSize: string = 'base') {
    this.modelSize = modelSize;
  }

  async available(): Promise<boolean> {
    // Check if whisper CLI is available
    return new Promise((resolve) => {
      const proc = spawn('which', ['whisper']);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  async transcribeFile(audioPath: string): Promise<TranscriptionResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const args = [
        audioPath,
        '--model', this.modelSize,
        '--output_format', 'json',
        '--output_dir', '/tmp/paw-whisper',
        '--language', config.voice?.stt?.language ?? 'en',
        '--fp16', 'False',
      ];

      fs.mkdirSync('/tmp/paw-whisper', { recursive: true });

      const proc = spawn('whisper', args);
      let stderr = '';

      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Whisper failed (code ${code}): ${stderr}`));
          return;
        }

        try {
          const baseName = path.basename(audioPath, path.extname(audioPath));
          const jsonPath = path.join('/tmp/paw-whisper', `${baseName}.json`);
          const result = JSON.parse(await fsp.readFile(jsonPath, 'utf-8'));
          const text = result.text?.trim() ?? '';

          resolve({
            text,
            confidence: 0.85, // Whisper doesn't provide confidence scores
            language: result.language,
            duration_ms: Date.now() - startTime,
            provider: 'whisper',
            is_final: true,
          });
        } catch (err) {
          reject(new Error(`Failed to parse Whisper output: ${(err as Error).message}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Whisper not found. Install with: pip install openai-whisper — ${err.message}`));
      });
    });
  }

  async transcribeBuffer(audio: Buffer, format: string = 'wav'): Promise<TranscriptionResult> {
    // Write buffer to temp file, then transcribe
    const tmpPath = `/tmp/paw-whisper/input_${Date.now()}.${format}`;
    fs.mkdirSync('/tmp/paw-whisper', { recursive: true });
    await fsp.writeFile(tmpPath, audio);
    try {
      return await this.transcribeFile(tmpPath);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

// ─── Google Speech-to-Text (Cloud — user provides API key) ───
class GoogleSTT implements STTProviderEngine {
  name: STTProvider = 'google';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async transcribeFile(audioPath: string): Promise<TranscriptionResult> {
    return this.transcribeBuffer(await fsp.readFile(audioPath));
  }

  async transcribeBuffer(audio: Buffer): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const audioContent = audio.toString('base64');

    const response = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: config.voice?.stt?.language ?? 'en-US',
            enableAutomaticPunctuation: true,
          },
          audio: { content: audioContent },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Google Speech API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      results?: Array<{
        alternatives?: Array<{ transcript: string; confidence: number }>;
      }>;
    };

    const result = data.results?.[0]?.alternatives?.[0];

    return {
      text: result?.transcript ?? '',
      confidence: result?.confidence ?? 0,
      duration_ms: Date.now() - startTime,
      provider: 'google',
      is_final: true,
    };
  }
}

// ─── Azure Speech-to-Text (Cloud — user provides API key) ───
class AzureSTT implements STTProviderEngine {
  name: STTProvider = 'azure';
  private apiKey: string;
  private region: string;

  constructor(apiKey: string, region: string = 'eastus') {
    this.apiKey = apiKey;
    this.region = region;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async transcribeFile(audioPath: string): Promise<TranscriptionResult> {
    return this.transcribeBuffer(await fsp.readFile(audioPath));
  }

  async transcribeBuffer(audio: Buffer): Promise<TranscriptionResult> {
    const startTime = Date.now();

    const response = await fetch(
      `https://${this.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${config.voice?.stt?.language ?? 'en-US'}`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        },
        body: audio,
      }
    );

    if (!response.ok) {
      throw new Error(`Azure Speech API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      RecognitionStatus: string;
      DisplayText?: string;
      Offset?: number;
      Duration?: number;
      NBest?: Array<{ Confidence: number; Display: string }>;
    };

    return {
      text: data.DisplayText ?? '',
      confidence: data.NBest?.[0]?.Confidence ?? 0,
      duration_ms: Date.now() - startTime,
      provider: 'azure',
      is_final: true,
    };
  }
}

// ─── Deepgram STT (Cloud — user provides API key) ───
class DeepgramSTT implements STTProviderEngine {
  name: STTProvider = 'deepgram';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async transcribeFile(audioPath: string): Promise<TranscriptionResult> {
    return this.transcribeBuffer(await fsp.readFile(audioPath));
  }

  async transcribeBuffer(audio: Buffer): Promise<TranscriptionResult> {
    const startTime = Date.now();

    const response = await fetch('https://api.deepgram.com/v1/listen?punctuate=true&model=nova-2', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: audio,
    });

    if (!response.ok) {
      throw new Error(`Deepgram API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript: string;
            confidence: number;
          }>;
        }>;
      };
    };

    const alt = data.results?.channels?.[0]?.alternatives?.[0];

    return {
      text: alt?.transcript ?? '',
      confidence: alt?.confidence ?? 0,
      duration_ms: Date.now() - startTime,
      provider: 'deepgram',
      is_final: true,
    };
  }
}

// ─── AssemblyAI STT (Cloud — user provides API key) ───
class AssemblyAISTT implements STTProviderEngine {
  name: STTProvider = 'assemblyai';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async transcribeFile(audioPath: string): Promise<TranscriptionResult> {
    return this.transcribeBuffer(await fsp.readFile(audioPath));
  }

  async transcribeBuffer(audio: Buffer): Promise<TranscriptionResult> {
    const startTime = Date.now();

    // Step 1: Upload audio
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { 'Authorization': this.apiKey },
      body: audio,
    });

    if (!uploadRes.ok) {
      throw new Error(`AssemblyAI upload error: ${uploadRes.status}`);
    }

    const { upload_url } = await uploadRes.json() as { upload_url: string };

    // Step 2: Create transcription
    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        language_code: config.voice?.stt?.language ?? 'en',
      }),
    });

    if (!transcriptRes.ok) {
      throw new Error(`AssemblyAI transcription error: ${transcriptRes.status}`);
    }

    const { id } = await transcriptRes.json() as { id: string };

    // Step 3: Poll for result (max 60 seconds)
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));

      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(id)}`, {
        headers: { 'Authorization': this.apiKey },
      });

      const poll = await pollRes.json() as {
        status: string;
        text?: string;
        confidence?: number;
        error?: string;
      };

      if (poll.status === 'completed') {
        return {
          text: poll.text ?? '',
          confidence: poll.confidence ?? 0,
          duration_ms: Date.now() - startTime,
          provider: 'assemblyai',
          is_final: true,
        };
      }

      if (poll.status === 'error') {
        throw new Error(`AssemblyAI error: ${poll.error}`);
      }
    }

    throw new Error('AssemblyAI transcription timed out');
  }
}

// ─── Main STT Engine ───
export class SpeechToText extends EventEmitter {
  private providers: STTProviderEngine[] = [];
  private activeProvider: STTProviderEngine | null = null;
  private wakeWords: string[] = ['hey paw', 'ok paw', 'paw'];
  private listening = false;

  constructor() {
    super();
    this.initProviders();
  }

  private initProviders(): void {
    const voiceConfig = config.voice;

    // Always register Whisper (free, local)
    this.providers.push(new WhisperSTT(voiceConfig?.stt?.whisperModelSize ?? 'base'));

    // Register cloud providers if user has provided API keys
    const sttKey = voiceConfig?.stt?.apiKey ?? '';
    const sttProvider = voiceConfig?.stt?.provider ?? 'whisper';

    if (sttKey && sttProvider === 'google') {
      this.providers.push(new GoogleSTT(sttKey));
    }
    if (sttKey && sttProvider === 'azure') {
      this.providers.push(new AzureSTT(sttKey, voiceConfig?.stt?.azureRegion));
    }
    if (sttKey && sttProvider === 'deepgram') {
      this.providers.push(new DeepgramSTT(sttKey));
    }
    if (sttKey && sttProvider === 'assemblyai') {
      this.providers.push(new AssemblyAISTT(sttKey));
    }

    // Set active provider: prefer user's choice, fall back to Whisper
    this.activeProvider = this.providers.find(p => p.name === sttProvider) ?? this.providers[0];
  }

  // ─── Get active provider name ───
  getProvider(): STTProvider {
    return this.activeProvider?.name ?? 'whisper';
  }

  // ─── Switch provider at runtime ───
  async setProvider(provider: STTProvider): Promise<boolean> {
    const p = this.providers.find(e => e.name === provider);
    if (!p) return false;
    if (!(await p.available())) return false;
    this.activeProvider = p;
    return true;
  }

  // ─── List available providers ───
  async getAvailableProviders(): Promise<STTProvider[]> {
    const available: STTProvider[] = [];
    for (const p of this.providers) {
      if (await p.available()) available.push(p.name);
    }
    return available;
  }

  // ─── Transcribe audio file ───
  async transcribeFile(audioPath: string): Promise<TranscriptionResult> {
    if (!this.activeProvider) throw new Error('No STT provider available');
    return this.activeProvider.transcribeFile(audioPath);
  }

  // ─── Transcribe audio buffer ───
  async transcribeBuffer(audio: Buffer, format?: string): Promise<TranscriptionResult> {
    if (!this.activeProvider) throw new Error('No STT provider available');
    return this.activeProvider.transcribeBuffer(audio, format);
  }

  // ─── Check for wake word in transcription ───
  detectWakeWord(text: string): string | null {
    const lower = text.toLowerCase().trim();
    for (const word of this.wakeWords) {
      if (lower.startsWith(word)) {
        return word;
      }
    }
    return null;
  }

  // ─── Configure wake words ───
  setWakeWords(words: string[]): void {
    this.wakeWords = words.map(w => w.toLowerCase().trim());
  }

  // ─── Strip wake word from text ───
  stripWakeWord(text: string): string {
    const lower = text.toLowerCase().trim();
    for (const word of this.wakeWords) {
      if (lower.startsWith(word)) {
        return text.trim().substring(word.length).trim();
      }
    }
    return text.trim();
  }

  isListening(): boolean {
    return this.listening;
  }

  setListening(state: boolean): void {
    this.listening = state;
    this.emit(state ? 'listening' : 'stopped');
  }
}
