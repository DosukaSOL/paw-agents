---
metadata:
  name: solana-transfer
  version: "1.0.0"
  author: PAW Team
  description: Transfer SOL from one wallet to another on Solana
  category: blockchain
  tags:
    - solana
    - transfer
    - send
    - payment

capability:
  purpose: Safely transfer SOL between Solana wallets
  actions:
    - transfer_sol
    - send_sol
    - pay

input_schema:
  - name: to
    type: string
    required: true
    validation: "Valid Solana public key"
    description: Recipient wallet address
  - name: amount
    type: number
    required: true
    validation: "Positive number, max 10 SOL"
    description: Amount in SOL to transfer
  - name: from
    type: string
    required: true
    validation: "Valid Solana public key"
    description: Sender wallet address

output_schema:
  structure:
    signature: string
    success: boolean
    amount_sol: number
    from: string
    to: string
  types:
    signature: string
    success: boolean
    amount_sol: number
  guarantees:
    - Transaction is simulated before execution
    - Transaction is confirmed on-chain

execution:
  execution_type: js
  entrypoint: solana_transfer
  runtime_requirements:
    - "@solana/web3.js"
  dependencies: []

tools:
  apis:
    - solana-rpc
  contracts:
    - "11111111111111111111111111111111"
  permissions_required:
    - write_blockchain
    - sign_transaction

safety:
  max_transaction_lamports: 10000000000
  allowed_contracts:
    - "11111111111111111111111111111111"
  forbidden_actions:
    - upgrade_program
    - close_account_owner_override
  rate_limit_per_minute: 5

validation:
  preconditions:
    - Sender must have sufficient balance
    - Both addresses must be valid Solana public keys
    - Amount must be positive and within limits
  postconditions:
    - Transaction confirmed on-chain
    - Recipient balance increased by transfer amount

failure_modes:
  - risk: Insufficient funds
    fallback: Return clear error, do not attempt partial transfer
  - risk: Network congestion
    fallback: Retry with higher priority fee up to 3 times
  - risk: Invalid recipient
    fallback: Reject before simulation

permissions:
  allowed_actions:
    - write_blockchain
    - sign_transaction
    - read_blockchain
  forbidden_actions:
    - upgrade_program
    - close_account_owner_override

examples:
  - description: Send 0.5 SOL to a wallet
    input:
      to: "RecipientPubkey..."
      amount: 0.5
      from: "SenderPubkey..."
    expected_output:
      signature: "5xYz..."
      success: true
      amount_sol: 0.5
---

# Solana Transfer Skill

Safely transfers SOL between Solana wallets.

## Safety
- Transaction is always simulated first
- Requires explicit user confirmation
- Maximum 10 SOL per transaction
- Rate limited to 5 transfers per minute

## Usage
Tell the agent: "Send 0.5 SOL to [address]"
