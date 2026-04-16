// ─── Enterprise RBAC + Audit Logging ───
// Role-Based Access Control with fine-grained permissions and comprehensive audit trails.
// Enables enterprise governance, compliance, and security monitoring.

import { v4 as uuid } from 'uuid';

export type Role = 'admin' | 'operator' | 'viewer' | 'custom';

export interface RoleDefinition {
  name: Role | string;
  description: string;
  permissions: Set<string>;
  created_at: string;
}

export interface User {
  id: string;
  username: string;
  roles: (Role | string)[];
  api_key_hash: string;
  created_at: string;
  last_active: string;
  is_active: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user_id: string;
  action: string;
  resource: string;
  status: 'allow' | 'deny';
  reason?: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}

export interface Permission {
  resource: string;
  action: string;
  description: string;
}

export const BUILT_IN_ROLES: Record<string, RoleDefinition> = {
  admin: {
    name: 'admin',
    description: 'Full access to all resources and operations',
    permissions: new Set([
      'agents:*',
      'tasks:*',
      'config:*',
      'users:*',
      'audit:*',
      'models:*',
    ]),
    created_at: new Date().toISOString(),
  },
  operator: {
    name: 'operator',
    description: 'Can manage agents and tasks, view logs',
    permissions: new Set([
      'agents:read',
      'agents:execute',
      'tasks:read',
      'tasks:create',
      'tasks:cancel',
      'logs:read',
      'models:read',
    ]),
    created_at: new Date().toISOString(),
  },
  viewer: {
    name: 'viewer',
    description: 'Read-only access to dashboard and status',
    permissions: new Set([
      'agents:read',
      'tasks:read',
      'logs:read',
      'metrics:read',
    ]),
    created_at: new Date().toISOString(),
  },
};

export class RBACEngine {
  private roles = new Map<string, RoleDefinition>();
  private users = new Map<string, User>();
  private auditLog: AuditLogEntry[] = [];

  constructor() {
    // Initialize built-in roles
    for (const role of Object.values(BUILT_IN_ROLES)) {
      this.roles.set(role.name, role);
    }
  }

  // ─── Create custom role ───
  createRole(name: string, permissions: string[], description: string = ''): RoleDefinition {
    const role: RoleDefinition = {
      name,
      description,
      permissions: new Set(permissions),
      created_at: new Date().toISOString(),
    };
    this.roles.set(name, role);
    return role;
  }

  // ─── Create user ───
  createUser(username: string, roles: string[], apiKeyHash: string): User {
    const user: User = {
      id: `user_${uuid()}`,
      username,
      roles,
      api_key_hash: apiKeyHash,
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
      is_active: true,
    };
    this.users.set(user.id, user);
    return user;
  }

  // ─── Check permission ───
  hasPermission(userId: string, resource: string, action: string): boolean {
    const user = this.users.get(userId);
    if (!user || !user.is_active) return false;

    // Check each role's permissions
    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (!role) continue;

      // Check exact permission match
      if (role.permissions.has(`${resource}:${action}`)) return true;

      // Check wildcard permission
      if (role.permissions.has(`${resource}:*`)) return true;
      if (role.permissions.has(`*:${action}`)) return true;
      if (role.permissions.has('*:*')) return true;
    }

    return false;
  }

  // ─── Audit permission check ───
  auditPermissionCheck(
    userId: string,
    resource: string,
    action: string,
    allowed: boolean,
    metadata?: Record<string, unknown>,
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: `audit_${uuid()}`,
      timestamp: new Date().toISOString(),
      user_id: userId,
      action,
      resource,
      status: allowed ? 'allow' : 'deny',
      metadata,
    };
    this.auditLog.push(entry);

    // Prune old entries (keep last 10000)
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }

    return entry;
  }

  // ─── Enforce permission (check + audit) ───
  enforcePermission(
    userId: string,
    resource: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): { allowed: boolean; reason?: string } {
    const allowed = this.hasPermission(userId, resource, action);
    this.auditPermissionCheck(userId, resource, action, allowed, metadata);

    if (!allowed) {
      const user = this.users.get(userId);
      return {
        allowed: false,
        reason: `User ${user?.username ?? 'unknown'} does not have permission: ${resource}:${action}`,
      };
    }

    return { allowed: true };
  }

  // ─── Get audit log ───
  getAuditLog(options?: {
    user_id?: string;
    action?: string;
    resource?: string;
    status?: 'allow' | 'deny';
    limit?: number;
  }): AuditLogEntry[] {
    let results = [...this.auditLog];

    if (options?.user_id) results = results.filter(e => e.user_id === options.user_id);
    if (options?.action) results = results.filter(e => e.action === options.action);
    if (options?.resource) results = results.filter(e => e.resource === options.resource);
    if (options?.status) results = results.filter(e => e.status === options.status);

    return results.slice(-(options?.limit ?? 100));
  }

  // ─── Update user activity ───
  updateLastActive(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.last_active = new Date().toISOString();
    }
  }

  // ─── Deactivate user ───
  deactivateUser(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.is_active = false;
    }
  }

  // ─── Get audit summary ───
  getAuditSummary(hours: number = 24): {
    total_actions: number;
    allowed_actions: number;
    denied_actions: number;
    top_users: Array<{ user_id: string; count: number }>;
    top_resources: Array<{ resource: string; count: number }>;
    denial_rate: number;
  } {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const recent = this.auditLog.filter(e => new Date(e.timestamp).getTime() > cutoff);

    const userCounts = new Map<string, number>();
    const resourceCounts = new Map<string, number>();
    let allowed = 0;
    let denied = 0;

    for (const entry of recent) {
      userCounts.set(entry.user_id, (userCounts.get(entry.user_id) ?? 0) + 1);
      resourceCounts.set(entry.resource, (resourceCounts.get(entry.resource) ?? 0) + 1);
      if (entry.status === 'allow') allowed++;
      else denied++;
    }

    return {
      total_actions: recent.length,
      allowed_actions: allowed,
      denied_actions: denied,
      top_users: Array.from(userCounts.entries())
        .map(([id, count]) => ({ user_id: id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      top_resources: Array.from(resourceCounts.entries())
        .map(([resource, count]) => ({ resource, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      denial_rate: recent.length > 0 ? denied / recent.length : 0,
    };
  }
}
