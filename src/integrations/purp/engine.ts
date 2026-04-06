// ─── Purp Language Integration ───
// Compile, validate, and sandbox-execute Purp programs.
// Maps Purp actions to Solana instructions.

import { PlanStep } from '../../core/types';

// ─── Purp AST Types ───
interface PurpInstruction {
  type: 'transfer' | 'call' | 'assert' | 'log' | 'set';
  params: Record<string, unknown>;
}

interface PurpProgram {
  name: string;
  version: string;
  instructions: PurpInstruction[];
  variables: Record<string, unknown>;
}

// ─── Purp Sandbox ───
const ALLOWED_INSTRUCTION_TYPES = new Set(['transfer', 'call', 'assert', 'log', 'set']);
const MAX_INSTRUCTIONS = 50;
const MAX_VARIABLE_COUNT = 20;
const MAX_STRING_LENGTH = 256;

export class PurpEngine {
  // ─── Parse Purp source to AST ───
  parse(source: string): PurpProgram {
    // Purp programs are defined as structured YAML/JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error('Purp program must be valid JSON');
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
      instructions: prog.instructions as PurpInstruction[],
      variables: (prog.variables as Record<string, unknown>) ?? {},
    };
  }

  // ─── Validate Purp program ───
  validate(program: PurpProgram): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Instruction count limit
    if (program.instructions.length > MAX_INSTRUCTIONS) {
      errors.push(`Too many instructions: ${program.instructions.length} (max ${MAX_INSTRUCTIONS})`);
    }

    // Variable count limit
    if (Object.keys(program.variables).length > MAX_VARIABLE_COUNT) {
      errors.push(`Too many variables: ${Object.keys(program.variables).length} (max ${MAX_VARIABLE_COUNT})`);
    }

    // Validate each instruction
    for (let i = 0; i < program.instructions.length; i++) {
      const instr = program.instructions[i];

      if (!ALLOWED_INSTRUCTION_TYPES.has(instr.type)) {
        errors.push(`Instruction ${i}: unknown type "${instr.type}"`);
      }

      // Validate string lengths to prevent abuse
      for (const [key, value] of Object.entries(instr.params)) {
        if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
          errors.push(`Instruction ${i}: param "${key}" exceeds max string length`);
        }
      }

      // Transfer-specific validation
      if (instr.type === 'transfer') {
        if (!instr.params.to) errors.push(`Instruction ${i}: transfer requires 'to' param`);
        if (!instr.params.amount && !instr.params.lamports) {
          errors.push(`Instruction ${i}: transfer requires 'amount' or 'lamports' param`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ─── Convert Purp program to plan steps ───
  toPlanSteps(program: PurpProgram): PlanStep[] {
    return program.instructions.map((instr, i) => ({
      step: i + 1,
      action: instr.type,
      tool: this.mapInstructionToTool(instr.type),
      params: { ...instr.params },
      description: this.describeInstruction(instr),
    }));
  }

  // ─── Map instruction type to tool ───
  private mapInstructionToTool(type: string): string {
    switch (type) {
      case 'transfer': return 'solana_transfer';
      case 'call': return 'solana_program_call';
      case 'assert': return 'internal_assert';
      case 'log': return 'internal_log';
      case 'set': return 'internal_variable';
      default: return 'unknown';
    }
  }

  // ─── Human-readable description ───
  private describeInstruction(instr: PurpInstruction): string {
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
