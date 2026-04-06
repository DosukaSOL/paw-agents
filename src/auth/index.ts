// ─── PAW OAuth2 / SSO — Authentication & Session Management ───
// Provides OAuth2 authorization, session management, and RBAC.

import { AuthSession, OAuth2Config } from '../core/types';
import { config } from '../core/config';
import { v4 as uuid } from 'uuid';
import { createHmac, randomBytes } from 'crypto';
import { missionControl } from '../mission-control/index';

export class AuthManager {
  private sessions = new Map<string, AuthSession>();
  private sessionsByUser = new Map<string, Set<string>>();

  get enabled(): boolean {
    return config.oauth2.enabled;
  }

  // ─── Local Auth (API key / token) ───

  createLocalSession(userId: string, tenantId?: string): AuthSession {
    const sessionId = uuid();
    const accessToken = this.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

    const session: AuthSession = {
      session_id: sessionId,
      user_id: userId,
      tenant_id: tenantId,
      access_token: accessToken,
      expires_at: expiresAt,
      scopes: ['read', 'write', 'execute'],
      provider: 'local',
    };

    this.sessions.set(sessionId, session);
    if (!this.sessionsByUser.has(userId)) {
      this.sessionsByUser.set(userId, new Set());
    }
    this.sessionsByUser.get(userId)!.add(sessionId);

    missionControl.log('info', 'auth', `Session created for user ${userId}`);
    return session;
  }

  // ─── OAuth2 Flow ───

  getAuthorizationUrl(state: string): string {
    if (!config.oauth2.enabled) throw new Error('OAuth2 is not enabled');
    const params = new URLSearchParams({
      client_id: config.oauth2.clientId,
      response_type: 'code',
      state,
      scope: 'openid profile email',
    });
    return `${config.oauth2.issuerUrl}/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, tenantId?: string): Promise<AuthSession> {
    if (!config.oauth2.enabled) throw new Error('OAuth2 is not enabled');

    // Exchange code for tokens
    const tokenResponse = await fetch(`${config.oauth2.issuerUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.oauth2.clientId,
        client_secret: config.oauth2.clientSecret,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      throw new Error(`OAuth2 token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
    };

    // Get user info
    const userInfoResponse = await fetch(`${config.oauth2.issuerUrl}/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userInfo = await userInfoResponse.json() as { sub: string };
    const userId = userInfo.sub;

    const sessionId = uuid();
    const session: AuthSession = {
      session_id: sessionId,
      user_id: userId,
      tenant_id: tenantId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      scopes: ['read', 'write', 'execute'],
      provider: 'oauth2',
    };

    this.sessions.set(sessionId, session);
    if (!this.sessionsByUser.has(userId)) {
      this.sessionsByUser.set(userId, new Set());
    }
    this.sessionsByUser.get(userId)!.add(sessionId);

    missionControl.log('info', 'auth', `OAuth2 session created for user ${userId}`);
    return session;
  }

  // ─── Session Management ───

  validateSession(sessionId: string): AuthSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check expiry
    if (new Date(session.expires_at) < new Date()) {
      this.revokeSession(sessionId);
      return null;
    }

    return session;
  }

  validateToken(accessToken: string): AuthSession | null {
    for (const session of this.sessions.values()) {
      if (session.access_token === accessToken) {
        if (new Date(session.expires_at) < new Date()) {
          this.revokeSession(session.session_id);
          return null;
        }
        return session;
      }
    }
    return null;
  }

  revokeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessionsByUser.get(session.user_id)?.delete(sessionId);
      this.sessions.delete(sessionId);
    }
  }

  revokeAllUserSessions(userId: string): void {
    const sessionIds = this.sessionsByUser.get(userId);
    if (sessionIds) {
      for (const id of sessionIds) {
        this.sessions.delete(id);
      }
      this.sessionsByUser.delete(userId);
    }
  }

  getActiveSessions(): number {
    return this.sessions.size;
  }

  // ─── Token Generation ───

  private generateToken(): string {
    const secret = config.oauth2.sessionSecret || randomBytes(32).toString('hex');
    const payload = `${uuid()}-${Date.now()}`;
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  // ─── Cleanup expired sessions ───

  cleanupExpired(): number {
    const now = new Date();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (new Date(session.expires_at) < now) {
        this.revokeSession(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Singleton
export const authManager = new AuthManager();
