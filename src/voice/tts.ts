// ─── PAW Voice: Text-to-Speech Engine ───
// Provider-agnostic TTS with free local (Piper) and cloud options.
// User chooses provider and brings their own API keys for cloud services.

import { config } from '../core/config';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

export type TTSProvider = 'piper' | 'elevenlabs' | 'google' | 'azure' | 'polly';

export interface TTSConfig {
  provider: TTSProvider;
  apiKey?: string;         // Required for cloud providers
  voice?: string;          // Voice ID or name
  speed?: number;          // Speech speed multiplier (default: 1.0)
  pitch?: number;          // Pitch adjustment
  language?: string;       // Language code
  outputFormat?: string;   // wav, mp3, ogg
}

export interface SpeechResult {
  audio: Buffer;
  format: string;
  duration_ms: number;
  provider: TTSProvider;
  voice: string;
  text_length: number;
}

export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  gender?: string;
  provider: TTSProvider;
}

// ─── Abstract TTS Provider ───
interface TTSProviderEngine {
  name: TTSProvider;
  available(): Promise<boolean>;
  synthesize(text: string, voice?: string): Promise<SpeechResult>;
  listVoices?(): Promise<VoiceInfo[]>;
}

// ─── Piper TTS (FREE, LOCAL) ───
class PiperTTS implements TTSProviderEngine {
  name: TTSProvider = 'piper';
  private piperPath: string | null = null;
  private modelPath: string;
  private defaultVoice: string;

  constructor(voice: string = 'en_US-lessac-medium') {
    this.defaultVoice = voice;
    this.modelPath = config.voice?.tts?.piperModelPath ?? path.join(process.cwd(), 'data', 'piper-models');
  }

  async available(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', ['piper']);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  async synthesize(text: string, voice?: string): Promise<SpeechResult> {
    const startTime = Date.now();
    const voiceName = voice ?? this.defaultVoice;
    const outPath = `/tmp/paw-tts/output_${Date.now()}.wav`;

    fs.mkdirSync('/tmp/paw-tts', { recursive: true });

    return new Promise((resolve, reject) => {
      const args = [
        '--model', path.join(this.modelPath, `${voiceName}.onnx`),
        '--output_file', outPath,
      ];

      const proc = spawn('piper', args);
      let stderr = '';

      proc.stdin.write(text);
      proc.stdin.end();

      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Piper TTS failed (code ${code}): ${stderr}`));
          return;
        }

        try {
          const audio = await fsp.readFile(outPath);
          await fsp.unlink(outPath);

          resolve({
            audio,
            format: 'wav',
            duration_ms: Date.now() - startTime,
            provider: 'piper',
            voice: voiceName,
            text_length: text.length,
          });
        } catch (err) {
          reject(new Error(`Failed to read Piper output: ${(err as Error).message}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Piper not found. Install with: pip install piper-tts — ${err.message}`));
      });
    });
  }
}

// ─── ElevenLabs TTS (Cloud — user provides API key) ───
class ElevenLabsTTS implements TTSProviderEngine {
  name: TTSProvider = 'elevenlabs';
  private apiKey: string;
  private defaultVoice: string;

  constructor(apiKey: string, voice: string = 'Rachel') {
    this.apiKey = apiKey;
    this.defaultVoice = voice;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async synthesize(text: string, voice?: string): Promise<SpeechResult> {
    const startTime = Date.now();
    const voiceId = voice ?? this.defaultVoice;

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      format: 'mp3',
      duration_ms: Date.now() - startTime,
      provider: 'elevenlabs',
      voice: voiceId,
      text_length: text.length,
    };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': this.apiKey },
    });

    if (!response.ok) return [];

    const data = await response.json() as {
      voices: Array<{
        voice_id: string;
        name: string;
        labels?: { language?: string; gender?: string };
      }>;
    };

    return (data.voices ?? []).map(v => ({
      id: v.voice_id,
      name: v.name,
      language: v.labels?.language ?? 'en',
      gender: v.labels?.gender,
      provider: 'elevenlabs' as TTSProvider,
    }));
  }
}

// ─── Google Cloud TTS (Cloud — user provides API key) ───
class GoogleTTS implements TTSProviderEngine {
  name: TTSProvider = 'google';
  private apiKey: string;
  private defaultVoice: string;

  constructor(apiKey: string, voice: string = 'en-US-Neural2-F') {
    this.apiKey = apiKey;
    this.defaultVoice = voice;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async synthesize(text: string, voice?: string): Promise<SpeechResult> {
    const startTime = Date.now();
    const voiceName = voice ?? this.defaultVoice;

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: voiceName.substring(0, 5), // e.g. 'en-US'
            name: voiceName,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: config.voice?.tts?.speed ?? 1.0,
            pitch: config.voice?.tts?.pitch ?? 0,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Google TTS API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { audioContent: string };
    const audio = Buffer.from(data.audioContent, 'base64');

    return {
      audio,
      format: 'mp3',
      duration_ms: Date.now() - startTime,
      provider: 'google',
      voice: voiceName,
      text_length: text.length,
    };
  }
}

// ─── Azure TTS (Cloud — user provides API key) ───
class AzureTTS implements TTSProviderEngine {
  name: TTSProvider = 'azure';
  private apiKey: string;
  private region: string;
  private defaultVoice: string;

  constructor(apiKey: string, region: string = 'eastus', voice: string = 'en-US-JennyNeural') {
    this.apiKey = apiKey;
    this.region = region;
    this.defaultVoice = voice;
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async synthesize(text: string, voice?: string): Promise<SpeechResult> {
    const startTime = Date.now();
    const voiceName = voice ?? this.defaultVoice;

    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
      <voice name='${voiceName}'>${this.escapeXml(text)}</voice>
    </speak>`;

    const response = await fetch(
      `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        },
        body: ssml,
      }
    );

    if (!response.ok) {
      throw new Error(`Azure TTS API error: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      format: 'mp3',
      duration_ms: Date.now() - startTime,
      provider: 'azure',
      voice: voiceName,
      text_length: text.length,
    };
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

// ─── Amazon Polly TTS (Cloud — user provides API key) ───
class PollyTTS implements TTSProviderEngine {
  name: TTSProvider = 'polly';
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;
  private defaultVoice: string;

  constructor(accessKeyId: string, secretAccessKey: string, region: string = 'us-east-1', voice: string = 'Joanna') {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
    this.defaultVoice = voice;
  }

  async available(): Promise<boolean> {
    return this.accessKeyId.length > 0 && this.secretAccessKey.length > 0;
  }

  async synthesize(text: string, voice?: string): Promise<SpeechResult> {
    const startTime = Date.now();
    const voiceName = voice ?? this.defaultVoice;

    // AWS Polly requires Signature V4 — use simple POST for now
    // Users with Polly should use the AWS SDK; this is a lightweight fallback
    try {
      const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly' as string);
      const client = new PollyClient({
        region: this.region,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });

      const command = new SynthesizeSpeechCommand({
        Text: text,
        OutputFormat: 'mp3',
        VoiceId: voiceName,
        Engine: 'neural',
      });

      const result = await client.send(command);
      const chunks: Buffer[] = [];
      for await (const chunk of result.AudioStream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      const audio = Buffer.concat(chunks);

      return {
        audio,
        format: 'mp3',
        duration_ms: Date.now() - startTime,
        provider: 'polly',
        voice: voiceName,
        text_length: text.length,
      };
    } catch {
      throw new Error('Amazon Polly requires @aws-sdk/client-polly. Install with: npm install @aws-sdk/client-polly');
    }
  }
}

// ─── Main TTS Engine ───
export class TextToSpeech extends EventEmitter {
  private providers: TTSProviderEngine[] = [];
  private activeProvider: TTSProviderEngine | null = null;
  private speaking = false;

  constructor() {
    super();
    this.initProviders();
  }

  private initProviders(): void {
    const voiceConfig = config.voice;

    // Always register Piper (free, local)
    this.providers.push(new PiperTTS(voiceConfig?.tts?.voice));

    // Register cloud providers if user has provided API keys
    const ttsKey = voiceConfig?.tts?.apiKey ?? '';
    const ttsProvider = voiceConfig?.tts?.provider ?? 'piper';

    if (ttsKey && ttsProvider === 'elevenlabs') {
      this.providers.push(new ElevenLabsTTS(ttsKey, voiceConfig?.tts?.voice));
    }
    if (ttsKey && ttsProvider === 'google') {
      this.providers.push(new GoogleTTS(ttsKey, voiceConfig?.tts?.voice));
    }
    if (ttsKey && ttsProvider === 'azure') {
      this.providers.push(new AzureTTS(ttsKey, voiceConfig?.tts?.azureRegion, voiceConfig?.tts?.voice));
    }
    if (voiceConfig?.tts?.awsAccessKeyId && ttsProvider === 'polly') {
      this.providers.push(new PollyTTS(
        voiceConfig.tts.awsAccessKeyId,
        voiceConfig.tts.awsSecretAccessKey ?? '',
        voiceConfig.tts.awsRegion,
        voiceConfig.tts.voice,
      ));
    }

    // Set active provider: prefer user's choice, fall back to Piper
    this.activeProvider = this.providers.find(p => p.name === ttsProvider) ?? this.providers[0];
  }

  // ─── Get active provider name ───
  getProvider(): TTSProvider {
    return this.activeProvider?.name ?? 'piper';
  }

  // ─── Switch provider at runtime ───
  async setProvider(provider: TTSProvider): Promise<boolean> {
    const p = this.providers.find(e => e.name === provider);
    if (!p) return false;
    if (!(await p.available())) return false;
    this.activeProvider = p;
    return true;
  }

  // ─── List available providers ───
  async getAvailableProviders(): Promise<TTSProvider[]> {
    const available: TTSProvider[] = [];
    for (const p of this.providers) {
      if (await p.available()) available.push(p.name);
    }
    return available;
  }

  // ─── Synthesize text to speech ───
  async synthesize(text: string, voice?: string): Promise<SpeechResult> {
    if (!this.activeProvider) throw new Error('No TTS provider available');
    this.speaking = true;
    try {
      const result = await this.activeProvider.synthesize(text, voice);
      this.emit('speech', result);
      return result;
    } finally {
      this.speaking = false;
    }
  }

  // ─── Synthesize and save to file ───
  async synthesizeToFile(text: string, outputPath: string, voice?: string): Promise<SpeechResult> {
    const result = await this.synthesize(text, voice);
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await fsp.writeFile(outputPath, result.audio);
    return result;
  }

  // ─── List available voices for current provider ───
  async listVoices(): Promise<VoiceInfo[]> {
    if (!this.activeProvider) return [];
    if ('listVoices' in this.activeProvider && this.activeProvider.listVoices) {
      return this.activeProvider.listVoices();
    }
    return [];
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  stopSpeaking(): void {
    this.speaking = false;
    this.emit('stop');
  }
}
