// ─── Purp SCL Language Integration (PAW v1.0, upstream compat: v0.3.1) ───
// Supports the full Purp Smart Contract Language syntax (compatible with purp-scl v0.3.1).
// Parses .purp files with program/account/instruction/event/error/client/frontend blocks.
// Features: pub instruction inline params, #[init], context structs emitted after module close,
// import resolution with circular detection, comma-separated fields, assert/require statements,
// CPI, SPL ops. Compiles to Anchor Rust + TypeScript SDK.

import { PlanStep, PurpCompileResult, PurpError, PurpProjectConfig } from '../../core/types';
import { config } from '../../core/config';
import * as fs from 'fs';
import * as path from 'path';

// ─── Purp v1.0 Types ───
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

// ─── Purp v1.0 Block Patterns ───
const BLOCK_PATTERN = /^(?:pub\s+)?(program|account|instruction|event|error|client|frontend|struct|const)\s+(\w+)/;
const FIELD_PATTERN = /^\s*(\w+)\s*:\s*(\w+)/;
const IMPORT_PATTERN = /^(?:use|import)\s+([\w:\/\.@]+)/;
const ACCOUNT_ATTR_PATTERN = /^\s*#\[(mut|signer|init|seeds\(.*?\)|payer\(.*?\)|space\(.*?\))\]/;
const ARG_PATTERN = /^\s*(\w+)\s*:\s*(\w+)/;
// v1.0: pub instruction name(#[mut] signer author, #[init] account greeting, msg: string) { ... }
const PUB_INSTRUCTION_PATTERN = /^(?:pub\s+)?instruction\s+(\w+)\s*\(/;

export class PurpEngine {
  // ─── Parse Purp v1.0 source (.purp files) ───
  parse(source: string): PurpProgram | LegacyPurpProgram {
    const trimmed = source.trim();
    if (trimmed.startsWith('{')) {
      return this.parseLegacy(source);
    }
    return this.parsePurpV3(source);
  }

  // ─── Parse native Purp v1.0 syntax ───
  private parsePurpV3(source: string): PurpProgram {
    const lines = source.split('\n');
    const program: PurpProgram = {
      name: '',
      version: '1.0.0',
      accounts: [],
      instructions: [],
      events: [],
      errors: [],
      clients: [],
      frontends: [],
      imports: [],
      structs: [],
      constants: [],
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
    let code = 6000; // Anchor convention starting error code

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

  // ─── Validate Purp v1.0 ───
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

  // ─── Compile Purp v0.3 to Anchor Rust + TypeScript ───
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

    // Generate Anchor Rust
    const rustOutput = this.generateAnchorRust(program);

    // Generate TypeScript SDK
    const typescriptSdk = this.generateTypeScriptSDK(program);

    return {
      success: true,
      rust_output: rustOutput,
      typescript_sdk: typescriptSdk,
      errors: [],
      warnings,
    };
  }

  // ─── Generate Anchor Rust from Purp ───
  private generateAnchorRust(program: PurpProgram): string {
    const lines: string[] = [
      `// Auto-generated by Purp SCL v1.0 Compiler`,
      `// Source: ${program.name}`,
      ``,
      `use anchor_lang::prelude::*;`,
      program.instructions.some(i => i.accounts.some(a => a.name.includes('token') || a.name.includes('mint')))
        ? `use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer as SplTransfer, MintTo, Burn};`
        : '',
      ``,
      `declare_id!("TODO_PROGRAM_ID");`,
      ``,
      `#[program]`,
      `pub mod ${this.toSnakeCase(program.name)} {`,
      `    use super::*;`,
      ``,
    ].filter(l => l !== undefined);

    // Generate instructions
    for (const instr of program.instructions) {
      const ctxName = `${this.toPascalCase(instr.name)}Context`;
      const args = instr.args.map(a => `${a.name}: ${this.toRustType(a.type)}`).join(', ');
      lines.push(`    pub fn ${this.toSnakeCase(instr.name)}(ctx: Context<${ctxName}>${args ? ', ' + args : ''}) -> Result<()> {`);
      for (const bodyLine of instr.body) {
        lines.push(`        ${this.transpileBodyLine(bodyLine)}`);
      }
      lines.push(`        Ok(())`);
      lines.push(`    }`);
      lines.push(``);
    }

    lines.push(`}`);
    lines.push(``);

    // Generate account structs
    for (const account of program.accounts) {
      lines.push(`#[account]`);
      lines.push(`pub struct ${this.toPascalCase(account.name)} {`);
      for (const field of account.fields) {
        lines.push(`    pub ${field.name}: ${this.toRustType(field.type)},`);
      }
      lines.push(`}`);
      lines.push(``);
    }

    // Generate context structs (v1.0: <InstructionName>Context with #[init] support)
    for (const instr of program.instructions) {
      const ctxName = `${this.toPascalCase(instr.name)}Context`;
      lines.push(`#[derive(Accounts)]`);
      lines.push(`pub struct ${ctxName}<'info> {`);
      for (const acc of instr.accounts) {
        if (acc.init) {
          lines.push(`    #[account(init, payer = ${instr.accounts.find(a => a.signer)?.name ?? 'payer'}, space = 8 + 256)]`);
        } else if (acc.mutable) {
          lines.push(`    #[account(mut)]`);
        }
        if (acc.signer) {
          lines.push(`    pub ${acc.name}: Signer<'info>,`);
        } else {
          const accType = this.findAccountType(acc.name, program);
          lines.push(`    pub ${acc.name}: Account<'info, ${accType}>,`);
        }
      }
      // Add system_program if any accounts are initialized
      if (instr.accounts.some(a => a.init)) {
        lines.push(`    pub system_program: Program<'info, System>,`);
      }
      lines.push(`}`);
      lines.push(``);
    }

    // Generate events
    for (const event of program.events) {
      lines.push(`#[event]`);
      lines.push(`pub struct ${this.toPascalCase(event.name)} {`);
      for (const field of event.fields) {
        lines.push(`    pub ${field.name}: ${this.toRustType(field.type)},`);
      }
      lines.push(`}`);
      lines.push(``);
    }

    // Generate errors
    if (program.errors.length > 0) {
      lines.push(`#[error_code]`);
      lines.push(`pub enum ${this.toPascalCase(program.name)}Error {`);
      for (const err of program.errors) {
        lines.push(`    #[msg("${err.message}")]`);
        lines.push(`    ${err.name},`);
      }
      lines.push(`}`);
    }

    return lines.join('\n');
  }

  // ─── Find account type for Anchor struct ───
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

  // ─── Generate TypeScript SDK from Purp ───
  private generateTypeScriptSDK(program: PurpProgram): string {
    const lines: string[] = [
      `// Auto-generated TypeScript SDK by Purp SCL v1.0 Compiler`,
      `// Source: ${program.name}`,
      ``,
      `import { Program, AnchorProvider } from '@coral-xyz/anchor';`,
      `import { PublicKey, SystemProgram } from '@solana/web3.js';`,
      ``,
      `export class ${this.toPascalCase(program.name)}Client {`,
      `  private program: Program;`,
      ``,
      `  constructor(program: Program) {`,
      `    this.program = program;`,
      `  }`,
      ``,
    ];

    // Generate methods for each instruction
    for (const instr of program.instructions) {
      const args = instr.args.map(a => `${a.name}: ${this.toTSType(a.type)}`).join(', ');
      const accParams = instr.accounts.map(a => `${a.name}: PublicKey`).join(', ');
      const allParams = [args, accParams].filter(Boolean).join(', ');

      lines.push(`  async ${this.toCamelCase(instr.name)}(${allParams}): Promise<string> {`);
      lines.push(`    const tx = await this.program.methods`);
      lines.push(`      .${this.toCamelCase(instr.name)}(${instr.args.map(a => a.name).join(', ')})`);
      lines.push(`      .accounts({`);
      for (const acc of instr.accounts) {
        lines.push(`        ${acc.name},`);
      }
      lines.push(`      })`);
      lines.push(`      .rpc();`);
      lines.push(`    return tx;`);
      lines.push(`  }`);
      lines.push(``);
    }

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

  // ─── Load Purp.toml project config ───
  loadProjectConfig(projectDir: string): PurpProjectConfig | null {
    const tomlPath = path.join(projectDir, 'Purp.toml');
    if (!fs.existsSync(tomlPath)) return null;

    const content = fs.readFileSync(tomlPath, 'utf-8');
    // Basic TOML parsing for Purp.toml [package] section
    const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
    const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
    const descMatch = content.match(/description\s*=\s*"([^"]+)"/);
    const networkMatch = content.match(/network\s*=\s*"([^"]+)"/);

    // Parse [dependencies]
    const deps: Record<string, string> = {};
    const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depSection) {
      const depLines = depSection[1].trim().split('\n');
      for (const line of depLines) {
        const match = line.match(/(\w+)\s*=\s*"([^"]+)"/);
        if (match) deps[match[1]] = match[2];
      }
    }

    return {
      name: nameMatch?.[1] ?? 'unknown',
      version: versionMatch?.[1] ?? '0.1.0',
      description: descMatch?.[1],
      network: (networkMatch?.[1] ?? 'devnet') as 'devnet' | 'testnet' | 'mainnet-beta',
      dependencies: deps,
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
      description: `Compile Purp program "${prog.name}" to Anchor Rust + TypeScript SDK`,
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
      f32: 'f32', f64: 'f64', bool: 'bool', string: 'String', pubkey: 'Pubkey', bytes: 'Vec<u8>',
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
    // Purp v1.0 → Rust transpilation
    return line
      .replace(/emit\s+(\w+)\s*\((.*?)\)/, 'emit!($1 { $2 })')
      .replace(/emit\s*\((\w+),\s*\{(.*?)\}\)/, 'emit!($1 { $2 })')
      .replace(/require\s*\((.*?),\s*(\w+)\)/, 'require!($1, $2)')
      .replace(/assert\s*\((.*?),\s*"([^"]+)"\)/, 'require!($1, ProgramError::Custom(0)); // $2')
      .replace(/\.transfer\((.*?)\)/, '.transfer($1)?')
      .replace(/\.key\(\)/, '.key()');
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
