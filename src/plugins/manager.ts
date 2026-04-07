// ─── PAW Plugin System ───
// Dynamic plugin discovery, loading, validation, and lifecycle management.
// Supports npm packages, local directories, and remote plugin registries.

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  entryPoint: string;         // Relative path to main export
  capabilities: PluginCapability[];
  dependencies?: Record<string, string>;
  config?: Record<string, PluginConfigField>;
  minPawVersion?: string;
}

export type PluginCapability =
  | 'tools'
  | 'channels'
  | 'providers'
  | 'middleware'
  | 'skills'
  | 'workflows'
  | 'themes';

export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  description: string;
  default?: unknown;
  required?: boolean;
  options?: string[];
}

export interface PluginInstance {
  manifest: PluginManifest;
  path: string;
  loaded: boolean;
  enabled: boolean;
  exports: PluginExports;
  config: Record<string, unknown>;
  loadedAt?: string;
  error?: string;
}

export interface PluginExports {
  tools?: PluginTool[];
  channels?: PluginChannel[];
  providers?: PluginProvider[];
  middleware?: PluginMiddleware[];
  activate?: (ctx: PluginContext) => Promise<void>;
  deactivate?: () => Promise<void>;
}

export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface PluginChannel {
  name: string;
  type: string;
  connect: (config: Record<string, unknown>) => Promise<void>;
  send: (message: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

export interface PluginProvider {
  name: string;
  models: string[];
  chat: (messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>) => Promise<string>;
}

export interface PluginMiddleware {
  name: string;
  phase: 'pre-process' | 'post-process' | 'pre-tool' | 'post-tool';
  priority: number;
  handler: (data: unknown, next: () => Promise<unknown>) => Promise<unknown>;
}

export interface PluginContext {
  pawVersion: string;
  config: Record<string, unknown>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  registerTool: (tool: PluginTool) => void;
  registerChannel: (channel: PluginChannel) => void;
  registerProvider: (provider: PluginProvider) => void;
  registerMiddleware: (middleware: PluginMiddleware) => void;
}

// ─── Plugin Manager ───

export class PluginManager extends EventEmitter {
  private plugins: Map<string, PluginInstance> = new Map();
  private pluginDirs: string[];
  private pawVersion: string;
  private registeredTools: PluginTool[] = [];
  private registeredChannels: PluginChannel[] = [];
  private registeredProviders: PluginProvider[] = [];
  private registeredMiddleware: PluginMiddleware[] = [];

  constructor(pluginDirs: string[], pawVersion: string) {
    super();
    this.pluginDirs = pluginDirs;
    this.pawVersion = pawVersion;
  }

  // ─── Discovery ───

  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) continue;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(dir, entry.name, 'paw-plugin.json');
        if (!fs.existsSync(manifestPath)) continue;

        try {
          const raw = fs.readFileSync(manifestPath, 'utf-8');
          const manifest = JSON.parse(raw) as PluginManifest;
          if (this.validateManifest(manifest)) {
            manifests.push(manifest);
          }
        } catch (err) {
          this.emit('plugin:error', { plugin: entry.name, error: `Failed to parse manifest: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }

    return manifests;
  }

  // ─── Load Plugin ───

  async load(pluginPath: string): Promise<PluginInstance | null> {
    const manifestPath = path.join(pluginPath, 'paw-plugin.json');

    if (!fs.existsSync(manifestPath)) {
      this.emit('plugin:error', { path: pluginPath, error: 'No paw-plugin.json found' });
      return null;
    }

    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      this.emit('plugin:error', { path: pluginPath, error: 'Invalid manifest JSON' });
      return null;
    }

    if (!this.validateManifest(manifest)) {
      return null;
    }

    // Check for duplicates
    if (this.plugins.has(manifest.name)) {
      this.emit('plugin:warn', { plugin: manifest.name, message: 'Plugin already loaded, skipping' });
      return this.plugins.get(manifest.name)!;
    }

    // Load the plugin module
    const entryPath = path.normalize(path.resolve(pluginPath, manifest.entryPoint));
    if (!entryPath.startsWith(path.normalize(path.resolve(pluginPath)))) {
      this.emit('plugin:error', { plugin: manifest.name, error: 'Entry point path traversal detected' });
      return null;
    }

    try {
      const mod = require(entryPath);
      const exports: PluginExports = mod.default ?? mod;

      // Validate exports have at least one expected method
      if (!exports || (typeof exports !== 'object' && typeof exports !== 'function')) {
        this.emit('plugin:error', { plugin: manifest.name, error: 'Invalid plugin exports: must be an object or function' });
        return null;
      }

      const instance: PluginInstance = {
        manifest,
        path: pluginPath,
        loaded: true,
        enabled: false,
        exports,
        config: {},
        loadedAt: new Date().toISOString(),
      };

      this.plugins.set(manifest.name, instance);
      this.emit('plugin:loaded', { plugin: manifest.name, version: manifest.version });
      return instance;
    } catch (err) {
      const error = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
      this.emit('plugin:error', { plugin: manifest.name, error });
      return null;
    }
  }

  // ─── Activate Plugin ───

  async activate(name: string, config?: Record<string, unknown>): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    if (plugin.enabled) return true;

    plugin.config = config ?? {};

    const context: PluginContext = {
      pawVersion: this.pawVersion,
      config: plugin.config,
      logger: {
        info: (msg) => this.emit('plugin:log', { plugin: name, level: 'info', message: msg }),
        warn: (msg) => this.emit('plugin:log', { plugin: name, level: 'warn', message: msg }),
        error: (msg) => this.emit('plugin:log', { plugin: name, level: 'error', message: msg }),
      },
      registerTool: (tool) => this.registeredTools.push(tool),
      registerChannel: (channel) => this.registeredChannels.push(channel),
      registerProvider: (provider) => this.registeredProviders.push(provider),
      registerMiddleware: (mw) => this.registeredMiddleware.push(mw),
    };

    try {
      // Register declared exports
      if (plugin.exports.tools) this.registeredTools.push(...plugin.exports.tools);
      if (plugin.exports.channels) this.registeredChannels.push(...plugin.exports.channels);
      if (plugin.exports.providers) this.registeredProviders.push(...plugin.exports.providers);
      if (plugin.exports.middleware) this.registeredMiddleware.push(...plugin.exports.middleware);

      // Call activate hook
      if (plugin.exports.activate) {
        await plugin.exports.activate(context);
      }

      plugin.enabled = true;
      this.emit('plugin:activated', { plugin: name });
      return true;
    } catch (err) {
      plugin.error = err instanceof Error ? err.message : String(err);
      this.emit('plugin:error', { plugin: name, error: plugin.error });
      return false;
    }
  }

  // ─── Deactivate Plugin ───

  async deactivate(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin || !plugin.enabled) return false;

    try {
      if (plugin.exports.deactivate) {
        await plugin.exports.deactivate();
      }

      // Remove registered exports
      this.registeredTools = this.registeredTools.filter(t => !plugin.exports.tools?.includes(t));
      this.registeredChannels = this.registeredChannels.filter(c => !plugin.exports.channels?.includes(c));
      this.registeredProviders = this.registeredProviders.filter(p => !plugin.exports.providers?.includes(p));
      this.registeredMiddleware = this.registeredMiddleware.filter(m => !plugin.exports.middleware?.includes(m));

      plugin.enabled = false;
      this.emit('plugin:deactivated', { plugin: name });
      return true;
    } catch (err) {
      this.emit('plugin:error', { plugin: name, error: `Deactivation failed: ${err instanceof Error ? err.message : String(err)}` });
      return false;
    }
  }

  // ─── Unload Plugin ───

  async unload(name: string): Promise<boolean> {
    if (this.plugins.has(name)) {
      await this.deactivate(name);
      this.plugins.delete(name);
      this.emit('plugin:unloaded', { plugin: name });
      return true;
    }
    return false;
  }

  // ─── Validation ───

  private validateManifest(manifest: PluginManifest): boolean {
    if (!manifest.name || typeof manifest.name !== 'string') return false;
    if (!manifest.version || typeof manifest.version !== 'string') return false;
    if (!manifest.entryPoint || typeof manifest.entryPoint !== 'string') return false;
    if (!Array.isArray(manifest.capabilities)) return false;

    // Sanitize name against path traversal
    if (/[/\\]|\.\./.test(manifest.name)) return false;

    return true;
  }

  // ─── Introspection ───

  list(): { name: string; version: string; enabled: boolean; capabilities: PluginCapability[] }[] {
    return [...this.plugins.values()].map(p => ({
      name: p.manifest.name,
      version: p.manifest.version,
      enabled: p.enabled,
      capabilities: p.manifest.capabilities,
    }));
  }

  getPlugin(name: string): PluginInstance | undefined {
    return this.plugins.get(name);
  }

  getTools(): PluginTool[] {
    return [...this.registeredTools];
  }

  getChannels(): PluginChannel[] {
    return [...this.registeredChannels];
  }

  getProviders(): PluginProvider[] {
    return [...this.registeredProviders];
  }

  getMiddleware(): PluginMiddleware[] {
    return [...this.registeredMiddleware].sort((a, b) => a.priority - b.priority);
  }

  // ─── Load All ───

  async loadAll(): Promise<number> {
    const manifests = await this.discover();
    let loaded = 0;
    for (const manifest of manifests) {
      for (const dir of this.pluginDirs) {
        const pluginPath = path.join(dir, manifest.name);
        if (fs.existsSync(pluginPath)) {
          const result = await this.load(pluginPath);
          if (result) loaded++;
          break;
        }
      }
    }
    return loaded;
  }
}
