// ─── PAW Agents Configuration ───
import { config as loadEnv } from 'dotenv';
import { SecurityPolicy } from './types';

loadEnv();

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  telegram: {
    get botToken(): string {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) throw new Error('Missing required environment variable: TELEGRAM_BOT_TOKEN');
      return token;
    },
  },
  models: {
    openai: {
      apiKey: optionalEnv('OPENAI_API_KEY', ''),
      model: optionalEnv('DEFAULT_MODEL_NAME', 'gpt-4o'),
    },
    anthropic: {
      apiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
    },
    defaultProvider: optionalEnv('DEFAULT_MODEL_PROVIDER', 'openai'),
  },
  solana: {
    rpcUrl: optionalEnv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    walletEncryptionKey: optionalEnv('SOLANA_WALLET_ENCRYPTION_KEY', ''),
  },
  security: {
    maxTransactionLamports: parseInt(optionalEnv('MAX_TRANSACTION_LAMPORTS', '1000000000'), 10),
    requireConfirmationAboveSol: parseFloat(optionalEnv('REQUIRE_CONFIRMATION_ABOVE_SOL', '1.0')),
    rateLimitPerMinute: parseInt(optionalEnv('RATE_LIMIT_PER_MINUTE', '30'), 10),
  },
  clawtrace: {
    logDir: optionalEnv('CLAWTRACE_LOG_DIR', './logs/clawtrace'),
    retentionDays: parseInt(optionalEnv('CLAWTRACE_RETENTION_DAYS', '90'), 10),
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
