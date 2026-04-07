// ─── MQTT Channel Adapter ───
// Connects PAW to IoT devices via MQTT protocol.
// User provides their own MQTT broker credentials.

import { ChannelAdapter, ChannelType } from '../../core/types';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class MQTTAdapter implements ChannelAdapter {
  name: ChannelType = 'mqtt';
  private handler: MessageHandler | null = null;
  private client: any = null;
  private brokerUrl: string;
  private topic: string;
  private username: string;
  private password: string;

  constructor() {
    this.brokerUrl = process.env.MQTT_BROKER_URL ?? '';
    this.topic = process.env.MQTT_TOPIC ?? 'paw/agents/#';
    this.username = process.env.MQTT_USERNAME ?? '';
    this.password = process.env.MQTT_PASSWORD ?? '';
  }

  async start(): Promise<void> {
    if (!this.brokerUrl) {
      console.log('[PAW:MQTT] No MQTT_BROKER_URL configured, skipping.');
      return;
    }

    try {
      const mqtt = await import('mqtt' as string);
      this.client = mqtt.connect(this.brokerUrl, {
        username: this.username || undefined,
        password: this.password || undefined,
        clientId: `paw-agent-${Date.now()}`,
      });

      this.client.on('connect', () => {
        console.log(`[PAW:MQTT] 📡 Connected to ${this.brokerUrl}`);
        this.client.subscribe(this.topic, (err: Error | null) => {
          if (err) console.error('[PAW:MQTT] Subscribe error:', err.message);
        });
      });

      this.client.on('message', async (topic: string, payload: Buffer) => {
        try {
          const message = payload.toString('utf-8');
          if (this.handler) {
            await this.handler(`mqtt:${topic}`, message, 'api');
          }
        } catch (err) {
          console.error('[PAW:MQTT] Message handler error:', (err as Error).message);
        }
      });

      this.client.on('error', (err: Error) => {
        console.error('[PAW:MQTT] Error:', err.message);
      });
    } catch (err) {
      console.warn('[PAW:MQTT] mqtt package not installed. Install with: npm install mqtt');
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.client) return;
    // Extract topic from userId (mqtt:topic/path)
    const topic = userId.replace('mqtt:', '');
    this.client.publish(`${topic}/response`, message);
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  // ─── Publish to a specific topic ───
  publish(topic: string, message: string): void {
    if (this.client) {
      this.client.publish(topic, message);
    }
  }
}
