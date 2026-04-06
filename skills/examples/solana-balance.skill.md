---
metadata:
  name: solana-balance
  version: "1.0.0"
  author: PAW Team
  description: Check the SOL balance of any Solana wallet address
  category: blockchain
  tags:
    - solana
    - balance
    - wallet
    - query

capability:
  purpose: Query the balance of a Solana wallet address
  actions:
    - check_balance
    - get_balance
    - wallet_balance

input_schema:
  - name: address
    type: string
    required: true
    validation: "Solana public key (base58, 32-44 chars)"
    description: The Solana wallet address to check

output_schema:
  structure:
    balance: number
    address: string
    denomination: string
  types:
    balance: number
    address: string
    denomination: string
  guarantees:
    - Balance is read from on-chain state
    - No funds are moved

execution:
  execution_type: js
  entrypoint: solana_balance
  runtime_requirements:
    - "@solana/web3.js"
  dependencies: []

tools:
  apis:
    - solana-rpc
  contracts: []
  permissions_required:
    - read_blockchain

safety:
  max_transaction_lamports: 0
  allowed_contracts: []
  forbidden_actions:
    - transfer
    - sign_transaction
  rate_limit_per_minute: 60

validation:
  preconditions:
    - Address must be a valid Solana public key
  postconditions:
    - Returns a numeric balance >= 0

failure_modes:
  - risk: RPC endpoint unavailable
    fallback: Retry with alternative RPC
  - risk: Invalid address format
    fallback: Return clear error message

permissions:
  allowed_actions:
    - read_blockchain
  forbidden_actions:
    - write_blockchain
    - sign_transaction

examples:
  - description: Check balance of a wallet
    input:
      address: "So11111111111111111111111111111111111111112"
    expected_output:
      balance: 1.5
      address: "So11111111111111111111111111111111111111112"
      denomination: "SOL"
---

# Solana Balance Skill

Checks the SOL balance of any Solana wallet address.

## Usage
Tell the agent: "Check the balance of [address]"

## Safety
This is a read-only operation. No funds are moved, no transactions are signed.
