// ─── Matrix / Element Channel Adapter ───
// Connects PAW Agents to Matrix rooms via the Matrix Client-Server API.

import { ChannelAdapter, ChannelType } from '../../core/types';
import { config } from '../../core/config';

type MessageHandler = (userId: string, message: string, channel: ChannelType) => Promise<void>;

export class MatrixAdapter implements ChannelAdapter {
  name: ChannelType = 'matrix';
  private handler: MessageHandler | null = null;
  private syncToken: string = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private homeserverUrl: string = '';
  private accessToken: string = '';
  private botUserId: string = '';

  async start(): Promise<void> {
    this.homeserverUrl = config.matrix.homeserverUrl.replace(/\/$/, '');
    this.accessToken = config.matrix.accessToken;
    this.botUserId = config.matrix.userId;

    if (!this.homeserverUrl || !this.accessToken) {
      console.log('[PAW:Matrix] No MATRIX_HOMESERVER_URL configured, skipping Matrix channel.');
      return;
    }

    try {
      // Initial sync to get the sync token
      const syncRes = await fetch(`${this.homeserverUrl}/_matrix/client/v3/sync?timeout=0`, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });

      if (!syncRes.ok) {
        throw new Error(`Matrix sync failed: ${syncRes.status}`);
      }

      const syncData = await syncRes.json() as { next_batch: string };
      this.syncToken = syncData.next_batch;

      // Poll for new events every 5 seconds
      this.pollTimer = setInterval(() => this.poll(), 5_000);

      console.log(`[PAW:Matrix] 💬 Matrix connected as ${this.botUserId}`);
    } catch (err) {
      console.warn('[PAW:Matrix] Failed to start:', (err as Error).message);
    }
  }

  private async poll(): Promise<void> {
    if (!this.syncToken || !this.handler) return;

    try {
      const syncRes = await fetch(
        `${this.homeserverUrl}/_matrix/client/v3/sync?since=${this.syncToken}&timeout=10000&filter=${encodeURIComponent(JSON.stringify({ room: { timeline: { limit: 10 } } }))}`,
        { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
      );

      if (!syncRes.ok) return;

      const syncData = await syncRes.json() as {
        next_batch: string;
        rooms?: {
          join?: Record<string, {
            timeline?: {
              events?: Array<{
                type: string;
                sender: string;
                content: { msgtype?: string; body?: string };
                event_id: string;
              }>;
            };
          }>;
        };
      };

      this.syncToken = syncData.next_batch;

      // Process messages from joined rooms
      const joinedRooms = syncData.rooms?.join ?? {};
      for (const [roomId, room] of Object.entries(joinedRooms)) {
        const events = room.timeline?.events ?? [];
        for (const event of events) {
          if (event.type !== 'm.room.message') continue;
          if (event.sender === this.botUserId) continue; // Skip own messages
          if (event.content.msgtype !== 'm.text') continue;

          const userId = `matrix:${event.sender}:${roomId}`;
          const text = event.content.body ?? '';
          if (text && this.handler) {
            await this.handler(userId, text, 'matrix');
          }
        }
      }
    } catch (err) {
      console.error('[PAW:Matrix] Poll error:', (err as Error).message);
    }
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async send(userId: string, message: string): Promise<void> {
    if (!this.homeserverUrl || !this.accessToken) return;
    // userId format: matrix:@user:server:!roomId:server
    const parts = userId.replace('matrix:', '').split(':');
    // Extract roomId (last part after the sender)
    const roomId = parts.slice(2).join(':');
    if (!roomId) return;

    try {
      const txnId = `paw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await fetch(
        `${this.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ msgtype: 'm.text', body: message }),
        }
      );
    } catch (err) {
      console.error('[PAW:Matrix] Send failed:', (err as Error).message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
