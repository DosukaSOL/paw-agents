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
  private reconnectAttempts = 0;
  private reconnectDelay = 3000;
  private static readonly MAX_RECONNECT_DELAY = 30_000;
  private static readonly MAX_RECONNECT_ATTEMPTS = 60;

  constructor(gatewayUrl?: string, authToken?: string) {
    this.gatewayUrl = gatewayUrl ?? DEFAULT_GATEWAY;
    this.authToken = authToken ?? '';
    this.clientId = `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  connect(): void {
    this.updateStatus('connecting');

    try {
      // Auth token is sent inside the register message, NOT in the URL,
      // to keep secrets out of access logs / proxies.
      this.ws = new WebSocket(this.gatewayUrl);

      this.ws.onopen = () => {
        this.updateStatus('connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 3000;
        this.send(JSON.stringify({
          type: 'register',
          channel: 'mobile',
          client_id: this.clientId,
          auth_token: this.authToken || undefined,
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
    if (this.reconnectAttempts >= PawClient.MAX_RECONNECT_ATTEMPTS) {
      this.updateStatus('error');
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, PawClient.MAX_RECONNECT_DELAY);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
