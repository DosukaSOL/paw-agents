// ─── Solana Integration ───
// Safe blockchain execution: simulate first, risk score, policy validate.

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SendOptions,
  VersionedTransaction,
} from '@solana/web3.js';
import { config } from '../../core/config';
import { SimulationResult } from '../../core/types';
import { SecureSigner } from '../../security/keystore';

export class SolanaExecutor {
  private connection: Connection;
  private signer: SecureSigner | null = null;

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');
  }

  setSigner(signer: SecureSigner): void {
    this.signer = signer;
  }

  // ─── Simulate a transaction BEFORE executing ───
  async simulate(transaction: Transaction, feePayer: PublicKey): Promise<SimulationResult> {
    try {
      transaction.feePayer = feePayer;
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      const simulation = await this.connection.simulateTransaction(transaction);

      return {
        success: simulation.value.err === null,
        estimated_fee_lamports: 5000, // Base fee estimate
        logs: simulation.value.logs ?? [],
        error: simulation.value.err ? JSON.stringify(simulation.value.err) : undefined,
      };
    } catch (err) {
      return {
        success: false,
        estimated_fee_lamports: 0,
        logs: [],
        error: (err as Error).message,
      };
    }
  }

  // ─── Execute a validated, simulated transaction ───
  async execute(transaction: Transaction, feePayer: PublicKey): Promise<{ signature: string; success: boolean }> {
    if (!this.signer) {
      throw new Error('No signer configured. Import a key first.');
    }

    // MANDATORY: Simulate first
    const sim = await this.simulate(transaction, feePayer);
    if (!sim.success) {
      throw new Error(`Transaction simulation failed: ${sim.error}`);
    }

    // Sign
    transaction.feePayer = feePayer;
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    const message = transaction.serializeMessage();
    const signature = await this.signer.sign(message);

    transaction.addSignature(feePayer, Buffer.from(signature));

    // Send
    const rawTx = transaction.serialize();
    const txSig = await this.connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Confirm
    const confirmation = await this.connection.confirmTransaction({
      signature: txSig,
      blockhash,
      lastValidBlockHeight,
    });

    return {
      signature: txSig,
      success: !confirmation.value.err,
    };
  }

  // ─── Helper: Create SOL transfer ───
  createTransferInstruction(from: PublicKey, to: PublicKey, lamports: number): TransactionInstruction {
    return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
  }

  // ─── Get balance ───
  async getBalance(pubkey: PublicKey): Promise<number> {
    return this.connection.getBalance(pubkey);
  }

  // ─── Get SOL balance as human-readable ───
  async getSolBalance(pubkey: PublicKey): Promise<string> {
    const lamports = await this.getBalance(pubkey);
    return (lamports / LAMPORTS_PER_SOL).toFixed(4) + ' SOL';
  }

  // ─── Validate a Solana address ───
  static isValidAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  getConnection(): Connection {
    return this.connection;
  }
}
