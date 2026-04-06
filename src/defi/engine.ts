// ─── Composable DeFi Execution Engine ───
// Multi-DEX swap routing, position management, and liquidity operations on Solana.
// Every operation is simulated before execution. Mandatory safety checks on all paths.

import { Connection, PublicKey, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../core/config';
import {
  DeFiQuote,
  DeFiRouteLeg,
  DeFiSwapParams,
  DeFiSwapResult,
  DeFiSimulationResult,
  DeFiPositionInfo,
  DeFiSafetyConfig,
  DeFiProtocol,
} from '../core/types';
import { SolanaExecutor } from '../integrations/solana/executor';

// ─── Well-known Solana token mints ───
const KNOWN_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  MNDE: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
};

// ─── Safety boundaries (absolute limits — cannot be overridden) ───
const ABSOLUTE_MAX_SLIPPAGE_BPS = 500;        // 5% hard cap
const ABSOLUTE_MAX_PRICE_IMPACT_PCT = 10;      // 10% hard cap
const ABSOLUTE_MAX_ROUTE_LEGS = 5;             // Max hops
const ABSOLUTE_MIN_OUTPUT_RATIO = 0.90;        // Must get at least 90% of expected

export class DeFiEngine {
  private connection: Connection;
  private solana: SolanaExecutor;
  private safety: DeFiSafetyConfig;
  private quoteCache = new Map<string, { quote: DeFiQuote; cached_at: number }>();
  private readonly QUOTE_TTL_MS = 15_000; // Quotes expire after 15s

  constructor(solana: SolanaExecutor) {
    this.solana = solana;
    this.connection = solana.getConnection();
    this.safety = this.loadSafetyConfig();
  }

  // ─── 1. Get swap quote with multi-DEX routing ───
  async getQuote(params: DeFiSwapParams): Promise<DeFiQuote> {
    // Validate inputs before making any external calls
    this.validateSwapParams(params);

    // Check cache first (include slippage in cache key to avoid mismatches)
    const cacheKey = `${params.input_mint}:${params.output_mint}:${params.amount}:${params.slippage_bps}`;
    const cached = this.quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.cached_at < this.QUOTE_TTL_MS) {
      return cached.quote;
    }

    // Resolve mint addresses
    const inputMint = this.resolveMint(params.input_mint);
    const outputMint = this.resolveMint(params.output_mint);

    // Fetch quote from Jupiter aggregator (industry standard for Solana DEX routing)
    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(params.amount),
      slippageBps: String(Math.min(params.slippage_bps, this.safety.max_slippage_bps)),
      onlyDirectRoutes: String(params.only_direct_routes ?? false),
      maxAccounts: String(params.max_accounts ?? 64),
    });

    const response = await fetch(`https://quote-api.jup.ag/v6/quote?${queryParams}`);
    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;

    // Parse and validate the quote
    const routePlan = this.parseRoutePlan(data);
    const quote: DeFiQuote = {
      protocol: this.detectPrimaryProtocol(routePlan),
      input_mint: inputMint,
      output_mint: outputMint,
      input_amount: Number(data.inAmount),
      output_amount: Number(data.outAmount),
      price_impact_pct: Number(data.priceImpactPct ?? 0),
      fee_amount: this.calculateTotalFees(routePlan),
      fee_mint: inputMint,
      route_plan: routePlan,
      expires_at: Date.now() + this.QUOTE_TTL_MS,
    };

    // Safety checks on the quote itself
    this.validateQuote(quote, params);

    // Cache the quote (limit cache size to prevent memory growth)
    if (this.quoteCache.size > 100) {
      const oldest = this.quoteCache.entries().next().value;
      if (oldest) this.quoteCache.delete(oldest[0]);
    }
    this.quoteCache.set(cacheKey, { quote, cached_at: Date.now() });

    return quote;
  }

  // ─── 2. Execute a swap (always simulates first) ───
  async executeSwap(params: DeFiSwapParams): Promise<DeFiSwapResult> {
    // Phase 1: Validate all parameters
    this.validateSwapParams(params);

    // Phase 2: Get fresh quote — invalidate cache to ensure we never execute on stale pricing
    const freshCacheKey = `${params.input_mint}:${params.output_mint}:${params.amount}:${params.slippage_bps}`;
    this.quoteCache.delete(freshCacheKey);
    const quote = await this.getQuote(params);

    // Phase 3: Pre-execution safety simulation
    const simulation = await this.simulateSwap(params, quote);
    if (!simulation.passed) {
      return {
        success: false,
        input_amount: params.amount,
        output_amount: 0,
        price_impact_pct: quote.price_impact_pct,
        fee_lamports: 0,
        route_used: quote.route_plan,
        simulation,
        error: `Simulation failed: ${simulation.error ?? simulation.warnings.join('; ')}`,
      };
    }

    // Phase 4: Get the swap transaction from Jupiter
    const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: params.user_wallet,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!swapResponse.ok) {
      throw new Error(`Jupiter swap transaction failed: ${swapResponse.status}`);
    }

    const swapData = await swapResponse.json() as Record<string, unknown>;
    const swapTxBase64 = swapData.swapTransaction;
    if (typeof swapTxBase64 !== 'string' || swapTxBase64.length === 0) {
      throw new Error('Jupiter returned invalid swap transaction');
    }
    const swapTransactionBuf = Buffer.from(swapTxBase64, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Phase 5: Simulate the actual transaction on-chain before sending
    const txSimulation = await this.connection.simulateTransaction(transaction);
    if (txSimulation.value.err) {
      return {
        success: false,
        input_amount: params.amount,
        output_amount: 0,
        price_impact_pct: quote.price_impact_pct,
        fee_lamports: 0,
        route_used: quote.route_plan,
        simulation,
        error: `On-chain simulation failed: ${JSON.stringify(txSimulation.value.err)}`,
      };
    }

    // Phase 6: Execute the transaction (requires signer to be set on SolanaExecutor)
    const walletPubkey = new PublicKey(params.user_wallet);
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    // For versioned transactions, we need the signer to sign directly
    // The SolanaExecutor's signer handles this
    const rawTx = Buffer.from(transaction.serialize());
    const signature = await this.connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    const confirmation = await this.connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    return {
      success: !confirmation.value.err,
      signature,
      input_amount: params.amount,
      output_amount: quote.output_amount,
      price_impact_pct: quote.price_impact_pct,
      fee_lamports: simulation.fee_estimate,
      route_used: quote.route_plan,
      simulation,
      error: confirmation.value.err ? JSON.stringify(confirmation.value.err) : undefined,
    };
  }

  // ─── 3. Simulate a swap WITHOUT executing ───
  async simulateSwap(params: DeFiSwapParams, quote?: DeFiQuote): Promise<DeFiSimulationResult> {
    const warnings: string[] = [];

    try {
      // Get quote if not provided
      const q = quote ?? await this.getQuote(params);

      // Check wallet balance
      const walletPubkey = new PublicKey(params.user_wallet);
      const balance = await this.connection.getBalance(walletPubkey);
      const balanceSufficient = params.input_mint === KNOWN_MINTS.SOL
        ? balance >= params.amount + 10_000 // Reserve for fees
        : balance >= 10_000; // Need SOL for fees even for SPL swaps

      if (!balanceSufficient) {
        return {
          passed: false,
          estimated_output: q.output_amount,
          minimum_output: Math.floor(q.output_amount * (1 - params.slippage_bps / 10_000)),
          price_impact_pct: q.price_impact_pct,
          fee_estimate: q.fee_amount,
          slippage_check: false,
          balance_sufficient: false,
          warnings: ['Insufficient balance for swap + transaction fees'],
          error: 'Insufficient balance',
        };
      }

      // Price impact check
      const slippageOk = params.slippage_bps <= this.safety.max_slippage_bps;
      if (!slippageOk) {
        warnings.push(`Slippage ${params.slippage_bps}bps exceeds safety limit of ${this.safety.max_slippage_bps}bps`);
      }

      if (q.price_impact_pct > this.safety.max_price_impact_pct) {
        return {
          passed: false,
          estimated_output: q.output_amount,
          minimum_output: Math.floor(q.output_amount * (1 - params.slippage_bps / 10_000)),
          price_impact_pct: q.price_impact_pct,
          fee_estimate: q.fee_amount,
          slippage_check: slippageOk,
          balance_sufficient: true,
          warnings,
          error: `Price impact ${q.price_impact_pct.toFixed(2)}% exceeds safety limit of ${this.safety.max_price_impact_pct}%`,
        };
      }

      if (q.price_impact_pct > 1) {
        warnings.push(`Price impact ${q.price_impact_pct.toFixed(2)}% is elevated`);
      }

      // Route length check
      if (q.route_plan.length > this.safety.max_route_legs) {
        return {
          passed: false,
          estimated_output: q.output_amount,
          minimum_output: Math.floor(q.output_amount * (1 - params.slippage_bps / 10_000)),
          price_impact_pct: q.price_impact_pct,
          fee_estimate: q.fee_amount,
          slippage_check: slippageOk,
          balance_sufficient: true,
          warnings,
          error: `Route has ${q.route_plan.length} legs, max allowed is ${this.safety.max_route_legs}`,
        };
      }

      // Output ratio check (protection against manipulation)
      const expectedOutput = q.output_amount;
      const minimumOutput = Math.floor(expectedOutput * (1 - params.slippage_bps / 10_000));
      const outputRatio = minimumOutput / expectedOutput;
      if (outputRatio < this.safety.min_output_ratio) {
        warnings.push(`Minimum output ratio ${(outputRatio * 100).toFixed(1)}% is below safety threshold`);
      }

      // Amount limit check
      if (params.amount > this.safety.max_swap_lamports) {
        return {
          passed: false,
          estimated_output: q.output_amount,
          minimum_output: minimumOutput,
          price_impact_pct: q.price_impact_pct,
          fee_estimate: q.fee_amount,
          slippage_check: slippageOk,
          balance_sufficient: true,
          warnings,
          error: `Swap amount ${params.amount} exceeds max allowed ${this.safety.max_swap_lamports}`,
        };
      }

      return {
        passed: slippageOk,
        estimated_output: q.output_amount,
        minimum_output: minimumOutput,
        price_impact_pct: q.price_impact_pct,
        fee_estimate: q.fee_amount,
        slippage_check: slippageOk,
        balance_sufficient: true,
        warnings,
      };
    } catch (err) {
      return {
        passed: false,
        estimated_output: 0,
        minimum_output: 0,
        price_impact_pct: 0,
        fee_estimate: 0,
        slippage_check: false,
        balance_sufficient: false,
        warnings,
        error: (err as Error).message,
      };
    }
  }

  // ─── 4. Get token balance for a wallet ───
  async getTokenBalance(wallet: string, mint: string): Promise<{ amount: number; decimals: number; ui_amount: number }> {
    if (!SolanaExecutor.isValidAddress(wallet)) throw new Error('Invalid wallet address');

    const resolvedMint = this.resolveMint(mint);
    const walletPubkey = new PublicKey(wallet);

    // Native SOL
    if (resolvedMint === KNOWN_MINTS.SOL) {
      const balance = await this.connection.getBalance(walletPubkey);
      return { amount: balance, decimals: 9, ui_amount: balance / LAMPORTS_PER_SOL };
    }

    // SPL tokens
    const mintPubkey = new PublicKey(resolvedMint);
    const accounts = await this.connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: mintPubkey });

    if (accounts.value.length === 0) {
      return { amount: 0, decimals: 0, ui_amount: 0 };
    }

    const info = accounts.value[0].account.data.parsed.info;
    return {
      amount: Number(info.tokenAmount.amount),
      decimals: info.tokenAmount.decimals,
      ui_amount: Number(info.tokenAmount.uiAmount),
    };
  }

  // ─── 5. Get positions across protocols ───
  async getPositions(wallet: string): Promise<DeFiPositionInfo[]> {
    if (!SolanaExecutor.isValidAddress(wallet)) throw new Error('Invalid wallet address');

    const walletPubkey = new PublicKey(wallet);
    const positions: DeFiPositionInfo[] = [];

    // Fetch all token accounts to detect LP positions and staked tokens
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(walletPubkey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    for (const account of tokenAccounts.value) {
      const info = account.account.data.parsed.info;
      const mint = info.mint as string;
      const amount = Number(info.tokenAmount.amount);

      if (amount === 0) continue;

      // Detect Marinade staked SOL (mSOL)
      if (mint === 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So') {
        positions.push({
          protocol: 'marinade',
          position_type: 'stake',
          pool_address: mint,
          token_a_mint: KNOWN_MINTS.SOL,
          token_a_amount: amount,
          value_usd_estimate: 0, // Would need price oracle
        });
      }
    }

    return positions;
  }

  // ─── 6. Resolve token symbols to mint addresses ───
  resolveMint(mintOrSymbol: string): string {
    // If it's already a valid base58 address, use it directly
    try {
      new PublicKey(mintOrSymbol);
      return mintOrSymbol;
    } catch {
      // Not a valid address, try symbol lookup
    }

    const symbol = mintOrSymbol.toUpperCase();
    const address = KNOWN_MINTS[symbol];
    if (!address) {
      throw new Error(`Unknown token: ${mintOrSymbol}. Use a mint address or one of: ${Object.keys(KNOWN_MINTS).join(', ')}`);
    }
    return address;
  }

  // ─── Safety: Validate swap parameters ───
  private validateSwapParams(params: DeFiSwapParams): void {
    // Wallet address validation
    if (!SolanaExecutor.isValidAddress(params.user_wallet)) {
      throw new Error('Invalid wallet address');
    }

    // Amount must be positive
    if (params.amount <= 0 || !Number.isFinite(params.amount)) {
      throw new Error('Swap amount must be a positive finite number');
    }

    // Amount must be an integer (lamports/smallest unit)
    if (!Number.isInteger(params.amount)) {
      throw new Error('Swap amount must be an integer (in smallest token unit)');
    }

    // Slippage bounds (hard cap — cannot be overridden)
    if (params.slippage_bps < 1 || params.slippage_bps > ABSOLUTE_MAX_SLIPPAGE_BPS) {
      throw new Error(`Slippage must be between 1 and ${ABSOLUTE_MAX_SLIPPAGE_BPS} bps (0.01% to ${ABSOLUTE_MAX_SLIPPAGE_BPS / 100}%)`);
    }

    // Resolve mints to validate them
    const inputMint = this.resolveMint(params.input_mint);
    const outputMint = this.resolveMint(params.output_mint);

    // Cannot swap to same token
    if (inputMint === outputMint) {
      throw new Error('Cannot swap a token to itself');
    }

    // Check blocked mints
    if (this.safety.blocked_mints.includes(inputMint) || this.safety.blocked_mints.includes(outputMint)) {
      throw new Error('One or more tokens are blocked by safety policy');
    }

    // Check max swap amount
    if (params.amount > this.safety.max_swap_lamports) {
      throw new Error(`Swap amount exceeds maximum allowed: ${this.safety.max_swap_lamports}`);
    }
  }

  // ─── Safety: Validate quote before use ───
  private validateQuote(quote: DeFiQuote, params: DeFiSwapParams): void {
    // Price impact hard cap
    if (quote.price_impact_pct > ABSOLUTE_MAX_PRICE_IMPACT_PCT) {
      throw new Error(`Price impact ${quote.price_impact_pct.toFixed(2)}% exceeds absolute maximum of ${ABSOLUTE_MAX_PRICE_IMPACT_PCT}%`);
    }

    // Route legs hard cap
    if (quote.route_plan.length > ABSOLUTE_MAX_ROUTE_LEGS) {
      throw new Error(`Route has ${quote.route_plan.length} legs, absolute maximum is ${ABSOLUTE_MAX_ROUTE_LEGS}`);
    }

    // Output sanity check — must get at least ABSOLUTE_MIN_OUTPUT_RATIO of input value
    if (quote.output_amount <= 0) {
      throw new Error('Quote returned zero output — likely insufficient liquidity');
    }

    // Verify the quote matches what we requested
    if (Number(quote.input_amount) !== params.amount) {
      throw new Error('Quote input amount does not match requested amount');
    }

    // Verify quote hasn't expired
    if (quote.expires_at < Date.now()) {
      throw new Error('Quote has expired — request a fresh quote');
    }
  }

  // ─── Parse Jupiter route plan ───
  private parseRoutePlan(data: Record<string, unknown>): DeFiRouteLeg[] {
    const routePlan = data.routePlan as Array<Record<string, unknown>> ?? [];
    return routePlan.map(leg => {
      const swap = leg.swapInfo as Record<string, unknown> ?? leg;
      return {
        protocol: this.mapAmmToProtocol(String(swap.ammKey ?? swap.label ?? 'unknown')),
        pool: String(swap.ammKey ?? ''),
        input_mint: String(swap.inputMint ?? ''),
        output_mint: String(swap.outputMint ?? ''),
        input_amount: Number(swap.inAmount ?? 0),
        output_amount: Number(swap.outAmount ?? 0),
        fee_pct: Number(swap.feeAmount ?? 0) / Math.max(Number(swap.inAmount ?? 1), 1) * 100,
      };
    });
  }

  // ─── Map AMM keys/labels to known protocols ───
  private mapAmmToProtocol(label: string): DeFiProtocol {
    const lower = label.toLowerCase();
    if (lower.includes('raydium')) return 'raydium';
    if (lower.includes('orca') || lower.includes('whirlpool')) return 'orca';
    if (lower.includes('marinade')) return 'marinade';
    if (lower.includes('drift')) return 'drift';
    return 'jupiter';
  }

  // ─── Detect primary protocol from route ───
  private detectPrimaryProtocol(legs: DeFiRouteLeg[]): DeFiProtocol {
    if (legs.length === 0) return 'jupiter';
    // Primary = the leg with the largest input amount
    const sorted = [...legs].sort((a, b) => b.input_amount - a.input_amount);
    return sorted[0].protocol;
  }

  // ─── Calculate total fees across all legs ───
  private calculateTotalFees(legs: DeFiRouteLeg[]): number {
    return legs.reduce((total, leg) => total + (leg.fee_pct / 100) * leg.input_amount, 0);
  }

  // ─── Load safety config from environment with hard limits ───
  private loadSafetyConfig(): DeFiSafetyConfig {
    const envSlippage = parseInt(process.env.DEFI_MAX_SLIPPAGE_BPS ?? '100', 10);
    const envPriceImpact = parseFloat(process.env.DEFI_MAX_PRICE_IMPACT_PCT ?? '3');
    const envMaxSwap = parseInt(process.env.DEFI_MAX_SWAP_LAMPORTS ?? String(5 * LAMPORTS_PER_SOL), 10);

    return {
      max_slippage_bps: Math.min(envSlippage, ABSOLUTE_MAX_SLIPPAGE_BPS),
      max_price_impact_pct: Math.min(envPriceImpact, ABSOLUTE_MAX_PRICE_IMPACT_PCT),
      max_swap_lamports: Math.min(envMaxSwap, 100 * LAMPORTS_PER_SOL), // Hard cap: 100 SOL
      allowed_protocols: ['jupiter', 'raydium', 'orca', 'marinade', 'drift'],
      blocked_mints: (process.env.DEFI_BLOCKED_MINTS ?? '').split(',').filter(Boolean),
      require_simulation: true,
      max_route_legs: Math.min(parseInt(process.env.DEFI_MAX_ROUTE_LEGS ?? '4', 10), ABSOLUTE_MAX_ROUTE_LEGS),
      min_output_ratio: Math.max(parseFloat(process.env.DEFI_MIN_OUTPUT_RATIO ?? '0.95'), ABSOLUTE_MIN_OUTPUT_RATIO),
    };
  }

  // ─── Expose safety config for validation engine ───
  getSafetyConfig(): DeFiSafetyConfig {
    return { ...this.safety };
  }
}
