// ─── PAW Mobile — WebSocket Client ───
// Connects to the PAW Gateway from mobile devices.

const DEFAULT_GATEWAY = 'ws://127.0.0.1:18789';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface PawMessage {
  type: string;
  channel: string;
  from: string;
  payload: { text?: string; [key: string]: unknown };
  timestamp: string;
}

export class PawClient {
  private ws: WebSocket | null = null;
  private gatewayUrl: string;
  private authToken: string;
  private onMessageCallback: ((msg: PawMessage) => void) | null = null;
  private onStatusCallback: ((status: ConnectionStatus) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private clientId: string;

  constructor(gatewayUrl?: string, authToken?: string) {
    this.gatewayUrl = gatewayUrl ?? DEFAULT_GATEWAY;
    this.authToken = authToken ?? '';
    this.clientId = `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  connect(): void {
    this.updateStatus('connecting');

    try {
      const url = this.authToken
        ? `${this.gatewayUrl}?token=${encodeURIComponent(this.authToken)}`
        : this.gatewayUrl;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.updateStatus('connected');
        this.send(JSON.stringify({
          type: 'register',
          channel: 'mobile',
          client_id: this.clientId,
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as PawMessage;
          this.onMessageCallback?.(msg);
        } catch {
          // ignore malformed
        }
      };

      this.ws.onclose = () => {
        this.updateStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.updateStatus('error');
      };
    } catch {
      this.updateStatus('error');
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  sendMessage(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to PAW gateway');
    }

    this.send(JSON.stringify({
      type: 'message',
      channel: 'mobile',
      from: this.clientId,
      payload: { text },
      timestamp: new Date().toISOString(),
    }));
  }

  onMessage(callback: (msg: PawMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): void {
    this.onStatusCallback = callback;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private updateStatus(status: ConnectionStatus): void {
    this.onStatusCallback?.(status);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}
