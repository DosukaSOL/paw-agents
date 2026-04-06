// ─── PAW Agents Core Types ───
// Every type in the system flows through these definitions.

export type ExecutionMode = 'purp' | 'js' | 'api' | 'system';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type PlanStatus = 'pending' | 'validated' | 'rejected' | 'executing' | 'completed' | 'failed' | 'rolled_back';
export type AgentPhase = 'intake' | 'planning' | 'validation' | 'confirmation' | 'execution' | 'verification' | 'logging' | 'response';
export type ChannelType = 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'webchat' | 'api' | 'email' | 'sms' | 'line' | 'reddit' | 'matrix';
export type AgentMode = 'autonomous' | 'supervised' | 'free';
export type MemoryScope = 'session' | 'user' | 'global';

// ─── Agent Brain Output ───

export interface AgentPlan {
  id: string;
  intent: string;
  plan: PlanStep[];
  tools: string[];
  risks: RiskAssessment[];
  requires_confirmation: boolean;
  execution_mode: ExecutionMode;
  purp_program?: string;
  metadata: PlanMetadata;
}

export interface PlanStep {
  step: number;
  action: string;
  tool: string;
  params: Record<string, unknown>;
  description: string;
  rollback?: RollbackAction;
}

export interface RollbackAction {
  action: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface RiskAssessment {
  category: string;
  level: RiskLevel;
  description: string;
  mitigation: string;
}

export interface PlanMetadata {
  model_used: string;
  skills_loaded: string[];
  generation_time_ms: number;
  timestamp: string;
}

// ─── Validation ───

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  risk_score: number;
  requires_confirmation: boolean;
  simulation_result?: SimulationResult;
}

export interface ValidationError {
  code: string;
  field: string;
  message: string;
  severity: 'error' | 'fatal';
}

export interface ValidationWarning {
  code: string;
  field: string;
  message: string;
}

export interface SimulationResult {
  success: boolean;
  estimated_fee_lamports: number;
  logs: string[];
  error?: string;
}

// ─── Execution ───

export interface ExecutionResult {
  success: boolean;
  plan_id: string;
  steps_completed: StepResult[];
  final_output: unknown;
  error?: ExecutionError;
  duration_ms: number;
}

export interface StepResult {
  step: number;
  success: boolean;
  output: unknown;
  duration_ms: number;
  error?: string;
}

export interface ExecutionError {
  code: string;
  message: string;
  step?: number;
  recoverable: boolean;
  recovery_attempted: boolean;
  recovery_result?: string;
}

// ─── Skill Definition ───

export interface SkillDefinition {
  metadata: SkillMetadata;
  capability: SkillCapability;
  input_schema: SkillInputField[];
  output_schema: SkillOutputSchema;
  execution: SkillExecution;
  tools: SkillTools;
  safety: SkillSafety;
  validation: SkillValidation;
  failure_modes: SkillFailureMode[];
  permissions: SkillPermissions;
  examples: SkillExample[];
}

export interface SkillMetadata {
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  tags: string[];
}

export interface SkillCapability {
  purpose: string;
  actions: string[];
}

export interface SkillInputField {
  name: string;
  type: string;
  required: boolean;
  validation?: string;
  default?: unknown;
  description: string;
}

export interface SkillOutputSchema {
  structure: Record<string, unknown>;
  types: Record<string, string>;
  guarantees: string[];
}

export interface SkillExecution {
  execution_type: ExecutionMode;
  entrypoint: string;
  runtime_requirements: string[];
  dependencies: string[];
}

export interface SkillTools {
  apis: string[];
  contracts: string[];
  permissions_required: string[];
}

export interface SkillSafety {
  max_transaction_lamports?: number;
  allowed_contracts: string[];
  forbidden_actions: string[];
  rate_limit_per_minute: number;
}

export interface SkillValidation {
  preconditions: string[];
  postconditions: string[];
}

export interface SkillFailureMode {
  risk: string;
  fallback: string;
}

export interface SkillPermissions {
  allowed_actions: string[];
  forbidden_actions: string[];
}

export interface SkillExample {
  description: string;
  input: Record<string, unknown>;
  expected_output: Record<string, unknown>;
}

// ─── Clawtrace ───

export interface ClawtraceEntry {
  trace_id: string;
  session_id: string;
  timestamp: string;
  phase: AgentPhase;
  input?: unknown;
  reasoning?: string;
  plan?: AgentPlan;
  validation?: ValidationResult;
  execution?: ExecutionResult;
  output?: unknown;
  error?: string;
  duration_ms: number;
  metadata: Record<string, unknown>;
}

// ─── Model Router ───

export interface ModelProvider {
  name: string;
  model: string;
  generate(system: string, prompt: string): Promise<string>;
  available(): Promise<boolean>;
}

export interface ModelConfig {
  provider: string;
  model: string;
  api_key: string;
  max_tokens?: number;
  temperature?: number;
}

// ─── Security ───

export interface SecurityPolicy {
  max_transaction_lamports: number;
  require_confirmation_above_lamports: number;
  rate_limit_per_minute: number;
  allowed_programs: string[];
  forbidden_instructions: string[];
  max_plan_steps: number;
  sandbox_enabled: boolean;
}

// ─── User / Session ───

export interface UserSession {
  user_id: string;
  chat_id: number;
  session_id: string;
  channel: ChannelType;
  agent_mode: AgentMode;
  created_at: string;
  last_activity: string;
  message_count: number;
  rate_limit_remaining: number;
  context: SessionContext;
}

export interface SessionContext {
  history: ConversationMessage[];
  memory: MemoryEntry[];
  active_skills: string[];
  variables: Record<string, unknown>;
}

export interface ConversationMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  plan_id?: string;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  scope: MemoryScope;
  created_at: string;
  ttl_ms?: number;
}

// ─── Gateway ───

export interface GatewayConfig {
  port: number;
  host: string;
  auth_token?: string;
  cors_origins: string[];
}

export interface GatewayClient {
  id: string;
  channel: ChannelType;
  connected_at: string;
  user_id?: string;
  session_id: string;
}

export interface GatewayMessage {
  type: 'message' | 'command' | 'event' | 'response';
  channel: ChannelType;
  from: string;
  payload: unknown;
  timestamp: string;
}

// ─── Channel Interface ───

export interface ChannelAdapter {
  name: ChannelType;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(userId: string, message: string): Promise<void>;
  onMessage(handler: (userId: string, message: string, channel: ChannelType) => Promise<void>): void;
}

// ─── Cron / Automation ───

export interface CronTask {
  id: string;
  name: string;
  schedule: string;
  action: string;
  params: Record<string, unknown>;
  enabled: boolean;
  last_run?: string;
  next_run?: string;
  created_by: string;
}

export interface WebhookConfig {
  id: string;
  path: string;
  secret?: string;
  action: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

// ─── Multi-Agent ───

export interface AgentSession {
  agent_id: string;
  session_id: string;
  name: string;
  status: 'active' | 'idle' | 'terminated';
  created_at: string;
  last_message_at: string;
  message_count: number;
}

export interface AgentToAgentMessage {
  from_agent: string;
  to_agent: string;
  message: string;
  reply_to?: string;
  timestamp: string;
}

// ─── Purp v0.3 ───

export interface PurpCompileResult {
  success: boolean;
  rust_output?: string;
  typescript_sdk?: string;
  idl?: string;
  errors: PurpError[];
  warnings: string[];
  source_map?: Record<number, number>;
}

export interface PurpError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export interface PurpProjectConfig {
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies: Record<string, string>;
  network: 'devnet' | 'testnet' | 'mainnet-beta';
}
