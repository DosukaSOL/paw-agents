// ─── PAW Agents Configuration ───
import { config as loadEnv } from 'dotenv';
import { SecurityPolicy, AgentMode } from './types';

loadEnv();

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val === 'true' || val === '1';
}

function safeParseInt(key: string, fallback: number, min?: number, max?: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const val = parseInt(raw, 10);
  if (isNaN(val)) {
    console.warn(`[Config] Invalid integer for ${key}: "${raw}", using default ${fallback}`);
    return fallback;
  }
  if (min !== undefined && val < min) return min;
  if (max !== undefined && val > max) return max;
  return val;
}

function safeParseFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const val = parseFloat(raw);
  if (isNaN(val) || !isFinite(val)) {
    console.warn(`[Config] Invalid number for ${key}: "${raw}", using default ${fallback}`);
    return fallback;
  }
  return val;
}

export const config = {
  // ─── Agent Mode ───
  agent: {
    mode: (optionalEnv('AGENT_MODE', 'supervised') as AgentMode),
    // When true, validation pipeline is mandatory. When false, agent runs fully autonomous.
    requireValidation: optionalBool('REQUIRE_VALIDATION', true),
    // When true, risky actions still require confirmation even in autonomous mode.
    confirmHighRisk: optionalBool('CONFIRM_HIGH_RISK', true),
    // Max conversation history per session
    maxHistoryLength: safeParseInt('MAX_HISTORY_LENGTH', 50, 1, 1000),
    // Thinking level: off, low, medium, high
    thinkingLevel: optionalEnv('THINKING_LEVEL', 'medium'),
  },
  // ─── Channels ───
  telegram: {
    get botToken(): string {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) throw new Error('Missing required environment variable: TELEGRAM_BOT_TOKEN');
      return token;
    },
  },
  discord: {
    get botToken(): string {
      return process.env.DISCORD_BOT_TOKEN ?? '';
    },
  },
  slack: {
    get botToken(): string {
      return process.env.SLACK_BOT_TOKEN ?? '';
    },
    get appToken(): string {
      return process.env.SLACK_APP_TOKEN ?? '';
    },
  },
  whatsapp: {
    get sessionPath(): string {
      return process.env.WHATSAPP_SESSION_PATH ?? './data/whatsapp';
    },
  },
  email: {
    imapHost: optionalEnv('EMAIL_IMAP_HOST', ''),
    imapPort: safeParseInt('EMAIL_IMAP_PORT', 993, 1, 65535),
    smtpHost: optionalEnv('EMAIL_SMTP_HOST', ''),
    smtpPort: safeParseInt('EMAIL_SMTP_PORT', 587, 1, 65535),
    user: optionalEnv('EMAIL_USER', ''),
    password: optionalEnv('EMAIL_PASSWORD', ''),
  },
  sms: {
    accountSid: optionalEnv('TWILIO_ACCOUNT_SID', ''),
    authToken: optionalEnv('TWILIO_AUTH_TOKEN', ''),
    fromNumber: optionalEnv('TWILIO_FROM_NUMBER', ''),
  },
  line: {
    channelAccessToken: optionalEnv('LINE_CHANNEL_ACCESS_TOKEN', ''),
    channelSecret: optionalEnv('LINE_CHANNEL_SECRET', ''),
  },
  reddit: {
    clientId: optionalEnv('REDDIT_CLIENT_ID', ''),
    clientSecret: optionalEnv('REDDIT_CLIENT_SECRET', ''),
    username: optionalEnv('REDDIT_USERNAME', ''),
    password: optionalEnv('REDDIT_PASSWORD', ''),
    subreddit: optionalEnv('REDDIT_SUBREDDIT', ''),
  },
  matrix: {
    homeserverUrl: optionalEnv('MATRIX_HOMESERVER_URL', ''),
    accessToken: optionalEnv('MATRIX_ACCESS_TOKEN', ''),
    userId: optionalEnv('MATRIX_USER_ID', ''),
  },
  // ─── Gateway ───
  gateway: {
    port: safeParseInt('GATEWAY_PORT', 18789, 1, 65535),
    host: optionalEnv('GATEWAY_HOST', '127.0.0.1'),
    authToken: optionalEnv('GATEWAY_AUTH_TOKEN', ''),
    corsOrigins: optionalEnv('GATEWAY_CORS_ORIGINS', '*').split(','),
  },
  // ─── Models ───
  models: {
    openai: {
      apiKey: optionalEnv('OPENAI_API_KEY', ''),
      model: optionalEnv('DEFAULT_MODEL_NAME', 'gpt-4o'),
    },
    anthropic: {
      apiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
    },
    google: {
      apiKey: optionalEnv('GOOGLE_AI_API_KEY', ''),
      model: optionalEnv('GOOGLE_AI_MODEL', 'gemma-3-27b-it'),
    },
    mistral: {
      apiKey: optionalEnv('MISTRAL_API_KEY', ''),
      model: optionalEnv('MISTRAL_MODEL', 'mistral-large-latest'),
    },
    deepseek: {
      apiKey: optionalEnv('DEEPSEEK_API_KEY', ''),
      model: optionalEnv('DEEPSEEK_MODEL', 'deepseek-chat'),
    },
    groq: {
      apiKey: optionalEnv('GROQ_API_KEY', ''),
      model: optionalEnv('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    },
    defaultProvider: optionalEnv('DEFAULT_MODEL_PROVIDER', 'openai'),
  },
  // ─── Solana ───
  solana: {
    rpcUrl: optionalEnv('SOLANA_RPC_URL', 'https://api.devnet.solana.com'),
    walletEncryptionKey: optionalEnv('SOLANA_WALLET_ENCRYPTION_KEY', ''),
    network: optionalEnv('SOLANA_NETWORK', 'devnet'),
  },
  // ─── Purp ───
  purp: {
    compilerPath: optionalEnv('PURP_COMPILER_PATH', ''),
    projectDir: optionalEnv('PURP_PROJECT_DIR', './purp'),
    autoCompile: optionalBool('PURP_AUTO_COMPILE', true),
  },
  // ─── DeFi ───
  defi: {
    maxSlippageBps: safeParseInt('DEFI_MAX_SLIPPAGE_BPS', 100, 1, 500),
    maxPriceImpactPct: safeParseFloat('DEFI_MAX_PRICE_IMPACT_PCT', 3),
    maxSwapLamports: safeParseInt('DEFI_MAX_SWAP_LAMPORTS', 5000000000),
    maxRoutLegs: safeParseInt('DEFI_MAX_ROUTE_LEGS', 4, 1, 5),
    minOutputRatio: safeParseFloat('DEFI_MIN_OUTPUT_RATIO', 0.95),
    blockedMints: optionalEnv('DEFI_BLOCKED_MINTS', '').split(',').filter(Boolean),
  },
  // ─── Intelligence ───
  intelligence: {
    // User profiling
    profilingEnabled: optionalBool('PROFILING_ENABLED', true),
    profileStorePath: optionalEnv('PROFILE_STORE_PATH', './data/profiles'),
    maxBehaviorPatterns: safeParseInt('MAX_BEHAVIOR_PATTERNS', 100, 1),
    // RAG
    ragEnabled: optionalBool('RAG_ENABLED', true),
    ragStorePath: optionalEnv('RAG_STORE_PATH', './data/rag'),
    ragChunkSize: safeParseInt('RAG_CHUNK_SIZE', 512, 1),
    ragChunkOverlap: safeParseInt('RAG_CHUNK_OVERLAP', 64, 0),
    ragMaxResults: safeParseInt('RAG_MAX_RESULTS', 5, 1),
    ragMinScore: safeParseFloat('RAG_MIN_SCORE', 0.15),
    // Smart model routing
    smartRoutingEnabled: optionalBool('SMART_ROUTING_ENABLED', true),
    performanceStorePath: optionalEnv('PERFORMANCE_STORE_PATH', './data/model-perf'),
    // Fast path
    fastPathEnabled: optionalBool('FAST_PATH_ENABLED', true),
    fastPathProvider: optionalEnv('FAST_PATH_PROVIDER', 'groq'),
    fastPathMaxTokens: safeParseInt('FAST_PATH_MAX_TOKENS', 1024, 1),
    // Conversation branching
    branchingEnabled: optionalBool('BRANCHING_ENABLED', true),
    maxBranchesPerUser: safeParseInt('MAX_BRANCHES_PER_USER', 20, 1),
    branchStorePath: optionalEnv('BRANCH_STORE_PATH', './data/branches'),
  },
  // ─── Security ───
  security: {
    maxTransactionLamports: safeParseInt('MAX_TRANSACTION_LAMPORTS', 1000000000, 0),
    requireConfirmationAboveSol: safeParseFloat('REQUIRE_CONFIRMATION_ABOVE_SOL', 1.0),
    rateLimitPerMinute: safeParseInt('RATE_LIMIT_PER_MINUTE', 30, 1),
    sandboxMode: optionalEnv('SANDBOX_MODE', 'strict'),
  },
  // ─── Clawtrace ───
  clawtrace: {
    logDir: optionalEnv('CLAWTRACE_LOG_DIR', './logs/clawtrace'),
    retentionDays: safeParseInt('CLAWTRACE_RETENTION_DAYS', 90, 1),
  },
  // ─── Cron ───
  cron: {
    enabled: optionalBool('CRON_ENABLED', true),
    maxTasks: safeParseInt('CRON_MAX_TASKS', 50, 1),
  },
  env: optionalEnv('NODE_ENV', 'production'),
  logLevel: optionalEnv('LOG_LEVEL', 'info'),
} as const;

export function getSecurityPolicy(): SecurityPolicy {
  return {
    max_transaction_lamports: config.security.maxTransactionLamports,
    require_confirmation_above_lamports: Math.floor(config.security.requireConfirmationAboveSol * 1_000_000_000),
    rate_limit_per_minute: config.security.rateLimitPerMinute,
    allowed_programs: [
      '11111111111111111111111111111111',       // System Program
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // ATA Program
    ],
    forbidden_instructions: [
      'close_account_owner_override',
      'upgrade_program',
    ],
    max_plan_steps: 10,
    sandbox_enabled: true,
  };
}
