// ─── WebChat Channel Adapter ───
// Browser-based chat via WebSocket connection for the PAW control panel.

import { ChannelAdapter, ChannelType } from '../../core/types';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

interface WebChatClient {
  id: string;
  send: (data: string) => void;
}

export class WebChatAdapter implements ChannelAdapter {
  name: ChannelType = 'webchat';
  private handler: MessageHandler | null = null;
  private clients = new Map<string, WebChatClient>();

  async start(): Promise<void> {
    // WebChat doesn't start its own server — it piggybacks on the Gateway WebSocket.
    console.log('[PAW:WebChat] 🌐 WebChat adapter ready (connects via Gateway).');
  }

  async stop(): Promise<void> {
    this.clients.clear();
  }

  // Called by Gateway when a WebSocket client connects
  registerClient(client: WebChatClient): void {
    this.clients.set(client.id, client);
  }

  // Called by Gateway when a WebSocket client disconnects
  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  // Called by Gateway when a WebSocket message is received
  async handleIncoming(clientId: string, message: string): Promise<void> {
    if (this.handler) {
      await this.handler(`webchat:${clientId}`, message, 'webchat');
    }
  }

  async send(userId: string, message: string): Promise<void> {
    const clientId = userId.replace('webchat:', '');
    const client = this.clients.get(clientId);
    if (client) {
      client.send(JSON.stringify({ type: 'message', content: message }));
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
