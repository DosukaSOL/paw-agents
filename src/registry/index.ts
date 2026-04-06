// ─── On-Chain Agent Registry ───
// Solana-based agent identity & capability registry.
// Agents register on-chain with their capabilities, owners can verify agents on-chain.

import { Connection, PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

export interface OnChainAgent {
  pubkey: string;
  name: string;
  version: string;
  capabilities: string[];
  owner: string;
  registered_at: number;
  last_heartbeat: number;
  status: 'active' | 'inactive' | 'revoked';
  metadata_uri?: string;
}

export interface RegistryConfig {
  rpcUrl: string;
  programId?: string;
  keypair?: Keypair;
}

// Simple agent registry seed prefix
const REGISTRY_SEED = 'paw-agent-registry';

export class OnChainRegistry {
  private connection: Connection;
  private programId: PublicKey | null;
  private keypair: Keypair | null;
  private localCache: Map<string, OnChainAgent> = new Map();

  constructor(config: RegistryConfig) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.programId = config.programId ? new PublicKey(config.programId) : null;
    this.keypair = config.keypair ?? null;
  }

  // ─── Derive PDA for agent registration ───
  async deriveAgentPDA(agentName: string): Promise<[PublicKey, number]> {
    if (!this.programId) throw new Error('Registry program ID not configured');
    return PublicKey.findProgramAddress(
      [Buffer.from(REGISTRY_SEED), Buffer.from(agentName)],
      this.programId,
    );
  }

  // ─── Register agent on-chain (requires program deployed) ───
  async registerAgent(agent: Omit<OnChainAgent, 'pubkey' | 'registered_at' | 'last_heartbeat' | 'status'>): Promise<OnChainAgent> {
    const record: OnChainAgent = {
      ...agent,
      pubkey: this.keypair ? this.keypair.publicKey.toBase58() : 'local-' + Date.now(),
      registered_at: Date.now(),
      last_heartbeat: Date.now(),
      status: 'active',
    };

    // If program is deployed and keypair available, register on-chain
    if (this.programId && this.keypair) {
      const [pda] = await this.deriveAgentPDA(agent.name);
      const data = Buffer.from(JSON.stringify({
        instruction: 'register',
        name: agent.name,
        version: agent.version,
        capabilities: agent.capabilities,
        metadata_uri: agent.metadata_uri,
      }));

      const ix = new TransactionInstruction({
        keys: [
          { pubkey: this.keypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: pda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: this.programId,
        data,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = this.keypair.publicKey;
      tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      tx.sign(this.keypair);
      await this.connection.sendRawTransaction(tx.serialize());
      record.pubkey = pda.toBase58();
    }

    this.localCache.set(agent.name, record);
    return record;
  }

  // ─── Heartbeat — update last_heartbeat ───
  async heartbeat(agentName: string): Promise<boolean> {
    const agent = this.localCache.get(agentName);
    if (!agent) return false;
    agent.last_heartbeat = Date.now();
    return true;
  }

  // ─── Verify agent exists and is active ───
  async verifyAgent(agentName: string): Promise<{ verified: boolean; agent?: OnChainAgent }> {
    const agent = this.localCache.get(agentName);
    if (!agent) return { verified: false };

    const isActive = agent.status === 'active';
    const isRecent = (Date.now() - agent.last_heartbeat) < 5 * 60 * 1000; // 5 min

    return {
      verified: isActive && isRecent,
      agent,
    };
  }

  // ─── List all registered agents ───
  listAgents(filter?: { status?: string; capability?: string }): OnChainAgent[] {
    let agents = Array.from(this.localCache.values());

    if (filter?.status) {
      agents = agents.filter(a => a.status === filter.status);
    }
    if (filter?.capability) {
      agents = agents.filter(a => a.capabilities.includes(filter.capability!));
    }

    return agents;
  }

  // ─── Revoke agent ───
  async revokeAgent(agentName: string): Promise<boolean> {
    const agent = this.localCache.get(agentName);
    if (!agent) return false;
    agent.status = 'revoked';
    return true;
  }

  // ─── Get agent info ───
  getAgent(agentName: string): OnChainAgent | null {
    return this.localCache.get(agentName) ?? null;
  }
}
