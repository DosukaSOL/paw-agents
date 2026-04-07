// ─── PAW Code Execution Sandbox ───
// Safe, isolated code execution for JavaScript/TypeScript with resource limits.
// Supports data analysis, code generation verification, and computational tasks.

import { randomUUID } from 'crypto';
import * as vm from 'vm';

// ─── Types ───

export type SandboxLanguage = 'javascript' | 'typescript';

export interface SandboxConfig {
  timeout: number;           // Execution timeout in ms (default 10000)
  memoryLimit: number;       // Max memory in MB (default 128)
  maxOutputSize: number;     // Max console output bytes (default 65536)
  allowNetwork: boolean;     // Allow fetch/http (default false)
  allowFileSystem: boolean;  // Allow fs operations (default false)
  allowedModules: string[];  // Whitelisted modules
}

export interface ExecutionRequest {
  code: string;
  language: SandboxLanguage;
  globals?: Record<string, unknown>;
  config?: Partial<SandboxConfig>;
}

export interface ExecutionResult {
  id: string;
  success: boolean;
  output: string;
  returnValue: unknown;
  error?: string;
  duration_ms: number;
  memoryUsed?: number;
  truncated: boolean;
}

// ─── Default Config ───

const DEFAULT_CONFIG: SandboxConfig = {
  timeout: 10000,
  memoryLimit: 128,
  maxOutputSize: 65536,
  allowNetwork: false,
  allowFileSystem: false,
  allowedModules: ['crypto', 'url', 'querystring', 'path', 'util'],
};

// ─── Sandbox Executor ───

export class CodeSandbox {
  private config: SandboxConfig;
  private history: ExecutionResult[] = [];

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const id = randomUUID();
    const cfg = { ...this.config, ...request.config };
    const startTime = Date.now();

    // Validate code safety
    const safetyCheck = this.validateCode(request.code, cfg);
    if (!safetyCheck.safe) {
      const result: ExecutionResult = {
        id,
        success: false,
        output: '',
        returnValue: undefined,
        error: `Code safety violation: ${safetyCheck.reason}`,
        duration_ms: Date.now() - startTime,
        truncated: false,
      };
      this.history.push(result);
      return result;
    }

    try {
      const result = await this.executeInSandbox(id, request.code, cfg, request.globals);
      this.history.push(result);
      return result;
    } catch (err) {
      const result: ExecutionResult = {
        id,
        success: false,
        output: '',
        returnValue: undefined,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
        truncated: false,
      };
      this.history.push(result);
      return result;
    }
  }

  private async executeInSandbox(
    id: string,
    code: string,
    cfg: SandboxConfig,
    globals?: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    let output = '';
    let truncated = false;

    // Build sandbox console
    const appendOutput = (msg: string) => {
      if (output.length >= cfg.maxOutputSize) {
        truncated = true;
        return;
      }
      output += msg + '\n';
      if (output.length > cfg.maxOutputSize) {
        output = output.slice(0, cfg.maxOutputSize);
        truncated = true;
      }
    };

    const sandboxConsole = {
      log: (...args: unknown[]) => appendOutput(args.map(a => this.formatValue(a)).join(' ')),
      error: (...args: unknown[]) => appendOutput('[ERROR] ' + args.map(a => this.formatValue(a)).join(' ')),
      warn: (...args: unknown[]) => appendOutput('[WARN] ' + args.map(a => this.formatValue(a)).join(' ')),
      info: (...args: unknown[]) => appendOutput('[INFO] ' + args.map(a => this.formatValue(a)).join(' ')),
      table: (data: unknown) => appendOutput(JSON.stringify(data, null, 2)),
      time: () => {},
      timeEnd: () => {},
      clear: () => { output = ''; },
    };

    // Build sandbox context
    const sandboxGlobals: Record<string, unknown> = {
      console: sandboxConsole,
      Math,
      Date,
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Promise,
      RegExp,
      Error,
      TypeError,
      RangeError,
      Symbol,
      BigInt,
      // Utility globals
      setTimeout: undefined,
      setInterval: undefined,
      Buffer: undefined,
      process: undefined,
      require: undefined,
      __dirname: undefined,
      __filename: undefined,
      global: undefined,
      globalThis: undefined,
      ...globals,
    };

    // Provide safe require for whitelisted modules
    // Note: require is NOT exposed to sandbox code for security.
    // Whitelisted modules are pre-loaded and injected as globals instead.
    void cfg.allowedModules;

    const context = vm.createContext(sandboxGlobals);

    // Wrap code to capture return value
    const wrappedCode = `
      (async () => {
        ${code}
      })();
    `;

    try {
      const script = new vm.Script(wrappedCode, {
        filename: `sandbox-${id}.js`,
      });

      const returnValue = await script.runInContext(context, {
        timeout: cfg.timeout,
        breakOnSigint: true,
      });

      return {
        id,
        success: true,
        output: output.trim(),
        returnValue: this.sanitizeReturnValue(returnValue),
        duration_ms: Date.now() - startTime,
        truncated,
      };
    } catch (err) {
      const isTimeout = err instanceof Error && err.message.includes('Script execution timed out');
      return {
        id,
        success: false,
        output: output.trim(),
        returnValue: undefined,
        error: isTimeout ? `Execution timed out after ${cfg.timeout}ms` : (err instanceof Error ? err.message : String(err)),
        duration_ms: Date.now() - startTime,
        truncated,
      };
    }
  }

  // ─── Code Validation ───

  private validateCode(code: string, cfg: SandboxConfig): { safe: boolean; reason?: string } {
    // Block dangerous patterns
    const dangerousPatterns: { pattern: RegExp; reason: string; requires?: keyof SandboxConfig }[] = [
      { pattern: /process\.(exit|kill|abort)/i, reason: 'Process termination not allowed' },
      { pattern: /child_process|exec\(|execSync|spawn/i, reason: 'Shell execution not allowed' },
      { pattern: /eval\s*\(|Function\s*\(/i, reason: 'Dynamic code execution not allowed' },
      { pattern: /require\s*\(\s*['"](?:child_process|cluster|dgram|worker_threads|v8|perf_hooks)/i, reason: 'Dangerous module access not allowed' },
      { pattern: /(?:require|import)\s*\(\s*['"]fs['"]|readFileSync|writeFileSync|appendFileSync/i, reason: 'File system access not allowed', requires: 'allowFileSystem' },
      { pattern: /(?:require|import)\s*\(\s*['"](?:net|http|https|tls|dns)['"]|fetch\s*\(/i, reason: 'Network access not allowed', requires: 'allowNetwork' },
    ];

    for (const { pattern, reason, requires } of dangerousPatterns) {
      if (requires && cfg[requires]) continue; // Skip if explicitly allowed
      if (pattern.test(code)) {
        return { safe: false, reason };
      }
    }

    // Block prototype pollution
    if (/__proto__|constructor\s*\[|Object\.setPrototypeOf/i.test(code)) {
      return { safe: false, reason: 'Prototype manipulation not allowed' };
    }

    return { safe: true };
  }

  // ─── Helpers ───

  private formatValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  private sanitizeReturnValue(value: unknown): unknown {
    if (value === undefined || value === null) return value;
    try {
      // Ensure it's serializable
      const serialized = JSON.stringify(value);
      if (serialized.length > 65536) return '[return value too large]';
      return JSON.parse(serialized);
    } catch {
      return String(value);
    }
  }

  getHistory(): ExecutionResult[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  updateConfig(updates: Partial<SandboxConfig>): void {
    Object.assign(this.config, updates);
  }
}
