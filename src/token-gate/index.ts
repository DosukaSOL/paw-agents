// ─── Token-Gated Access Control ───
// SPL token ownership verification for premium agent features.
// Supports: token balance checks, NFT ownership, tiered access levels.

import { Connection, PublicKey } from '@solana/web3.js';

export interface TokenGateConfig {
  rpcUrl: string;
  tiers: TokenTier[];
}

export interface TokenTier {
  name: string;
  mintAddress: string;
  minBalance: number;
  permissions: string[];
}

export interface AccessResult {
  allowed: boolean;
  tier: string;
  permissions: string[];
  balance: number;
  reason?: string;
}

// SPL Token program ID
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export class TokenGate {
  private connection: Connection;
  private tiers: TokenTier[];
  private cache: Map<string, { result: AccessResult; expires: number }> = new Map();
  private cacheTtlMs: number;

  constructor(config: TokenGateConfig, cacheTtlMs: number = 30_000) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.tiers = config.tiers.sort((a, b) => b.minBalance - a.minBalance); // highest first
    this.cacheTtlMs = cacheTtlMs;
  }

  // ─── Check access for a wallet ───
  async checkAccess(walletAddress: string): Promise<AccessResult> {
    // Check cache
    const cached = this.cache.get(walletAddress);
    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }

    try {
      const wallet = new PublicKey(walletAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
      });

      // Check each tier (highest first)
      for (const tier of this.tiers) {
        const mint = tier.mintAddress;
        const account = tokenAccounts.value.find(ta => {
          const info = ta.account.data.parsed?.info;
          return info?.mint === mint;
        });

        if (account) {
          const balance = Number(account.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0);
          if (balance >= tier.minBalance) {
            const result: AccessResult = {
              allowed: true,
              tier: tier.name,
              permissions: tier.permissions,
              balance,
            };
            this.cache.set(walletAddress, { result, expires: Date.now() + this.cacheTtlMs });
            return result;
          }
        }
      }

      const result: AccessResult = {
        allowed: false,
        tier: 'none',
        permissions: [],
        balance: 0,
        reason: 'No qualifying token balance found',
      };
      this.cache.set(walletAddress, { result, expires: Date.now() + this.cacheTtlMs });
      return result;
    } catch (error: unknown) {
      return {
        allowed: false,
        tier: 'none',
        permissions: [],
        balance: 0,
        reason: `Token check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ─── Gate a specific permission ───
  async hasPermission(walletAddress: string, permission: string): Promise<boolean> {
    const access = await this.checkAccess(walletAddress);
    return access.permissions.includes(permission) || access.permissions.includes('*');
  }

  // ─── Get all tiers ───
  getTiers(): TokenTier[] {
    return [...this.tiers];
  }

  // ─── Clear cache ───
  clearCache(): void {
    this.cache.clear();
  }
}
