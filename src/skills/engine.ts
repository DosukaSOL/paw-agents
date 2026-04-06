// ─── Skill Engine — Parse, Validate, Register skill.md ───
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { SkillDefinition, SkillMetadata, SkillSafety } from '../core/types';

const REQUIRED_METADATA_FIELDS: (keyof SkillMetadata)[] = ['name', 'version', 'author', 'description', 'category', 'tags'];
const REQUIRED_TOP_LEVEL = ['metadata', 'capability', 'input_schema', 'output_schema', 'execution', 'safety', 'permissions'];

export interface SkillValidationError {
  field: string;
  message: string;
}

export class SkillEngine {
  private skills = new Map<string, SkillDefinition>();
  private skillsDir: string;

  constructor(skillsDir: string = path.join(process.cwd(), 'skills')) {
    this.skillsDir = skillsDir;
  }

  // ─── Load all skills from directory ───
  loadAll(): { loaded: string[]; errors: Array<{ file: string; errors: SkillValidationError[] }> } {
    const loaded: string[] = [];
    const errors: Array<{ file: string; errors: SkillValidationError[] }> = [];

    if (!fs.existsSync(this.skillsDir)) {
      return { loaded, errors };
    }

    const files = fs.readdirSync(this.skillsDir, { recursive: true })
      .map(f => f.toString())
      .filter(f => f.endsWith('.skill.md') || f.endsWith('.skill.yaml') || f.endsWith('.skill.yml'));

    for (const file of files) {
      const fullPath = path.join(this.skillsDir, file);
      const result = this.loadSkill(fullPath);
      if (result.errors.length > 0) {
        errors.push({ file, errors: result.errors });
      } else if (result.skill) {
        loaded.push(result.skill.metadata.name);
      }
    }

    return { loaded, errors };
  }

  // ─── Parse and validate a single skill ───
  loadSkill(filePath: string): { skill: SkillDefinition | null; errors: SkillValidationError[] } {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      let parsed: unknown;

      if (filePath.endsWith('.skill.md')) {
        parsed = this.parseSkillMd(content);
      } else {
        parsed = parseYaml(content);
      }

      const errors = this.validate(parsed);
      if (errors.length > 0) {
        return { skill: null, errors };
      }

      const skill = parsed as SkillDefinition;

      // Enforce safety constraints
      const safetyErrors = this.enforceSafety(skill);
      if (safetyErrors.length > 0) {
        return { skill: null, errors: safetyErrors };
      }

      this.skills.set(skill.metadata.name, skill);
      return { skill, errors: [] };
    } catch (err) {
      return {
        skill: null,
        errors: [{ field: 'file', message: `Parse error: ${(err as Error).message}` }],
      };
    }
  }

  // ─── Parse skill.md format ───
  private parseSkillMd(content: string): unknown {
    // Extract YAML frontmatter between --- markers
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      throw new Error('skill.md must contain YAML frontmatter between --- markers');
    }
    return parseYaml(frontmatterMatch[1]);
  }

  // ─── Schema validation ───
  private validate(data: unknown): SkillValidationError[] {
    const errors: SkillValidationError[] = [];

    if (!data || typeof data !== 'object') {
      errors.push({ field: 'root', message: 'Skill definition must be an object' });
      return errors;
    }

    const obj = data as Record<string, unknown>;

    // Check top-level fields
    for (const field of REQUIRED_TOP_LEVEL) {
      if (!(field in obj)) {
        errors.push({ field, message: `Missing required field: ${field}` });
      }
    }

    // Check metadata
    if (obj.metadata && typeof obj.metadata === 'object') {
      const meta = obj.metadata as Record<string, unknown>;
      for (const field of REQUIRED_METADATA_FIELDS) {
        if (!(field in meta) || !meta[field]) {
          errors.push({ field: `metadata.${field}`, message: `Missing required metadata field: ${field}` });
        }
      }
      if (meta.tags && !Array.isArray(meta.tags)) {
        errors.push({ field: 'metadata.tags', message: 'tags must be an array' });
      }
    }

    // Validate execution type
    if (obj.execution && typeof obj.execution === 'object') {
      const exec = obj.execution as Record<string, unknown>;
      if (exec.execution_type && !['purp', 'js', 'api', 'system'].includes(exec.execution_type as string)) {
        errors.push({ field: 'execution.execution_type', message: 'execution_type must be purp, js, api, or system' });
      }
    }

    // Validate input schema
    if (obj.input_schema && Array.isArray(obj.input_schema)) {
      for (let i = 0; i < obj.input_schema.length; i++) {
        const input = obj.input_schema[i] as Record<string, unknown>;
        if (!input.name) errors.push({ field: `input_schema[${i}].name`, message: 'Input field must have a name' });
        if (!input.type) errors.push({ field: `input_schema[${i}].type`, message: 'Input field must have a type' });
      }
    }

    return errors;
  }

  // ─── Safety enforcement ───
  private enforceSafety(skill: SkillDefinition): SkillValidationError[] {
    const errors: SkillValidationError[] = [];
    const safety = skill.safety;

    if (!safety) return errors;

    // Rate limit must be reasonable
    if (safety.rate_limit_per_minute > 100) {
      errors.push({ field: 'safety.rate_limit_per_minute', message: 'Rate limit cannot exceed 100/min' });
    }

    // Max transaction size check
    if (safety.max_transaction_lamports && safety.max_transaction_lamports > 10_000_000_000) {
      errors.push({ field: 'safety.max_transaction_lamports', message: 'Max transaction cannot exceed 10 SOL' });
    }

    // Forbidden actions must not be overridden
    const globalForbidden = ['upgrade_program', 'close_account_owner_override'];
    for (const forbidden of globalForbidden) {
      if (skill.permissions?.allowed_actions?.includes(forbidden)) {
        errors.push({ field: 'permissions.allowed_actions', message: `Cannot allow globally forbidden action: ${forbidden}` });
      }
    }

    return errors;
  }

  // ─── Getters ───
  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  getSkillNames(): string[] {
    return Array.from(this.skills.keys());
  }

  // ─── Find relevant skills for an intent ───
  findSkillsForIntent(intent: string): SkillDefinition[] {
    const lower = intent.toLowerCase();
    return this.getAllSkills().filter(skill => {
      const searchable = [
        skill.metadata.name,
        skill.metadata.description,
        skill.metadata.category,
        ...skill.metadata.tags,
        ...skill.capability.actions,
      ].join(' ').toLowerCase();
      return lower.split(/\s+/).some(word => searchable.includes(word));
    });
  }
}
