// ─── Voice Channel Adapter ───
// Integrates voice as a first-class PAW channel, just like Telegram or Discord.
// Receives audio input, processes through STT → Agent → TTS pipeline.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { VoiceAgent } from '../../voice/voice-agent';
import { PawAgent } from '../../agent/loop';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class VoiceAdapter implements ChannelAdapter {
  name: ChannelType = 'voice';
  private handler: MessageHandler | null = null;
  private voiceAgent: VoiceAgent;
  private responseCallbacks = new Map<string, (message: string) => void>();

  constructor(agent?: PawAgent) {
    this.voiceAgent = new VoiceAgent(agent);
  }

  async start(): Promise<void> {
    console.log('[PAW:Voice] 🎤 Voice channel initialized');
    console.log(`[PAW:Voice] STT: ${this.voiceAgent.getSTT().getProvider()}`);
    console.log(`[PAW:Voice] TTS: ${this.voiceAgent.getTTS().getProvider()}`);
  }

  async stop(): Promise<void> {
    this.voiceAgent.stopListening();
  }

  async send(userId: string, message: string): Promise<void> {
    // When the agent wants to reply via voice, synthesize speech
    const callback = this.responseCallbacks.get(userId);
    if (callback) {
      callback(message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── Expose the voice agent for direct use ───
  getVoiceAgent(): VoiceAgent {
    return this.voiceAgent;
  }

  // ─── Process audio from external source (Hub, API, etc.) ───
  async processAudio(userId: string, audioBuffer: Buffer, format: string = 'wav'): Promise<{
    text: string;
    response: string;
    audioResponse?: Buffer;
  }> {
    const result = await this.voiceAgent.processAudio(audioBuffer, userId, format);
    return {
      text: result.transcription.text,
      response: result.response.message,
      audioResponse: result.speech?.audio,
    };
  }

  // ─── Register a callback for when voice responses are ready ───
  onResponse(userId: string, callback: (message: string) => void): void {
    this.responseCallbacks.set(userId, callback);
  }
}
