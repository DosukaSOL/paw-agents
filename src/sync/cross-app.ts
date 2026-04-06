// ─── PAW Cross-App Memory Sync — Unified State Across All Channels ───
// Ensures actions, memories, and conversations sync across telegram, discord,
// desktop, hub, mission control, and all other channels in real-time.

import {
  SyncEvent,
  SharedMemory,
  CrossAppSession,
  CrossAppMessage,
  ActionRecord,
  ChannelType,
} from '../core/types';
import { config } from '../core/config';
import { v4 as uuid } from 'uuid';
import { missionControl } from '../mission-control/index';

export class CrossAppSync {
  private sharedMemory = new Map<string, SharedMemory>();
  private sessions = new Map<string, CrossAppSession>();
  private actionHistory: ActionRecord[] = [];
  private syncListeners = new Map<ChannelType | 'all', Set<(event: SyncEvent) => void>>();

  // ─── Memory Operations ───

  setMemory(key: string, value: unknown, sourceChannel: ChannelType, scope: SharedMemory['scope'] = 'user', ttlMs?: number): void {
    const existing = this.sharedMemory.get(key);
    const version = (existing?.version ?? 0) + 1;

    this.sharedMemory.set(key, {
      key,
      value,
      scope,
      source_channel: sourceChannel,
      updated_at: new Date().toISOString(),
      version,
      ttl_ms: ttlMs,
    });

    // Broadcast to all channels
    this.broadcastSync({
      event_id: uuid(),
      type: 'memory_update',
      source_channel: sourceChannel,
      target_channels: 'all',
      payload: { key, value, scope, version },
      timestamp: new Date().toISOString(),
      user_id: '', // Set by caller
    });
  }

  getMemory(key: string): SharedMemory | undefined {
    const mem = this.sharedMemory.get(key);
    if (!mem) return undefined;

    // Check TTL
    if (mem.ttl_ms) {
      const age = Date.now() - new Date(mem.updated_at).getTime();
      if (age > mem.ttl_ms) {
        this.sharedMemory.delete(key);
        return undefined;
      }
    }

    return mem;
  }

  getAllMemory(scope?: SharedMemory['scope']): SharedMemory[] {
    const all = Array.from(this.sharedMemory.values());
    return scope ? all.filter(m => m.scope === scope) : all;
  }

  deleteMemory(key: string): void {
    this.sharedMemory.delete(key);
  }

  // ─── Cross-App Sessions ───

  getOrCreateSession(userId: string): CrossAppSession {
    let session = this.sessions.get(userId);
    if (!session) {
      session = {
        session_id: uuid(),
        user_id: userId,
        active_channels: [],
        shared_context: {},
        conversation_history: [],
        created_at: new Date().toISOString(),
        last_sync: new Date().toISOString(),
      };
      this.sessions.set(userId, session);
    }
    return session;
  }

  addChannelToSession(userId: string, channel: ChannelType): void {
    const session = this.getOrCreateSession(userId);
    if (!session.active_channels.includes(channel)) {
      session.active_channels.push(channel);
    }
    session.last_sync = new Date().toISOString();
  }

  removeChannelFromSession(userId: string, channel: ChannelType): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.active_channels = session.active_channels.filter(c => c !== channel);
    }
  }

  addMessage(userId: string, content: string, role: 'user' | 'agent', sourceChannel: ChannelType, actionType?: string, metadata?: Record<string, unknown>): void {
    const session = this.getOrCreateSession(userId);
    const msg: CrossAppMessage = {
      id: uuid(),
      content,
      role,
      source_channel: sourceChannel,
      timestamp: new Date().toISOString(),
      action_type: actionType,
      metadata,
    };
    session.conversation_history.push(msg);

    // Cap history
    if (session.conversation_history.length > 1000) {
      session.conversation_history = session.conversation_history.slice(-500);
    }

    session.last_sync = new Date().toISOString();
  }

  getSessionHistory(userId: string, limit = 50): CrossAppMessage[] {
    const session = this.sessions.get(userId);
    if (!session) return [];
    return session.conversation_history.slice(-limit);
  }

  // ─── Action Tracking ───

  recordAction(action: string, description: string, sourceChannel: ChannelType, userId: string, durationMs: number, success: boolean, tenantId?: string, metadata?: Record<string, unknown>): void {
    const record: ActionRecord = {
      id: uuid(),
      action,
      description,
      source_channel: sourceChannel,
      user_id: userId,
      tenant_id: tenantId,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      status: success ? 'success' : 'failed',
      metadata,
    };

    this.actionHistory.push(record);

    // Cap history
    if (this.actionHistory.length > (config.hub?.maxRecentActions ?? 500)) {
      this.actionHistory = this.actionHistory.slice(-250);
    }

    // Broadcast action to all channels
    this.broadcastSync({
      event_id: uuid(),
      type: 'action_completed',
      source_channel: sourceChannel,
      target_channels: 'all',
      payload: record,
      timestamp: record.timestamp,
      user_id: userId,
    });
  }

  getActionHistory(limit = 50, channel?: ChannelType): ActionRecord[] {
    let actions = this.actionHistory;
    if (channel) {
      actions = actions.filter(a => a.source_channel === channel);
    }
    return actions.slice(-limit);
  }

  getActionsByUser(userId: string, limit = 50): ActionRecord[] {
    return this.actionHistory.filter(a => a.user_id === userId).slice(-limit);
  }

  // ─── Real-Time Sync Listeners ───

  onSync(channel: ChannelType | 'all', listener: (event: SyncEvent) => void): () => void {
    if (!this.syncListeners.has(channel)) {
      this.syncListeners.set(channel, new Set());
    }
    this.syncListeners.get(channel)!.add(listener);
    return () => this.syncListeners.get(channel)?.delete(listener);
  }

  private broadcastSync(event: SyncEvent): void {
    // Send to 'all' listeners
    const allListeners = this.syncListeners.get('all') ?? new Set();
    for (const listener of allListeners) {
      try { listener(event); } catch { /* ignore */ }
    }

    // Send to channel-specific listeners
    if (event.target_channels === 'all') {
      for (const [channel, listeners] of this.syncListeners) {
        if (channel === 'all') continue;
        for (const listener of listeners) {
          try { listener(event); } catch { /* ignore */ }
        }
      }
    } else {
      for (const channel of event.target_channels) {
        const listeners = this.syncListeners.get(channel) ?? new Set();
        for (const listener of listeners) {
          try { listener(event); } catch { /* ignore */ }
        }
      }
    }
  }

  // ─── Stats ───

  getStats(): { sessions: number; memories: number; actions: number; channels: Set<ChannelType> } {
    const channels = new Set<ChannelType>();
    for (const session of this.sessions.values()) {
      for (const ch of session.active_channels) {
        channels.add(ch);
      }
    }
    return {
      sessions: this.sessions.size,
      memories: this.sharedMemory.size,
      actions: this.actionHistory.length,
      channels,
    };
  }
}

// Singleton
export const crossAppSync = new CrossAppSync();
