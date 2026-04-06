// ─── PAW Plugin Marketplace — Extensible Plugin System ───
// Load, manage, and execute plugins that extend PAW's capabilities.

import {
  Plugin,
  PluginManifest,
  PluginInstance,
  PluginHook,
  PluginCategory,
} from '../core/types';
import { v4 as uuid } from 'uuid';
import { missionControl } from '../mission-control/index';

export class PluginMarketplace {
  private plugins = new Map<string, PluginInstance>();
  private hooks = new Map<string, Array<{ pluginId: string; handler: string; priority: number }>>();
  private registry: Plugin[] = [];

  // ─── Plugin Lifecycle ───

  async loadPlugin(manifest: PluginManifest, pluginConfig: Record<string, unknown> = {}): Promise<void> {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin ${manifest.id} is already loaded`);
    }

    // Validate manifest
    if (!manifest.id || !manifest.name || !manifest.entry_point) {
      throw new Error('Invalid plugin manifest: missing required fields');
    }

    // Validate permissions
    const allowedPermissions = ['read_messages', 'send_messages', 'read_memory', 'write_memory', 'execute_skills', 'read_config', 'network_access'];
    for (const perm of manifest.permissions) {
      if (!allowedPermissions.includes(perm)) {
        throw new Error(`Plugin ${manifest.id} requests unauthorized permission: ${perm}`);
      }
    }

    const instance: PluginInstance = {
      manifest,
      config: pluginConfig,
      state: 'loaded',
    };

    this.plugins.set(manifest.id, instance);

    // Register hooks
    for (const hook of manifest.hooks) {
      this.registerHook(hook.event, manifest.id, hook.handler, hook.priority);
    }

    missionControl.log('info', 'plugin-marketplace', `Plugin loaded: ${manifest.name} v${manifest.version}`);
  }

  async activatePlugin(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) throw new Error(`Plugin ${pluginId} not found`);
    if (instance.state === 'active') return;

    try {
      instance.state = 'active';
      missionControl.log('info', 'plugin-marketplace', `Plugin activated: ${instance.manifest.name}`);
    } catch (err) {
      instance.state = 'error';
      instance.error = (err as Error).message;
      throw err;
    }
  }

  async deactivatePlugin(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) throw new Error(`Plugin ${pluginId} not found`);

    instance.state = 'disabled';

    // Remove hooks
    for (const [event, handlers] of this.hooks) {
      this.hooks.set(event, handlers.filter(h => h.pluginId !== pluginId));
    }

    missionControl.log('info', 'plugin-marketplace', `Plugin deactivated: ${instance.manifest.name}`);
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    await this.deactivatePlugin(pluginId).catch(() => {});
    this.plugins.delete(pluginId);
    missionControl.log('info', 'plugin-marketplace', `Plugin unloaded: ${pluginId}`);
  }

  // ─── Hook System ───

  private registerHook(event: string, pluginId: string, handler: string, priority: number): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    const handlers = this.hooks.get(event)!;
    handlers.push({ pluginId, handler, priority });
    handlers.sort((a, b) => b.priority - a.priority);
  }

  async executeHooks(event: PluginHook['event'], context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const handlers = this.hooks.get(event) ?? [];
    let result = { ...context };

    for (const { pluginId } of handlers) {
      const instance = this.plugins.get(pluginId);
      if (!instance || instance.state !== 'active') continue;

      try {
        // Hooks modify the context in-place
        // In a real implementation, this would call the plugin's handler function
        result = { ...result, [`_plugin_${pluginId}`]: true };
      } catch (err) {
        missionControl.log('error', 'plugin-marketplace', `Hook error in ${pluginId}: ${(err as Error).message}`);
      }
    }

    return result;
  }

  // ─── Registry / Marketplace ───

  getInstalledPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).map(instance => ({
      id: instance.manifest.id,
      name: instance.manifest.name,
      version: instance.manifest.version,
      author: instance.manifest.author,
      description: instance.manifest.description,
      category: instance.manifest.category,
      entry_point: instance.manifest.entry_point,
      permissions: instance.manifest.permissions,
      config_schema: instance.manifest.config_schema,
      installed: true,
      enabled: instance.state === 'active',
    }));
  }

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  getPluginCount(): number {
    return this.plugins.size;
  }

  getActivePluginCount(): number {
    let count = 0;
    for (const instance of this.plugins.values()) {
      if (instance.state === 'active') count++;
    }
    return count;
  }

  // ─── Built-in Plugin Templates ───

  static getBuiltinTemplates(): PluginManifest[] {
    return [
      {
        id: 'paw-defi-alerts',
        name: 'DeFi Price Alerts',
        version: '1.0.0',
        paw_version: '3.4.0',
        author: 'PAW Team',
        description: 'Monitor DeFi positions and get alerts on price changes, liquidation risks, and yield opportunities.',
        category: 'defi',
        entry_point: 'defi-alerts/index.ts',
        permissions: ['read_messages', 'send_messages', 'network_access'],
        config_schema: { tokens: { type: 'array', default: ['SOL', 'USDC'] }, threshold_pct: { type: 'number', default: 5 } },
        hooks: [{ event: 'on_message', handler: 'checkPriceAlerts', priority: 50 }],
      },
      {
        id: 'paw-analytics',
        name: 'Usage Analytics',
        version: '1.0.0',
        paw_version: '3.4.0',
        author: 'PAW Team',
        description: 'Track usage patterns, popular commands, and generate insights about agent utilization.',
        category: 'analytics',
        entry_point: 'analytics/index.ts',
        permissions: ['read_messages', 'read_memory'],
        config_schema: { retention_days: { type: 'number', default: 30 } },
        hooks: [
          { event: 'after_execute', handler: 'trackExecution', priority: 10 },
          { event: 'on_message', handler: 'trackMessage', priority: 10 },
        ],
      },
      {
        id: 'paw-github-integration',
        name: 'GitHub Integration',
        version: '1.0.0',
        paw_version: '3.4.0',
        author: 'PAW Team',
        description: 'Create issues, manage PRs, and monitor repos directly from PAW.',
        category: 'integration',
        entry_point: 'github/index.ts',
        permissions: ['read_messages', 'send_messages', 'network_access'],
        config_schema: { github_token: { type: 'string' }, default_repo: { type: 'string' } },
        hooks: [{ event: 'on_message', handler: 'handleGithubCommands', priority: 60 }],
      },
      {
        id: 'paw-scheduler',
        name: 'Advanced Scheduler',
        version: '1.0.0',
        paw_version: '3.4.0',
        author: 'PAW Team',
        description: 'Schedule recurring tasks, reminders, and automated workflows with natural language.',
        category: 'utility',
        entry_point: 'scheduler/index.ts',
        permissions: ['read_messages', 'send_messages', 'execute_skills'],
        config_schema: { max_schedules: { type: 'number', default: 100 } },
        hooks: [{ event: 'on_message', handler: 'handleScheduleCommands', priority: 70 }],
      },
    ];
  }
}

// Singleton
export const pluginMarketplace = new PluginMarketplace();
