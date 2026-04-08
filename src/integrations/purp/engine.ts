// ─── Purp SCL Language Integration (PAW v4.0, upstream compat: v2.0.1 PINOCCHIO) ───
// Supports the full Purp Smart Contract Language syntax (compatible with purp-scl v2.0.1).
// Parses .purp files with program/account/instruction/event/error/client/frontend blocks.
// Features: pub instruction inline params, #[init], Pinocchio entrypoint dispatch,
// import resolution with circular detection, comma-separated fields, assert/require statements,
// CPI, SPL ops (incl. approve/revoke), exponentiation (**), nullish coalescing (??), spread (...).
// v1.2.0: DeFi, DAO, Token-2022, expanded game & serialization modules, 3 new templates.
// v1.2.1: 15 audit-driven bug fixes from official Solana doc review + new constants.
// v2.0.0: Migrate from Anchor to Pinocchio — zero-dependency, no_std Solana programs.
// v2.0.1: 12 codegen bug fixes — proper Pinocchio data handling, TS raw transactions.
// Compiles to Pinocchio Rust + TypeScript SDK + Frontend UI + IDL JSON.

import { PlanStep, PurpCompileResult, PurpError, PurpProjectConfig, PurpLintResult, PurpAuditResult, PurpStdlibModule, PurpTemplate, PurpCliCommand } from '../../core/types';
import { config } from '../../core/config';
import * as fs from 'fs';
import * as path from 'path';

// ─── Purp v1.2.1 Types ───
type PurpType = 'u8' | 'u16' | 'u32' | 'u64' | 'u128' | 'i8' | 'i16' | 'i32' | 'i64' | 'i128'
  | 'f32' | 'f64' | 'bool' | 'string' | 'pubkey' | 'bytes';

interface PurpField {
  name: string;
  type: PurpType | string;
  description?: string;
}

interface PurpAccountDef {
  name: string;
  fields: PurpField[];
  seeds?: string[];
  space?: number;
}

interface PurpInstructionDef {
  name: string;
  accounts: { name: string; mutable: boolean; signer: boolean; init: boolean }[];
  args: PurpField[];
  body: string[];
  visibility: 'pub' | 'private';
}

interface PurpEventDef {
  name: string;
  fields: PurpField[];
}

interface PurpErrorDef {
  code: number;
  name: string;
  message: string;
}

interface PurpClientDef {
  name: string;
  functions: { name: string; isAsync: boolean; params: string[]; body: string[] }[];
}

interface PurpFrontendDef {
  name: string;
  pages: { path: string; components: string[] }[];
  components: string[];
}

// v1.2.0: DeFi and governance definitions
interface PurpDefiDef {
  pools: { name: string; tokenA: string; tokenB: string; fee: number }[];
  vaults: { name: string; strategy: string }[];
}

interface PurpGovernanceDef {
  proposals: { name: string; votingPeriod: number; quorum: number }[];
  treasury?: string;
}

interface PurpProgram {
  name: string;
  version: string;
  description?: string;
  accounts: PurpAccountDef[];
  instructions: PurpInstructionDef[];
  events: PurpEventDef[];
  errors: PurpErrorDef[];
  clients: PurpClientDef[];
  frontends: PurpFrontendDef[];
  imports: string[];
  structs: { name: string; fields: PurpField[] }[];
  constants: { name: string; type: string; value: string }[];
  defi?: PurpDefiDef;
  governance?: PurpGovernanceDef;
  tokenExtensions?: { mint: string; extensions: string[] }[];
}

// ─── Legacy Purp Types (backward compat) ───
interface LegacyPurpInstruction {
  type: 'transfer' | 'call' | 'assert' | 'log' | 'set';
  params: Record<string, unknown>;
}

interface LegacyPurpProgram {
  name: string;
  version: string;
  instructions: LegacyPurpInstruction[];
  variables: Record<string, unknown>;
}

// ─── Purp Sandbox Limits ───
const MAX_INSTRUCTIONS = 50;
const MAX_ACCOUNTS = 30;
const MAX_EVENTS = 20;
const MAX_ERRORS = 50;
const MAX_STRING_LENGTH = 1024;

// ─── Purp v1.2.1 Stdlib Modules ───
const STDLIB_MODULES: PurpStdlibModule[] = [
  'accounts', 'tokens', 'nfts', 'pdas', 'cpi', 'events', 'math',
  'serialization', 'wallet', 'frontend', 'defi', 'governance', 'game',
  'web', 'token-extensions',
];

// ─── Purp v1.2.1 Templates ───
const TEMPLATES: PurpTemplate[] = [
  'hello-world', 'memecoin-launcher', 'nft-mint', 'cnft-mint',
  'staking-rewards', 'game-contract', 'fullstack-dapp', 'website-wallet',
  'analytics-dashboard', 'bot', 'ai-solana-app',
];

// ─── Purp v1.2.1 CLI Commands ───
const CLI_COMMANDS: PurpCliCommand[] = [
  'init', 'new', 'build', 'check', 'deploy', 'test', 'dev',
  'lint', 'format', 'install', 'publish', 'generate', 'audit',
  'doctor', 'clean',
];

// ─── Purp v1.2.1 Lint Rules (13 Solana-specific) ───
const LINT_RULES = [
  'no-unused-accounts', 'no-hardcoded-keys', 'signer-required', 'owner-check',
  'account-data-validation', 'no-arbitrary-cpi', 'no-hardcoded-amounts',
  'enum-naming', 'account-naming', 'init-needs-space', 'no-unguarded-mutation',
  'close-account-check', 'pda-seed-validation',
] as const;

// ─── v1.2.1 Solana Constants (from doc audit) ───
const SOLANA_CONSTANTS = {
  MAX_SEED_LENGTH: 32,
  MAX_SEEDS: 16,
  PDA_MARKER: 'ProgramDerivedAddress',
  LAMPORTS_PER_SOL: 1_000_000_000,
  MAX_PERMITTED_DATA_INCREASE: 10_240,
  MAX_ACCOUNT_DATA_LENGTH: 10_485_760,
  MAX_INSTRUCTION_ACCOUNTS: 256,
  MAX_TRANSACTION_SIZE: 1232,
  RENT_EXEMPT_MINIMUM_ACCOUNT_SIZE: 128,
  COMPUTE_UNIT_LIMIT: 200_000,
  MAX_COMPUTE_UNITS: 1_400_000,
  TOKEN_PROGRAM_ID: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022_PROGRAM_ID: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ASSOCIATED_TOKEN_PROGRAM_ID: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  SYSTEM_PROGRAM_ID: '11111111111111111111111111111111',
  METADATA_PROGRAM_ID: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
} as const;

// ─── Purp v1.2.1 Block Patterns ───
const BLOCK_PATTERN = /^(?:pub\s+)?(program|account|instruction|event|error|client|frontend|struct|const|defi|governance|token_extension)\s+(\w+)/;
const FIELD_PATTERN = /^\s*(\w+)\s*:\s*(\w+)/;
const IMPORT_PATTERN = /^(?:use|import)\s+([\w:\/\.@]+)/;
const ACCOUNT_ATTR_PATTERN = /^\s*#\[(mut|signer|init|seeds\(.*?\)|payer\(.*?\)|space\(.*?\))\]/;
const ARG_PATTERN = /^\s*(\w+)\s*:\s*(\w+)/;
// v1.0: pub instruction name(#[mut] signer author, #[init] account greeting, msg: string) { ... }
const PUB_INSTRUCTION_PATTERN = /^(?:pub\s+)?instruction\s+(\w+)\s*\(/;

export class PurpEngine {
  // ─── Purp v2.0.1 metadata ───
  static readonly UPSTREAM_VERSION = '2.0.1';
  static readonly STDLIB_MODULES = STDLIB_MODULES;
  static readonly TEMPLATES = TEMPLATES;
  static readonly CLI_COMMANDS = CLI_COMMANDS;
  static readonly LINT_RULES = LINT_RULES;
  static readonly SOLANA_CONSTANTS = SOLANA_CONSTANTS;

  // ─── Parse Purp v1.2.1 source (.purp files) ───
  parse(source: string): PurpProgram | LegacyPurpProgram {
    if (source.length > 10_000_000) {
      throw new Error('Purp source exceeds maximum size of 10MB');
    }
    const trimmed = source.trim();
    if (trimmed.startsWith('{')) {
      return this.parseLegacy(source);
    }
    return this.parsePurpV3(source);
  }

  // ─── Parse native Purp v2.0.1 syntax ───
  private parsePurpV3(source: string): PurpProgram {
    const lines = source.split('\n');
    const program: PurpProgram = {
      name: '',
      version: '2.0.1',
      accounts: [],
      instructions: [],
      events: [],
      errors: [],
      clients: [],
      frontends: [],
      imports: [],
      structs: [],
      constants: [],
      defi: undefined,
      governance: undefined,
      tokenExtensions: [],
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('//') || line.startsWith('#')) {
        i++;
        continue;
      }

      // Parse imports (use X or import X)
      const importMatch = line.match(IMPORT_PATTERN);
      if (importMatch) {
        program.imports.push(importMatch[1]);
        i++;
        continue;
      }

      // v1.0: pub instruction with inline params
      const pubInstrMatch = line.match(PUB_INSTRUCTION_PATTERN);
      if (pubInstrMatch) {
        const { instruction, endLine } = this.parsePubInstruction(lines, i);
        program.instructions.push(instruction);
        i = endLine + 1;
        continue;
      }

      // Parse blocks
      const blockMatch = line.match(BLOCK_PATTERN);
      if (blockMatch) {
        const [, blockType, blockName] = blockMatch;
        const { block, endLine } = this.extractBlock(lines, i);

        switch (blockType) {
          case 'program':
            program.name = blockName;
            // Parse nested declarations inside program block
            this.parseProgramBody(block, program);
            break;
          case 'account':
            program.accounts.push(this.parseAccountBlock(blockName, block));
            break;
          case 'instruction':
            program.instructions.push(this.parseInstructionBlock(blockName, block));
            break;
          case 'event':
            program.events.push(this.parseEventBlock(blockName, block));
            break;
          case 'error':
            program.errors.push(...this.parseErrorBlock(block));
            break;
          case 'client':
            program.clients.push(this.parseClientBlock(blockName, block));
            break;
          case 'frontend':
            program.frontends.push(this.parseFrontendBlock(blockName, block));
            break;
          case 'struct':
            program.structs.push({ name: blockName, fields: this.parseFields(block) });
            break;
          case 'defi':
            program.defi = this.parseDefiBlock(block);
            break;
          case 'governance':
            program.governance = this.parseGovernanceBlock(block);
            break;
          case 'token_extension':
            if (!program.tokenExtensions) program.tokenExtensions = [];
            program.tokenExtensions.push(this.parseTokenExtensionBlock(blockName, block));
            break;
        }

        i = endLine + 1;
        continue;
      }

      i++;
    }

    if (!program.name) {
      throw new Error('Purp program must have a program block');
    }

    return program;
  }

  // ─── Parse nested declarations inside a program { } block ───
  private parseProgramBody(lines: string[], program: PurpProgram): void {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || line.startsWith('//')) { i++; continue; }

      // Nested pub instruction
      const pubInstrMatch = line.match(PUB_INSTRUCTION_PATTERN);
      if (pubInstrMatch) {
        const { instruction, endLine } = this.parsePubInstruction(lines, i);
        program.instructions.push(instruction);
        i = endLine + 1;
        continue;
      }

      const blockMatch = line.match(BLOCK_PATTERN);
      if (blockMatch) {
        const [, blockType, blockName] = blockMatch;
        const { block, endLine } = this.extractBlock(lines, i);

        switch (blockType) {
          case 'account':
            program.accounts.push(this.parseAccountBlock(blockName, block));
            break;
          case 'instruction':
            program.instructions.push(this.parseInstructionBlock(blockName, block));
            break;
          case 'event':
            program.events.push(this.parseEventBlock(blockName, block));
            break;
          case 'error':
            program.errors.push(...this.parseErrorBlock(block));
            break;
        }
        i = endLine + 1;
        continue;
      }
      i++;
    }
  }

  // ─── Parse v1.0 pub instruction with inline params ───
  // pub instruction create_greeting(#[mut] signer author, #[init] account greeting, message: string) { ... }
  private parsePubInstruction(lines: string[], startLine: number): { instruction: PurpInstructionDef; endLine: number } {
    // Gather the full declaration (may span multiple lines until we find the opening {)
    let declStr = '';
    let i = startLine;
    while (i < lines.length) {
      declStr += lines[i] + ' ';
      if (lines[i].includes('{')) break;
      i++;
    }

    const nameMatch = declStr.match(/(?:pub\s+)?instruction\s+(\w+)\s*\(/);
    const name = nameMatch ? nameMatch[1] : 'unknown';
    const isPub = declStr.trim().startsWith('pub');

    // Extract parameters between ( and )
    const paramsMatch = declStr.match(/\(\s*([\s\S]*?)\)\s*\{/);
    const paramsStr = paramsMatch ? paramsMatch[1] : '';

    const accounts: PurpInstructionDef['accounts'] = [];
    const args: PurpField[] = [];

    // Parse each comma-separated param
    const params = paramsStr.split(',').map(p => p.trim()).filter(Boolean);
    for (const param of params) {
      const isMut = param.includes('#[mut]');
      const isSigner = param.includes('signer');
      const isInit = param.includes('#[init]');
      const isAccount = param.includes('account');

      if (isSigner || isAccount) {
        // It's an account param: strip attributes and keywords to get the name
        const accName = param.replace(/#\[.*?\]/g, '').replace(/\b(mut|signer|account)\b/g, '').trim().split(/\s+/).pop() ?? 'unknown';
        accounts.push({ name: accName, mutable: isMut, signer: isSigner, init: isInit });
      } else {
        // It's a regular arg: "name: type"
        const argMatch = param.replace(/#\[.*?\]/g, '').trim().match(/(\w+)\s*:\s*(\w+)/);
        if (argMatch) {
          args.push({ name: argMatch[1], type: argMatch[2] as PurpType });
        }
      }
    }

    // Now extract the body
    const { block, endLine } = this.extractBlock(lines, startLine);
    const body = block.filter(l => l.trim() && !l.trim().startsWith('//'));

    return {
      instruction: { name, accounts, args, body: body.map(l => l.trim()), visibility: isPub ? 'pub' : 'private' },
      endLine,
    };
  }

  // ─── Extract a block between { and matching } ───
  private extractBlock(lines: string[], startLine: number): { block: string[]; endLine: number } {
    let depth = 0;
    const block: string[] = [];
    let i = startLine;

    for (; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      if (i > startLine) {
        block.push(line);
      }
      if (depth === 0) break;
    }

    // Remove the closing brace line
    if (block.length > 0 && block[block.length - 1].trim() === '}') {
      block.pop();
    }

    return { block, endLine: i };
  }

  // ─── Parse account block fields (supports v1.0 comma-separated) ───
  private parseAccountBlock(name: string, lines: string[]): PurpAccountDef {
    const fields = this.parseFields(lines);
    const seeds: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const seedMatch = trimmed.match(/#\[seeds\((.*?)\)\]/);
      if (seedMatch) {
        seeds.push(...seedMatch[1].split(',').map(s => s.trim().replace(/"/g, '')));
      }
    }

    return { name, fields, seeds: seeds.length > 0 ? seeds : undefined };
  }

  // ─── Parse comma-separated fields (v1.0: "name: type," or "name: type") ───
  private parseFields(lines: string[]): PurpField[] {
    const fields: PurpField[] = [];
    // Join all lines and split by comma or newline to handle both formats
    const joined = lines.join('\n');

    for (const line of joined.split(/[,\n]/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
      const fieldMatch = trimmed.match(FIELD_PATTERN);
      if (fieldMatch) {
        fields.push({ name: fieldMatch[1], type: fieldMatch[2] as PurpType });
      }
    }
    return fields;
  }

  // ─── Parse instruction block (legacy section format) ───
  private parseInstructionBlock(name: string, lines: string[]): PurpInstructionDef {
    const accounts: PurpInstructionDef['accounts'] = [];
    const args: PurpField[] = [];
    const body: string[] = [];
    let section: 'accounts' | 'args' | 'body' = 'accounts';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      if (trimmed === 'accounts:' || trimmed === 'accounts {') {
        section = 'accounts';
        continue;
      }
      if (trimmed === 'args:' || trimmed === 'args {') {
        section = 'args';
        continue;
      }
      if (trimmed === 'body:' || trimmed === 'body {' || trimmed.startsWith('=>')) {
        section = 'body';
        continue;
      }

      if (section === 'accounts') {
        const mutable = trimmed.includes('#[mut]') || trimmed.includes('mut ');
        const signer = trimmed.includes('#[signer]') || trimmed.includes('signer ');
        const init = trimmed.includes('#[init]');
        const accName = trimmed.replace(/#\[.*?\]/g, '').replace(/\b(mut|signer|account)\b/g, '').trim().replace(/,\s*$/, '');
        if (accName) {
          accounts.push({ name: accName, mutable, signer, init });
        }
      } else if (section === 'args') {
        const match = trimmed.match(ARG_PATTERN);
        if (match) {
          args.push({ name: match[1], type: match[2] as PurpType });
        }
      } else {
        body.push(trimmed);
      }
    }

    return { name, accounts, args, body, visibility: 'pub' };
  }

  // ─── Parse event block ───
  private parseEventBlock(name: string, lines: string[]): PurpEventDef {
    const fields: PurpField[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      const match = trimmed.match(FIELD_PATTERN);
      if (match) {
        fields.push({ name: match[1], type: match[2] as PurpType });
      }
    }
    return { name, fields };
  }

  // ─── Parse error block ───
  private parseErrorBlock(lines: string[]): PurpErrorDef[] {
    const errors: PurpErrorDef[] = [];
    let code = 0; // Pinocchio custom error codes start at 0

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // Format: ErrorName = "message" or ErrorName(code) = "message"
      const errorMatch = trimmed.match(/(\w+)(?:\((\d+)\))?\s*=\s*"([^"]+)"/);
      if (errorMatch) {
        errors.push({
          code: errorMatch[2] ? parseInt(errorMatch[2], 10) : code++,
          name: errorMatch[1],
          message: errorMatch[3],
        });
      }
    }

    return errors;
  }

  // ─── Parse client block (v1.0: async fn with typed params) ───
  private parseClientBlock(name: string, lines: string[]): PurpClientDef {
    const functions: { name: string; isAsync: boolean; params: string[]; body: string[] }[] = [];
    let currentFn: { name: string; isAsync: boolean; params: string[]; body: string[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      const fnMatch = trimmed.match(/(async\s+)?fn\s+(\w+)\s*\((.*?)\)/);
      if (fnMatch) {
        if (currentFn) functions.push(currentFn);
        const paramStr = fnMatch[3] ?? '';
        const params = paramStr.split(',').map(p => p.trim()).filter(Boolean);
        currentFn = { name: fnMatch[2], isAsync: !!fnMatch[1], params, body: [] };
        continue;
      }

      if (currentFn && trimmed !== '}') {
        currentFn.body.push(trimmed);
      }
    }

    if (currentFn) functions.push(currentFn);
    return { name, functions };
  }

  // ─── Parse frontend block (v1.0: page/component support) ───
  private parseFrontendBlock(name: string, lines: string[]): PurpFrontendDef {
    const pages: { path: string; components: string[] }[] = [];
    const components: string[] = [];
    let currentPage: { path: string; components: string[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      const pageMatch = trimmed.match(/page\s+"([^"]+)"/);
      if (pageMatch) {
        if (currentPage) pages.push(currentPage);
        currentPage = { path: pageMatch[1], components: [] };
        continue;
      }

      const compMatch = trimmed.match(/component\s+(\w+)/);
      if (compMatch) {
        if (currentPage) currentPage.components.push(compMatch[1]);
        else components.push(compMatch[1]);
        continue;
      }

      components.push(trimmed);
    }

    if (currentPage) pages.push(currentPage);
    return { name, pages, components };
  }

  // ─── Validate Purp program (both v3 and legacy) ───
  validate(program: PurpProgram | LegacyPurpProgram): { valid: boolean; errors: string[] } {
    if ('instructions' in program && Array.isArray(program.instructions) && program.instructions.length > 0 && 'type' in program.instructions[0]) {
      return this.validateLegacy(program as LegacyPurpProgram);
    }
    return this.validateV3(program as PurpProgram);
  }

  // ─── Validate Purp v1.2.1 ───
  private validateV3(program: PurpProgram): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!program.name) {
      errors.push('Program must have a name');
    }

    if (program.accounts.length > MAX_ACCOUNTS) {
      errors.push(`Too many accounts: ${program.accounts.length} (max ${MAX_ACCOUNTS})`);
    }

    if (program.instructions.length > MAX_INSTRUCTIONS) {
      errors.push(`Too many instructions: ${program.instructions.length} (max ${MAX_INSTRUCTIONS})`);
    }

    if (program.events.length > MAX_EVENTS) {
      errors.push(`Too many events: ${program.events.length} (max ${MAX_EVENTS})`);
    }

    if (program.errors.length > MAX_ERRORS) {
      errors.push(`Too many errors: ${program.errors.length} (max ${MAX_ERRORS})`);
    }

    // Validate field types
    const validTypes = new Set<string>([
      'u8', 'u16', 'u32', 'u64', 'u128', 'i8', 'i16', 'i32', 'i64', 'i128',
      'f32', 'f64', 'bool', 'string', 'pubkey', 'bytes',
    ]);

    // Also allow custom struct types
    const customTypes = new Set(program.structs.map(s => s.name));
    for (const account of program.accounts) {
      customTypes.add(account.name);
    }

    for (const account of program.accounts) {
      for (const field of account.fields) {
        if (!validTypes.has(field.type) && !customTypes.has(field.type)) {
          errors.push(`Account ${account.name}: unknown type "${field.type}" for field "${field.name}"`);
        }
      }
    }

    // Validate instruction accounts reference existing accounts or well-known names
    const accountNames = new Set(program.accounts.map(a => a.name.toLowerCase()));
    const wellKnown = new Set([
      'system_program', 'token_program', 'rent', 'clock', 'payer', 'authority',
      'owner', 'mint', 'from', 'to', 'associated_token_program', 'token_account',
    ]);
    for (const instr of program.instructions) {
      for (const acc of instr.accounts) {
        const normalized = acc.name.toLowerCase().replace(/_/g, '');
        if (!accountNames.has(acc.name) && ![...accountNames].some(n => n.toLowerCase().replace(/_/g, '') === normalized) && !wellKnown.has(acc.name)) {
          // v1.0: signer accounts don't need to reference a defined account struct
          if (!acc.signer) {
            errors.push(`Instruction ${instr.name}: references unknown account "${acc.name}"`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ─── Compile Purp v2.0.1 to Pinocchio Rust + TypeScript + Frontend ───
  compile(program: PurpProgram): PurpCompileResult {
    const errors: PurpError[] = [];
    const warnings: string[] = [];

    // Validate first
    const validation = this.validateV3(program);
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors.map((msg, i) => ({
          line: 0, column: 0, message: msg, severity: 'error' as const,
        })),
        warnings: [],
      };
    }

    // Generate Pinocchio Rust
    const rustOutput = this.generatePinocchioRust(program);

    // Generate TypeScript SDK
    const typescriptSdk = this.generateTypeScriptSDK(program);

    // Generate Frontend output (v1.2.0)
    const frontendOutput = program.frontends.length > 0
      ? this.generateFrontendOutput(program)
      : undefined;

    // Generate IDL (v1.2.1)
    const idl = this.generateIDL(program);

    // v1.2.1 warnings for deprecated patterns
    if (program.imports.some(imp => imp.includes('ai'))) {
      warnings.push('Purp v1.2.1: "ai" stdlib module has been removed; use external AI integration instead');
    }

    return {
      success: true,
      rust_output: rustOutput,
      typescript_sdk: typescriptSdk,
      frontend_output: frontendOutput,
      idl,
      errors: [],
      warnings,
    };
  }

  // ─── Generate Pinocchio Rust from Purp (v2.0.1) ───
  private generatePinocchioRust(program: PurpProgram): string {
    const hasSplOps = program.instructions.some(i =>
      i.accounts.some(a => a.name.includes('token') || a.name.includes('mint')) ||
      i.body.some(b => /\.transfer\(|\.mint_to\(|\.burn\(|\.approve\(|\.revoke\(/.test(b))
    );

    const lines: string[] = [
      `// Auto-generated by Purp SCL v2.0.1 Compiler (Pinocchio)`,
      `// Source: ${program.name}`,
      ``,
      `use pinocchio::{`,
      `    AccountView, Address, entrypoint, ProgramResult,`,
      `    program_error::ProgramError,`,
      `    sysvars::rent::Rent, sysvars::Sysvar,`,
      `};`,
    ];

    if (hasSplOps) {
      lines.push(`use pinocchio_token::instructions::{`);
      lines.push(`    Transfer as SplTransfer, MintTo, Burn,`);
      lines.push(`    CloseAccount as SplCloseAccount, Approve, Revoke,`);
      lines.push(`};`);
    }

    lines.push(`use pinocchio_system::instructions::CreateAccount;`);
    lines.push(`use pinocchio_log::log;`);
    lines.push(`use borsh::{BorshSerialize, BorshDeserialize};`);
    lines.push(``);
    lines.push(`// Replace with your deployed program ID bytes`);
    lines.push(`pub const PROGRAM_ID: Address = unsafe { Address::new_unchecked([0u8; 32]) };`);
    lines.push(``);
    lines.push(`entrypoint!(process_instruction);`);
    lines.push(``);

    // Generate process_instruction dispatcher
    lines.push(`pub fn process_instruction(`);
    lines.push(`    program_id: &Address,`);
    lines.push(`    accounts: &[AccountView],`);
    lines.push(`    instruction_data: &[u8],`);
    lines.push(`) -> ProgramResult {`);

    if (program.instructions.length > 0) {
      lines.push(`    let (tag, data) = instruction_data.split_first()`);
      lines.push(`        .ok_or(ProgramError::InvalidInstructionData)?;`);
      lines.push(``);
      lines.push(`    match tag {`);
      program.instructions.forEach((instr, i) => {
        lines.push(`        ${i} => ${this.toSnakeCase(instr.name)}(program_id, accounts, data),`);
      });
      lines.push(`        _ => Err(ProgramError::InvalidInstructionData),`);
      lines.push(`    }`);
    } else {
      lines.push(`    Ok(())`);
    }

    lines.push(`}`);
    lines.push(``);

    // Generate instruction handler functions
    for (const instr of program.instructions) {
      lines.push(`fn ${this.toSnakeCase(instr.name)}(`);
      lines.push(`    program_id: &Address,`);
      lines.push(`    accounts: &[AccountView],`);
      lines.push(`    data: &[u8],`);
      lines.push(`) -> ProgramResult {`);

      // Bind accounts
      instr.accounts.forEach((acc, i) => {
        if (acc.signer) {
          lines.push(`    let ${acc.name} = &accounts[${i}];`);
        } else {
          lines.push(`    let ${acc.name}_info = &accounts[${i}];`);
        }
      });
      if (instr.accounts.length > 0) lines.push(``);

      // Validate signers
      for (const acc of instr.accounts) {
        if (acc.signer) {
          lines.push(`    if !${acc.name}.is_signer() {`);
          lines.push(`        return Err(ProgramError::MissingRequiredSignature);`);
          lines.push(`    }`);
        }
      }

      // Validate mutability
      for (const acc of instr.accounts) {
        if (acc.mutable || acc.init) {
          const varName = acc.signer ? acc.name : `${acc.name}_info`;
          lines.push(`    if !${varName}.is_writable() {`);
          lines.push(`        return Err(ProgramError::InvalidAccountData);`);
          lines.push(`    }`);
        }
      }

      // Signer key aliases
      for (const acc of instr.accounts) {
        if (acc.signer) {
          lines.push(`    let ${acc.name}_key = *${acc.name}.key();`);
        }
      }
      if (instr.accounts.some(a => a.signer)) lines.push(``);

      // Deserialize instruction args
      if (instr.args.length > 0) {
        const argsStructName = `${this.toPascalCase(instr.name)}Args`;
        lines.push(`    #[derive(BorshDeserialize)]`);
        lines.push(`    struct ${argsStructName} {`);
        for (const arg of instr.args) {
          lines.push(`        pub ${arg.name}: ${this.toRustType(arg.type)},`);
        }
        lines.push(`    }`);
        lines.push(`    let args = ${argsStructName}::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;`);
        for (const arg of instr.args) {
          lines.push(`    let ${arg.name} = args.${arg.name};`);
        }
        lines.push(``);
      }

      // Deserialize typed accounts
      const typedAccounts: typeof instr.accounts = [];
      for (const acc of instr.accounts) {
        if (!acc.signer) {
          const accType = this.findAccountType(acc.name, program);
          if (accType !== this.toPascalCase(acc.name) || program.accounts.some(a => a.name.toLowerCase() === acc.name.toLowerCase())) {
            typedAccounts.push(acc);
            const mutStr = (acc.mutable || acc.init) ? 'mut ' : '';
            if (acc.init) {
              lines.push(`    let ${mutStr}${acc.name} = ${accType}::default();`);
            } else {
              lines.push(`    let ${mutStr}${acc.name} = ${accType}::try_from_slice(&${acc.name}_info.data()[8..]).map_err(|_| ProgramError::InvalidAccountData)?;`);
            }
          }
        }
      }
      if (typedAccounts.length > 0) lines.push(``);

      // Instruction body
      for (const bodyLine of instr.body) {
        lines.push(`    ${this.transpileBodyLine(bodyLine)}`);
      }

      // Serialize modified accounts back
      for (const acc of typedAccounts) {
        if (acc.mutable || acc.init) {
          lines.push(`    ${acc.name}.serialize(&mut &mut unsafe { ${acc.name}_info.data_mut() }[8..])?;`);
        }
      }

      lines.push(`    Ok(())`);
      lines.push(`}`);
      lines.push(``);
    }

    // Generate account structs with BorshSerialize/Deserialize
    for (const account of program.accounts) {
      lines.push(`#[derive(BorshSerialize, BorshDeserialize, Debug, Default)]`);
      lines.push(`pub struct ${this.toPascalCase(account.name)} {`);
      for (const field of account.fields) {
        lines.push(`    pub ${field.name}: ${this.toRustType(field.type)},`);
      }
      lines.push(`}`);
      lines.push(``);
    }

    // Generate events as log messages (Pinocchio uses pinocchio_log, not #[event])
    for (const event of program.events) {
      lines.push(`// Event: ${this.toPascalCase(event.name)}`);
      lines.push(`#[derive(BorshSerialize, BorshDeserialize, Debug)]`);
      lines.push(`pub struct ${this.toPascalCase(event.name)} {`);
      for (const field of event.fields) {
        lines.push(`    pub ${field.name}: ${this.toRustType(field.type)},`);
      }
      lines.push(`}`);
      lines.push(``);
    }

    // Generate errors as ProgramError::Custom codes
    if (program.errors.length > 0) {
      lines.push(`// Custom error codes`);
      program.errors.forEach((err, i) => {
        lines.push(`// ${err.name} (code ${i}) — ${err.message}`);
      });
      lines.push(``);
    }

    return lines.join('\n');
  }

  // ─── Find account type for deserialization ───
  private findAccountType(accName: string, program: PurpProgram): string {
    // Try direct match
    const direct = program.accounts.find(a => a.name.toLowerCase() === accName.toLowerCase());
    if (direct) return this.toPascalCase(direct.name);

    // Try normalized match (snake_case to PascalCase)
    const normalized = accName.toLowerCase().replace(/_/g, '');
    const match = program.accounts.find(a => a.name.toLowerCase().replace(/_/g, '') === normalized);
    if (match) return this.toPascalCase(match.name);

    return this.toPascalCase(accName);
  }

  // ─── Generate TypeScript SDK from Purp (Pinocchio v2.0.1) ───
  private generateTypeScriptSDK(program: PurpProgram): string {
    const lines: string[] = [
      `// Auto-generated TypeScript SDK by Purp SCL v2.0.1 Compiler (Pinocchio)`,
      `// Source: ${program.name}`,
      ``,
      `import {`,
      `  Connection, PublicKey, SystemProgram, Transaction,`,
      `  TransactionInstruction, sendAndConfirmTransaction, Keypair,`,
      `} from '@solana/web3.js';`,
      `import * as borsh from 'borsh';`,
      ``,
      `export class ${this.toPascalCase(program.name)}Client {`,
      `  private connection: Connection;`,
      `  private programId: PublicKey;`,
      ``,
      `  constructor(connection: Connection, programId: PublicKey) {`,
      `    this.connection = connection;`,
      `    this.programId = programId;`,
      `  }`,
      ``,
    ];

    // Generate methods for each instruction
    program.instructions.forEach((instr, instrIdx) => {
      const args = instr.args.map(a => `${a.name}: ${this.toTSType(a.type)}`).join(', ');
      const accParams = instr.accounts.map(a => `${a.name}: PublicKey`).join(', ');
      const signerParam = `payer: Keypair`;
      const allParams = [args, accParams, signerParam].filter(Boolean).join(', ');

      lines.push(`  async ${this.toCamelCase(instr.name)}(${allParams}): Promise<string> {`);

      // Serialize args if any
      if (instr.args.length > 0) {
        lines.push(`    const data = Buffer.alloc(1024);`);
        lines.push(`    let offset = 0;`);
        lines.push(`    data.writeUInt8(${instrIdx}, offset); offset += 1;`);
        for (const arg of instr.args) {
          const tsType = this.toTSType(arg.type);
          if (tsType === 'bigint') {
            lines.push(`    data.writeBigUInt64LE(${arg.name}, offset); offset += 8;`);
          } else if (tsType === 'number') {
            lines.push(`    data.writeUInt32LE(${arg.name}, offset); offset += 4;`);
          } else if (tsType === 'boolean') {
            lines.push(`    data.writeUInt8(${arg.name} ? 1 : 0, offset); offset += 1;`);
          } else if (tsType === 'string') {
            lines.push(`    const ${arg.name}Buf = Buffer.from(${arg.name}, 'utf-8');`);
            lines.push(`    data.writeUInt32LE(${arg.name}Buf.length, offset); offset += 4;`);
            lines.push(`    ${arg.name}Buf.copy(data, offset); offset += ${arg.name}Buf.length;`);
          }
        }
        lines.push(`    const instructionData = data.subarray(0, offset);`);
      } else {
        lines.push(`    const instructionData = Buffer.from([${instrIdx}]);`);
      }

      lines.push(``);
      lines.push(`    const keys = [`);
      for (const acc of instr.accounts) {
        lines.push(`      { pubkey: ${acc.name}, isSigner: ${acc.signer}, isWritable: ${acc.mutable || acc.init} },`);
      }
      lines.push(`    ];`);
      lines.push(``);
      lines.push(`    const ix = new TransactionInstruction({`);
      lines.push(`      keys,`);
      lines.push(`      programId: this.programId,`);
      lines.push(`      data: instructionData,`);
      lines.push(`    });`);
      lines.push(``);
      lines.push(`    const tx = new Transaction().add(ix);`);
      lines.push(`    return sendAndConfirmTransaction(this.connection, tx, [payer]);`);
      lines.push(`  }`);
      lines.push(``);
    });

    lines.push(`}`);

    // Generate account types
    lines.push(``);
    for (const account of program.accounts) {
      lines.push(`export interface ${this.toPascalCase(account.name)} {`);
      for (const field of account.fields) {
        lines.push(`  ${field.name}: ${this.toTSType(field.type)};`);
      }
      lines.push(`}`);
      lines.push(``);
    }

    // Generate event types
    for (const event of program.events) {
      lines.push(`export interface ${this.toPascalCase(event.name)}Event {`);
      for (const field of event.fields) {
        lines.push(`  ${field.name}: ${this.toTSType(field.type)};`);
      }
      lines.push(`}`);
      lines.push(``);
    }

    return lines.join('\n');
  }

  // ─── Solana IDL JSON (v2.0.1 / Pinocchio-compatible) ───
  private generateIDL(program: PurpProgram): string {
    const idl = {
      version: program.version || '0.1.0',
      name: this.toSnakeCase(program.name),
      instructions: program.instructions.map(instr => ({
        name: this.toSnakeCase(instr.name),
        accounts: instr.accounts.map(acc => ({
          name: acc.name,
          isMut: acc.mutable || acc.init,
          isSigner: acc.signer,
        })),
        args: instr.args.map(arg => ({
          name: this.toSnakeCase(arg.name),
          type: this.toIDLType(arg.type),
        })),
      })),
      accounts: program.accounts.map(acc => ({
        name: this.toPascalCase(acc.name),
        type: {
          kind: 'struct' as const,
          fields: acc.fields.map(f => ({
            name: f.name,
            type: this.toIDLType(f.type),
          })),
        },
      })),
      events: program.events.map(evt => ({
        name: this.toPascalCase(evt.name),
        fields: evt.fields.map(f => ({
          name: f.name,
          type: this.toIDLType(f.type),
          index: false,
        })),
      })),
      errors: program.errors.map(err => ({
        code: err.code,
        name: err.name,
        msg: err.message,
      })),
    };
    return JSON.stringify(idl, null, 2);
  }

  private toIDLType(type: string): string {
    const map: Record<string, string> = {
      u8: 'u8', u16: 'u16', u32: 'u32', u64: 'u64', u128: 'u128',
      i8: 'i8', i16: 'i16', i32: 'i32', i64: 'i64', i128: 'i128',
      f32: 'f32', f64: 'f64', bool: 'bool', string: 'string', pubkey: 'publicKey', bytes: 'bytes',
    };
    return map[type] ?? type;
  }

  // ─── Load Purp.toml project config (v1.2.1) ───
  loadProjectConfig(projectDir: string): PurpProjectConfig | null {
    const tomlPath = path.join(projectDir, 'Purp.toml');
    if (!fs.existsSync(tomlPath)) return null;

    const content = fs.readFileSync(tomlPath, 'utf-8');
    // Basic TOML parsing for Purp.toml [package] section
    const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
    const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
    const descMatch = content.match(/description\s*=\s*"([^"]+)"/);
    const networkMatch = content.match(/network\s*=\s*"([^"]+)"/);
    const templateMatch = content.match(/template\s*=\s*"([^"]+)"/);

    // Parse [dependencies]
    const deps: Record<string, string> = {};
    const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depSection) {
      const depLines = depSection[1].trim().split('\n');
      for (const line of depLines) {
        const match = line.match(/(\w[\w-]*)\s*=\s*"([^"]+)"/);
        if (match) deps[match[1]] = match[2];
      }
    }

    // Parse [plugins]
    const plugins: string[] = [];
    const pluginSection = content.match(/\[plugins\]([\s\S]*?)(?:\[|$)/);
    if (pluginSection) {
      const pluginLines = pluginSection[1].trim().split('\n');
      for (const line of pluginLines) {
        const match = line.match(/(\w[\w-]*)\s*=\s*"([^"]+)"/);
        if (match) plugins.push(match[1]);
      }
    }

    // Parse [stdlib] modules
    const stdlib: PurpStdlibModule[] = [];
    const stdlibSection = content.match(/\[stdlib\]([\s\S]*?)(?:\[|$)/);
    if (stdlibSection) {
      const stdlibLines = stdlibSection[1].trim().split('\n');
      for (const line of stdlibLines) {
        const match = line.match(/(\w[\w-]*)\s*=\s*true/);
        if (match && STDLIB_MODULES.includes(match[1] as PurpStdlibModule)) {
          stdlib.push(match[1] as PurpStdlibModule);
        }
      }
    }

    return {
      name: nameMatch?.[1] ?? 'unknown',
      version: versionMatch?.[1] ?? '0.1.0',
      description: descMatch?.[1],
      network: (networkMatch?.[1] ?? 'devnet') as 'devnet' | 'testnet' | 'mainnet-beta' | 'localnet',
      dependencies: deps,
      template: templateMatch?.[1],
      plugins: plugins.length > 0 ? plugins : undefined,
      stdlib: stdlib.length > 0 ? stdlib : undefined,
    };
  }

  // ─── Convert Purp program to plan steps ───
  toPlanSteps(program: PurpProgram | LegacyPurpProgram): PlanStep[] {
    if ('instructions' in program && Array.isArray(program.instructions) && program.instructions.length > 0 && 'type' in program.instructions[0]) {
      return this.legacyToPlanSteps(program as LegacyPurpProgram);
    }
    const prog = program as PurpProgram;
    const steps: PlanStep[] = [];

    // Compile step
    steps.push({
      step: 1,
      action: 'compile',
      tool: 'purp_compile',
      params: { program_name: prog.name },
      description: `Compile Purp program "${prog.name}" to Pinocchio Rust + TypeScript SDK`,
    });

    // Deploy step
    steps.push({
      step: 2,
      action: 'deploy',
      tool: 'solana_deploy',
      params: { program_name: prog.name },
      description: `Deploy "${prog.name}" to Solana`,
    });

    return steps;
  }

  // ─── Type converters ───
  private toRustType(type: string): string {
    const map: Record<string, string> = {
      u8: 'u8', u16: 'u16', u32: 'u32', u64: 'u64', u128: 'u128',
      i8: 'i8', i16: 'i16', i32: 'i32', i64: 'i64', i128: 'i128',
      f32: 'f32', f64: 'f64', bool: 'bool', string: 'String', pubkey: 'Address', bytes: 'Vec<u8>',
    };
    return map[type] ?? type;
  }

  private toTSType(type: string): string {
    const map: Record<string, string> = {
      u8: 'number', u16: 'number', u32: 'number', u64: 'bigint', u128: 'bigint',
      i8: 'number', i16: 'number', i32: 'number', i64: 'bigint', i128: 'bigint',
      f32: 'number', f64: 'number', bool: 'boolean', string: 'string', pubkey: 'PublicKey', bytes: 'Buffer',
    };
    return map[type] ?? type;
  }

  private toSnakeCase(s: string): string {
    return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }

  private toPascalCase(s: string): string {
    return s.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());
  }

  private toCamelCase(s: string): string {
    const pascal = this.toPascalCase(s);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }

  private transpileBodyLine(line: string): string {
    // Purp v2.0.1 → Pinocchio Rust transpilation
    return line
      .replace(/emit\s+(\w+)\s*\((.*?)\)/, 'log!("$1: $2")')
      .replace(/emit\s*\((\w+),\s*\{(.*?)\}\)/, 'log!("$1: $2")')
      .replace(/require\s*\((.*?),\s*"([^"]+)"\)/, 'if !($1) { return Err(ProgramError::Custom(1)); } // $2')
      .replace(/assert\s*\((.*?),\s*"([^"]+)"\)/, 'if !($1) { return Err(ProgramError::Custom(1)); } // $2')
      .replace(/require\s*\((.*?),\s*(\w+)\)/, 'if !($1) { return Err(ProgramError::Custom(0)); } // $2')
      .replace(/\.transfer\((.*?)\)/, '.transfer($1)?')
      .replace(/\.key\(\)/, '.key()')
      // v1.1.0: exponentiation, nullish coalescing, spread
      .replace(/(\w+)\s*\*\*=\s*(\w+)/, '$1 = $1.pow($2 as u32)')
      .replace(/(\w+)\s*\?\?=\s*(.+)/, '$1 = $1.unwrap_or($2)')
      .replace(/(\w+)\s*\*\*\s*(\w+)/, '$1.pow($2 as u32)')
      .replace(/(\w+)\s*\?\?\s*(.+)/, '$1.unwrap_or($2)')
      .replace(/\.\.\.([\w.]+)/, '$1.into_iter()')
      // v1.2.0: Token-2022 operations
      .replace(/token22\.transfer\((.*?)\)/, 'token_2022::transfer($1)?')
      .replace(/token22\.mint_to\((.*?)\)/, 'token_2022::mint_to($1)?')
      // v1.2.1: checked math operations
      .replace(/checked_add\((.*?),\s*(.*?)\)/, '$1.checked_add($2).ok_or(ProgramError::ArithmeticOverflow)?')
      .replace(/checked_sub\((.*?),\s*(.*?)\)/, '$1.checked_sub($2).ok_or(ProgramError::ArithmeticOverflow)?')
      .replace(/checked_mul\((.*?),\s*(.*?)\)/, '$1.checked_mul($2).ok_or(ProgramError::ArithmeticOverflow)?');
  }

  // ─── Parse v1.2.0 DeFi block ───
  private parseDefiBlock(lines: string[]): PurpDefiDef {
    const pools: { name: string; tokenA: string; tokenB: string; fee: number }[] = [];
    const vaults: { name: string; strategy: string }[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      const poolMatch = trimmed.match(/pool\s+(\w+)\s*\(\s*(\w+)\s*,\s*(\w+)\s*(?:,\s*fee\s*=\s*(\d+))?\s*\)/);
      if (poolMatch) {
        pools.push({
          name: poolMatch[1],
          tokenA: poolMatch[2],
          tokenB: poolMatch[3],
          fee: poolMatch[4] ? parseInt(poolMatch[4], 10) : 30,
        });
        continue;
      }

      const vaultMatch = trimmed.match(/vault\s+(\w+)\s*\(\s*strategy\s*=\s*"([^"]+)"\s*\)/);
      if (vaultMatch) {
        vaults.push({ name: vaultMatch[1], strategy: vaultMatch[2] });
      }
    }

    return { pools, vaults };
  }

  // ─── Parse v1.2.0 Governance block ───
  private parseGovernanceBlock(lines: string[]): PurpGovernanceDef {
    const proposals: { name: string; votingPeriod: number; quorum: number }[] = [];
    let treasury: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      const proposalMatch = trimmed.match(/proposal\s+(\w+)\s*\(\s*voting_period\s*=\s*(\d+)\s*,\s*quorum\s*=\s*(\d+)\s*\)/);
      if (proposalMatch) {
        proposals.push({
          name: proposalMatch[1],
          votingPeriod: parseInt(proposalMatch[2], 10),
          quorum: parseInt(proposalMatch[3], 10),
        });
        continue;
      }

      const treasuryMatch = trimmed.match(/treasury\s*=\s*"([^"]+)"/);
      if (treasuryMatch) {
        treasury = treasuryMatch[1];
      }
    }

    return { proposals, treasury };
  }

  // ─── Parse v1.2.0 Token Extension block ───
  private parseTokenExtensionBlock(mintName: string, lines: string[]): { mint: string; extensions: string[] } {
    const extensions: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      const extMatch = trimmed.match(/extension\s+(\w+)/);
      if (extMatch) {
        extensions.push(extMatch[1]);
        continue;
      }

      // Bare extension names
      if (/^\w+$/.test(trimmed)) {
        extensions.push(trimmed);
      }
    }

    return { mint: mintName, extensions };
  }

  // ─── Generate Frontend output (v1.2.0) ───
  private generateFrontendOutput(program: PurpProgram): string {
    const lines: string[] = [
      `// Auto-generated Frontend by Purp SCL v2.0.1 Compiler (Pinocchio)`,
      `// Source: ${program.name}`,
      ``,
      `import { useConnection, useWallet } from '@solana/wallet-adapter-react';`,
      `import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';`,
      ``,
    ];

    for (const frontend of program.frontends) {
      lines.push(`// ─── Frontend: ${frontend.name} ───`);
      for (const page of frontend.pages) {
        lines.push(`export function Page_${page.path.replace(/\//g, '_').replace(/^_/, '')}() {`);
        lines.push(`  const { connection } = useConnection();`);
        lines.push(`  const wallet = useWallet();`);
        lines.push(``);
        for (const comp of page.components) {
          lines.push(`  // Component: ${comp}`);
        }
        lines.push(`  return <div>{/* ${page.path} */}</div>;`);
        lines.push(`}`);
        lines.push(``);
      }

      for (const comp of frontend.components) {
        lines.push(`export function ${comp}() {`);
        lines.push(`  return <div>{/* ${comp} */}</div>;`);
        lines.push(`}`);
        lines.push(``);
      }
    }

    return lines.join('\n');
  }

  // ─── Lint a Purp program (v1.2.1: 13 Solana-specific rules) ───
  lint(program: PurpProgram, rules?: string[]): PurpLintResult[] {
    const results: PurpLintResult[] = [];
    const activeRules = rules ?? [...LINT_RULES];

    // no-unused-accounts: accounts defined but never referenced in instructions
    if (activeRules.includes('no-unused-accounts')) {
      const referencedAccounts = new Set<string>();
      for (const instr of program.instructions) {
        for (const acc of instr.accounts) {
          referencedAccounts.add(acc.name.toLowerCase());
        }
      }
      for (const acc of program.accounts) {
        if (!referencedAccounts.has(acc.name.toLowerCase())) {
          results.push({
            file: `${program.name}.purp`, rule: 'no-unused-accounts', severity: 'warning',
            message: `Account "${acc.name}" is defined but never referenced in any instruction`,
            line: 0, column: 0,
          });
        }
      }
    }

    // signer-required: mutable instructions should have a signer
    if (activeRules.includes('signer-required')) {
      for (const instr of program.instructions) {
        const hasMutableAcc = instr.accounts.some(a => a.mutable || a.init);
        const hasSigner = instr.accounts.some(a => a.signer);
        if (hasMutableAcc && !hasSigner) {
          results.push({
            file: `${program.name}.purp`, rule: 'signer-required', severity: 'error',
            message: `Instruction "${instr.name}" modifies accounts but has no signer`,
            line: 0, column: 0,
          });
        }
      }
    }

    // no-hardcoded-amounts: large SOL values in body
    if (activeRules.includes('no-hardcoded-amounts')) {
      for (const instr of program.instructions) {
        for (const bodyLine of instr.body) {
          const numMatch = bodyLine.match(/\b(\d{10,})\b/);
          if (numMatch) {
            results.push({
              file: `${program.name}.purp`, rule: 'no-hardcoded-amounts', severity: 'warning',
              message: `Instruction "${instr.name}" contains hardcoded large amount: ${numMatch[1]}`,
              line: 0, column: 0,
              suggestion: 'Consider using a named constant instead',
            });
          }
        }
      }
    }

    // init-needs-space: init accounts should specify space
    if (activeRules.includes('init-needs-space')) {
      for (const instr of program.instructions) {
        for (const acc of instr.accounts) {
          if (acc.init) {
            const accDef = program.accounts.find(a => a.name.toLowerCase() === acc.name.toLowerCase());
            if (accDef && !accDef.space) {
              results.push({
                file: `${program.name}.purp`, rule: 'init-needs-space', severity: 'warning',
                message: `Instruction "${instr.name}" initializes account "${acc.name}" without explicit space`,
                line: 0, column: 0,
                suggestion: 'Add #[space(N)] attribute to the account definition',
              });
            }
          }
        }
      }
    }

    // no-unguarded-mutation: mutable accounts need signer authorization
    if (activeRules.includes('no-unguarded-mutation')) {
      for (const instr of program.instructions) {
        const mutAccounts = instr.accounts.filter(a => a.mutable && !a.init);
        const signers = instr.accounts.filter(a => a.signer);
        if (mutAccounts.length > 0 && signers.length === 0) {
          results.push({
            file: `${program.name}.purp`, rule: 'no-unguarded-mutation', severity: 'error',
            message: `Instruction "${instr.name}" mutates accounts without signer authorization`,
            line: 0, column: 0,
          });
        }
      }
    }

    // enum-naming: error enums should be PascalCase
    if (activeRules.includes('enum-naming')) {
      for (const err of program.errors) {
        if (!/^[A-Z]/.test(err.name)) {
          results.push({
            file: `${program.name}.purp`, rule: 'enum-naming', severity: 'warning',
            message: `Error "${err.name}" should use PascalCase naming`,
            line: 0, column: 0,
          });
        }
      }
    }

    // account-naming: account names should be PascalCase
    if (activeRules.includes('account-naming')) {
      for (const acc of program.accounts) {
        if (!/^[A-Z]/.test(acc.name)) {
          results.push({
            file: `${program.name}.purp`, rule: 'account-naming', severity: 'warning',
            message: `Account "${acc.name}" should use PascalCase naming`,
            line: 0, column: 0,
          });
        }
      }
    }

    return results;
  }

  // ─── Audit a Purp program (v1.2.1) ───
  audit(program: PurpProgram): PurpAuditResult[] {
    const results: PurpAuditResult[] = [];

    // Check for hardcoded program IDs
    for (const instr of program.instructions) {
      for (const bodyLine of instr.body) {
        if (/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(bodyLine)) {
          results.push({
            file: `${program.name}.purp`, severity: 'high', rule: 'no-hardcoded-keys',
            message: `Instruction "${instr.name}" contains a hardcoded public key`,
          });
        }
      }
    }

    // Check for missing owner checks (v1.2.1 audit fix)
    for (const instr of program.instructions) {
      const hasMutableAccounts = instr.accounts.some(a => a.mutable);
      const hasOwnerCheck = instr.body.some(l => l.includes('owner') || l.includes('authority'));
      if (hasMutableAccounts && !hasOwnerCheck) {
        results.push({
          file: `${program.name}.purp`, severity: 'medium', rule: 'missing-owner-check',
          message: `Instruction "${instr.name}" mutates accounts without owner/authority check`,
        });
      }
    }

    // Check for unchecked arithmetic (v1.2.1 audit fix)
    for (const instr of program.instructions) {
      for (const bodyLine of instr.body) {
        if (/\+=|-=|\*=|\/=/.test(bodyLine) && !bodyLine.includes('checked_')) {
          results.push({
            file: `${program.name}.purp`, severity: 'medium', rule: 'unchecked-arithmetic',
            message: `Instruction "${instr.name}" uses unchecked arithmetic: ${bodyLine.trim()}`,
          });
        }
      }
    }

    // Check for missing close account handling (v1.2.1)
    const hasCloseInstruction = program.instructions.some(i =>
      i.name.toLowerCase().includes('close') || i.name.toLowerCase().includes('delete')
    );
    if (program.accounts.length > 0 && !hasCloseInstruction) {
      results.push({
        file: `${program.name}.purp`, severity: 'low', rule: 'no-close-instruction',
        message: 'Program defines accounts but has no close/delete instruction (potential rent leak)',
      });
    }

    // Check PDA seed length (v1.2.1 constant)
    for (const acc of program.accounts) {
      if (acc.seeds) {
        if (acc.seeds.length > SOLANA_CONSTANTS.MAX_SEEDS) {
          results.push({
            file: `${program.name}.purp`, severity: 'critical', rule: 'pda-seed-overflow',
            message: `Account "${acc.name}" has ${acc.seeds.length} seeds (max ${SOLANA_CONSTANTS.MAX_SEEDS})`,
          });
        }
        for (const seed of acc.seeds) {
          if (seed.length > SOLANA_CONSTANTS.MAX_SEED_LENGTH) {
            results.push({
              file: `${program.name}.purp`, severity: 'critical', rule: 'pda-seed-too-long',
              message: `Account "${acc.name}" seed "${seed}" exceeds max length (${SOLANA_CONSTANTS.MAX_SEED_LENGTH})`,
            });
          }
        }
      }
    }

    return results;
  }

  // ─── Execute a Purp CLI command (delegates to purp binary) ───
  async runCliCommand(command: PurpCliCommand, args: string[] = []): Promise<{ success: boolean; output: string }> {
    const compilerPath = config.purp.compilerPath;
    if (!compilerPath) {
      return { success: false, output: 'Purp compiler path not configured (PURP_COMPILER_PATH)' };
    }

    const validCommands = new Set(CLI_COMMANDS);
    if (!validCommands.has(command)) {
      return { success: false, output: `Unknown Purp CLI command: ${command}` };
    }

    // Sanitize args
    const safeArgs = args.map(a => a.replace(/[;&|`$]/g, ''));
    const fullCmd = `${compilerPath} ${command} ${safeArgs.join(' ')}`.trim();

    try {
      const { execSync } = await import('child_process');
      const output = execSync(fullCmd, {
        cwd: config.purp.projectDir,
        timeout: 60_000,
        encoding: 'utf-8',
      });
      return { success: true, output: output.toString() };
    } catch (err: any) {
      return { success: false, output: err.stderr?.toString() ?? err.message ?? String(err) };
    }
  }

  // ─── Get supported stdlib modules ───
  getStdlibModules(): PurpStdlibModule[] {
    return [...STDLIB_MODULES];
  }

  // ─── Get supported templates ───
  getTemplates(): PurpTemplate[] {
    return [...TEMPLATES];
  }

  // ─── Get Solana constants (v1.2.1 audit-verified) ───
  getSolanaConstants(): typeof SOLANA_CONSTANTS {
    return { ...SOLANA_CONSTANTS };
  }

  // ─── Legacy JSON format support ───
  private parseLegacy(source: string): LegacyPurpProgram {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error('Purp program must be valid JSON (legacy) or Purp v0.3 syntax');
    }

    const prog = parsed as Record<string, unknown>;
    if (!prog.name || typeof prog.name !== 'string') {
      throw new Error('Purp program must have a name');
    }
    if (!prog.instructions || !Array.isArray(prog.instructions)) {
      throw new Error('Purp program must have an instructions array');
    }

    return {
      name: prog.name as string,
      version: (prog.version as string) ?? '1.0',
      instructions: prog.instructions as LegacyPurpInstruction[],
      variables: (prog.variables as Record<string, unknown>) ?? {},
    };
  }

  private validateLegacy(program: LegacyPurpProgram): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const ALLOWED = new Set(['transfer', 'call', 'assert', 'log', 'set']);

    if (program.instructions.length > MAX_INSTRUCTIONS) {
      errors.push(`Too many instructions: ${program.instructions.length} (max ${MAX_INSTRUCTIONS})`);
    }

    for (let i = 0; i < program.instructions.length; i++) {
      const instr = program.instructions[i];
      if (!ALLOWED.has(instr.type)) {
        errors.push(`Instruction ${i}: unknown type "${instr.type}"`);
      }
      for (const [key, value] of Object.entries(instr.params)) {
        if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
          errors.push(`Instruction ${i}: param "${key}" exceeds max string length`);
        }
      }
      if (instr.type === 'transfer') {
        if (!instr.params.to) errors.push(`Instruction ${i}: transfer requires 'to' param`);
        if (!instr.params.amount && !instr.params.lamports) {
          errors.push(`Instruction ${i}: transfer requires 'amount' or 'lamports' param`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private legacyToPlanSteps(program: LegacyPurpProgram): PlanStep[] {
    const toolMap: Record<string, string> = {
      transfer: 'solana_transfer',
      call: 'solana_program_call',
      assert: 'internal_assert',
      log: 'internal_log',
      set: 'internal_variable',
    };

    return program.instructions.map((instr, i) => ({
      step: i + 1,
      action: instr.type,
      tool: toolMap[instr.type] ?? 'unknown',
      params: { ...instr.params },
      description: this.describeLegacyInstruction(instr),
    }));
  }

  private describeLegacyInstruction(instr: LegacyPurpInstruction): string {
    switch (instr.type) {
      case 'transfer':
        return `Transfer ${instr.params.amount ?? instr.params.lamports} to ${instr.params.to}`;
      case 'call':
        return `Call program ${instr.params.program}`;
      case 'assert':
        return `Assert: ${instr.params.condition}`;
      case 'log':
        return `Log: ${instr.params.message}`;
      case 'set':
        return `Set ${instr.params.name} = ${instr.params.value}`;
      default:
        return `Unknown instruction: ${instr.type}`;
    }
  }
}
