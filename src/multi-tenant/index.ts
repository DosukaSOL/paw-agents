// ─── PAW Multi-Tenant System — Tenant Isolation & Management ───
// Provides per-tenant configuration, user management, and resource isolation.

import {
  Tenant,
  TenantConfig,
  TenantUser,
  ChannelType,
} from '../core/types';
import { config } from '../core/config';
import { v4 as uuid } from 'uuid';
import { missionControl } from '../mission-control/index';

const DEFAULT_TENANT_CONFIG: TenantConfig = {
  max_users: 50,
  max_agents: 5,
  allowed_channels: ['telegram', 'discord', 'webchat', 'desktop', 'hub'],
  allowed_providers: ['openai', 'anthropic', 'ollama', 'groq'],
  rate_limit_per_minute: 30,
};

const PLAN_LIMITS: Record<Tenant['plan'], Partial<TenantConfig>> = {
  free: { max_users: 5, max_agents: 1, rate_limit_per_minute: 10 },
  pro: { max_users: 50, max_agents: 10, rate_limit_per_minute: 60 },
  enterprise: { max_users: 500, max_agents: 50, rate_limit_per_minute: 300 },
};

export class MultiTenantManager {
  private tenants = new Map<string, Tenant>();
  private tenantUsers = new Map<string, TenantUser[]>();

  get enabled(): boolean {
    return config.multiTenant.enabled;
  }

  // ─── Tenant CRUD ───

  createTenant(name: string, ownerId: string, plan: Tenant['plan'] = 'free'): Tenant {
    if (this.tenants.size >= config.multiTenant.maxTenants) {
      throw new Error('Maximum tenant limit reached');
    }

    const id = uuid();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check slug uniqueness
    for (const t of this.tenants.values()) {
      if (t.slug === slug) throw new Error(`Tenant slug "${slug}" already exists`);
    }

    const planLimits = PLAN_LIMITS[plan] ?? {};
    const tenantConfig: TenantConfig = { ...DEFAULT_TENANT_CONFIG, ...planLimits };

    const tenant: Tenant = {
      id,
      name,
      slug,
      owner_id: ownerId,
      plan,
      config: tenantConfig,
      created_at: new Date().toISOString(),
      active: true,
    };

    this.tenants.set(id, tenant);
    this.tenantUsers.set(id, [{
      user_id: ownerId,
      tenant_id: id,
      role: 'owner',
      joined_at: new Date().toISOString(),
      permissions: ['*'],
    }]);

    missionControl.log('info', 'multi-tenant', `Tenant created: ${name} (${plan})`);
    return tenant;
  }

  getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  getTenantBySlug(slug: string): Tenant | undefined {
    for (const t of this.tenants.values()) {
      if (t.slug === slug) return t;
    }
    return undefined;
  }

  listTenants(): Tenant[] {
    return Array.from(this.tenants.values());
  }

  updateTenantConfig(tenantId: string, partial: Partial<TenantConfig>): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error('Tenant not found');
    tenant.config = { ...tenant.config, ...partial };
  }

  deactivateTenant(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (tenant) tenant.active = false;
  }

  // ─── User Management ───

  addUser(tenantId: string, userId: string, role: TenantUser['role'] = 'member'): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    const users = this.tenantUsers.get(tenantId) ?? [];
    if (users.length >= tenant.config.max_users) {
      throw new Error('Tenant user limit reached');
    }
    if (users.some(u => u.user_id === userId)) {
      throw new Error('User already in tenant');
    }

    const permissions = role === 'viewer' ? ['read'] : role === 'member' ? ['read', 'write'] : ['*'];
    users.push({
      user_id: userId,
      tenant_id: tenantId,
      role,
      joined_at: new Date().toISOString(),
      permissions,
    });
    this.tenantUsers.set(tenantId, users);
  }

  removeUser(tenantId: string, userId: string): void {
    const users = this.tenantUsers.get(tenantId) ?? [];
    this.tenantUsers.set(tenantId, users.filter(u => u.user_id !== userId || u.role === 'owner'));
  }

  getUserTenant(userId: string): Tenant | undefined {
    for (const [tenantId, users] of this.tenantUsers) {
      if (users.some(u => u.user_id === userId)) {
        return this.tenants.get(tenantId);
      }
    }
    return undefined;
  }

  getUserRole(tenantId: string, userId: string): TenantUser['role'] | undefined {
    const users = this.tenantUsers.get(tenantId) ?? [];
    return users.find(u => u.user_id === userId)?.role;
  }

  getTenantUsers(tenantId: string): TenantUser[] {
    return this.tenantUsers.get(tenantId) ?? [];
  }

  // ─── Resource Checks ───

  canUseChannel(tenantId: string, channel: ChannelType): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant || !tenant.active) return false;
    return tenant.config.allowed_channels.includes(channel);
  }

  canUseProvider(tenantId: string, provider: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant || !tenant.active) return false;
    return tenant.config.allowed_providers.includes(provider);
  }

  getRateLimit(tenantId: string): number {
    const tenant = this.tenants.get(tenantId);
    return tenant?.config.rate_limit_per_minute ?? 10;
  }
}

// Singleton
export const multiTenantManager = new MultiTenantManager();
