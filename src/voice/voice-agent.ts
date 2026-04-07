// ─── PAW Voice Agent ───
// The voice interaction loop: listen → transcribe → process → speak.
// Integrates STT and TTS with the main agent pipeline.
// Supports wake word detection, continuous listening, and interruption handling.

import { EventEmitter } from 'events';
import { SpeechToText, TranscriptionResult } from './stt';
import { TextToSpeech, SpeechResult } from './tts';
import { PawAgent, AgentResponse } from '../agent/loop';
import { TraceLogger } from '../trace/index';
import { config } from '../core/config';

export interface VoiceAgentConfig {
  wakeWordEnabled: boolean;
  wakeWords?: string[];
  continuousListening: boolean;
  autoSpeak: boolean;          // Automatically speak responses
  interruptible: boolean;      // Allow user to interrupt TTS
  silenceTimeout: number;      // ms of silence before processing (default: 1500)
  maxRecordingDuration: number; // max recording length in ms (default: 30000)
}

export interface VoiceConversation {
  id: string;
  userId: string;
  messages: VoiceMessage[];
  started_at: string;
  last_activity: string;
}

export interface VoiceMessage {
  role: 'user' | 'agent';
  text: string;
  audio_duration_ms?: number;
  timestamp: string;
  stt_provider?: string;
  tts_provider?: string;
}

export type VoiceAgentState = 'idle' | 'listening' | 'processing' | 'speaking' | 'wake-word-waiting';

export class VoiceAgent extends EventEmitter {
  private stt: SpeechToText;
  private tts: TextToSpeech;
  private agent: PawAgent | null = null;
  private state: VoiceAgentState = 'idle';
  private config: VoiceAgentConfig;
  private conversations = new Map<string, VoiceConversation>();
  private trace: TraceLogger;

  constructor(agentInstance?: PawAgent) {
    super();
    this.stt = new SpeechToText();
    this.tts = new TextToSpeech();
    this.agent = agentInstance ?? null;
    this.trace = new TraceLogger();

    const voiceConfig = config.voice;
    this.config = {
      wakeWordEnabled: voiceConfig?.wakeWordEnabled ?? true,
      wakeWords: voiceConfig?.wakeWords,
      continuousListening: voiceConfig?.continuousListening ?? false,
      autoSpeak: voiceConfig?.autoSpeak ?? true,
      interruptible: voiceConfig?.interruptible ?? true,
      silenceTimeout: voiceConfig?.silenceTimeout ?? 1500,
      maxRecordingDuration: voiceConfig?.maxRecordingDuration ?? 30000,
    };

    if (this.config.wakeWords) {
      this.stt.setWakeWords(this.config.wakeWords);
    }
  }

  // ─── Bind to a PAW agent instance ───
  setAgent(agent: PawAgent): void {
    this.agent = agent;
  }

  // ─── Get current state ───
  getState(): VoiceAgentState {
    return this.state;
  }

  // ─── Get STT engine ───
  getSTT(): SpeechToText {
    return this.stt;
  }

  // ─── Get TTS engine ───
  getTTS(): TextToSpeech {
    return this.tts;
  }

  // ─── Process audio input (main entry point) ───
  async processAudio(audioBuffer: Buffer, userId: string = 'voice-user', format: string = 'wav'): Promise<{
    transcription: TranscriptionResult;
    response: AgentResponse;
    speech?: SpeechResult;
  }> {
    this.setState('processing');

    try {
      // Step 1: Transcribe
      const transcription = await this.stt.transcribeBuffer(audioBuffer, format);

      this.trace.log('intake', {
        input: `[Voice] ${transcription.text}`,
        metadata: {
          stt_provider: transcription.provider,
          confidence: transcription.confidence,
          duration_ms: transcription.duration_ms,
        },
        duration_ms: transcription.duration_ms,
      });

      if (!transcription.text.trim()) {
        this.setState('idle');
        return {
          transcription,
          response: { success: true, message: '' },
        };
      }

      // Step 2: Wake word check (if enabled)
      let processText = transcription.text;
      if (this.config.wakeWordEnabled) {
        const wake = this.stt.detectWakeWord(transcription.text);
        if (wake) {
          processText = this.stt.stripWakeWord(transcription.text);
          this.emit('wake-word', wake);
        } else if (this.state === 'wake-word-waiting') {
          // No wake word detected — ignore input
          this.setState('wake-word-waiting');
          return {
            transcription,
            response: { success: true, message: '' },
          };
        }
      }

      // Step 3: Track conversation
      this.addMessage(userId, {
        role: 'user',
        text: processText,
        audio_duration_ms: transcription.duration_ms,
        timestamp: new Date().toISOString(),
        stt_provider: transcription.provider,
      });

      // Step 4: Process through agent
      if (!this.agent) {
        throw new Error('No PAW agent bound to voice agent. Call setAgent() first.');
      }

      const response = await this.agent.process(userId, processText);

      // Step 5: Track agent response
      this.addMessage(userId, {
        role: 'agent',
        text: response.message,
        timestamp: new Date().toISOString(),
      });

      // Step 6: Speak response (if enabled)
      let speech: SpeechResult | undefined;
      if (this.config.autoSpeak && response.message) {
        this.setState('speaking');
        try {
          speech = await this.tts.synthesize(this.cleanForSpeech(response.message));
          this.addMessage(userId, {
            role: 'agent',
            text: response.message,
            audio_duration_ms: speech.duration_ms,
            timestamp: new Date().toISOString(),
            tts_provider: speech.provider,
          });
        } catch (err) {
          console.warn('[VoiceAgent] TTS failed:', (err as Error).message);
        }
      }

      this.setState(this.config.continuousListening ? 'listening' : 'idle');
      this.emit('response', { transcription, response, speech });

      return { transcription, response, speech };
    } catch (err) {
      this.setState('idle');
      throw err;
    }
  }

  // ─── Process text input with voice output ───
  async processText(text: string, userId: string = 'voice-user'): Promise<{
    response: AgentResponse;
    speech?: SpeechResult;
  }> {
    if (!this.agent) {
      throw new Error('No PAW agent bound to voice agent. Call setAgent() first.');
    }

    const response = await this.agent.process(userId, text);

    let speech: SpeechResult | undefined;
    if (this.config.autoSpeak && response.message) {
      this.setState('speaking');
      try {
        speech = await this.tts.synthesize(this.cleanForSpeech(response.message));
      } catch (err) {
        console.warn('[VoiceAgent] TTS failed:', (err as Error).message);
      }
      this.setState('idle');
    }

    return { response, speech };
  }

  // ─── Start continuous listening mode ───
  startListening(): void {
    this.config.continuousListening = true;
    this.setState(this.config.wakeWordEnabled ? 'wake-word-waiting' : 'listening');
    this.stt.setListening(true);
    this.emit('listening-started');
    console.log(`[VoiceAgent] 🎤 Listening started (STT: ${this.stt.getProvider()}, TTS: ${this.tts.getProvider()})`);
  }

  // ─── Stop continuous listening ───
  stopListening(): void {
    this.config.continuousListening = false;
    this.stt.setListening(false);
    this.setState('idle');
    this.emit('listening-stopped');
    console.log('[VoiceAgent] 🔇 Listening stopped');
  }

  // ─── Interrupt current speech ───
  interrupt(): void {
    if (this.state === 'speaking' && this.config.interruptible) {
      this.tts.stopSpeaking();
      this.setState('listening');
      this.emit('interrupted');
    }
  }

  // ─── Get voice status ───
  getStatus(): {
    state: VoiceAgentState;
    stt_provider: string;
    tts_provider: string;
    continuous_listening: boolean;
    wake_word_enabled: boolean;
    active_conversations: number;
  } {
    return {
      state: this.state,
      stt_provider: this.stt.getProvider(),
      tts_provider: this.tts.getProvider(),
      continuous_listening: this.config.continuousListening,
      wake_word_enabled: this.config.wakeWordEnabled,
      active_conversations: this.conversations.size,
    };
  }

  // ─── Get conversation history ───
  getConversation(userId: string): VoiceConversation | undefined {
    return this.conversations.get(userId);
  }

  // ─── Clean text for speech output (remove markdown, emojis, etc.) ───
  private cleanForSpeech(text: string): string {
    return text
      // Remove markdown formatting
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/```[\s\S]*?```/g, 'code block omitted')
      // Remove common emoji patterns
      .replace(/[⚠️✅❌🔓🤖🐾🎮📊⬆️⬇️➡️]/g, '')
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, 'link')
      // Clean up whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ─── Track conversation messages ───
  private addMessage(userId: string, message: VoiceMessage): void {
    let conversation = this.conversations.get(userId);
    if (!conversation) {
      conversation = {
        id: `voice-${Date.now()}`,
        userId,
        messages: [],
        started_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      };
      this.conversations.set(userId, conversation);
    }

    conversation.messages.push(message);
    conversation.last_activity = new Date().toISOString();

    // Cap conversation history at 100 messages
    if (conversation.messages.length > 100) {
      conversation.messages = conversation.messages.slice(-100);
    }
  }

  // ─── Update state and emit event ───
  private setState(newState: VoiceAgentState): void {
    const prev = this.state;
    this.state = newState;
    if (prev !== newState) {
      this.emit('state-change', { from: prev, to: newState });
    }
  }
}
