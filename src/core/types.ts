// ─── PAW Agents Core Types ───
// Every type in the system flows through these definitions.

export type ExecutionMode = 'purp' | 'js' | 'api' | 'system';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type PlanStatus = 'pending' | 'validated' | 'rejected' | 'executing' | 'completed' | 'failed' | 'rolled_back';
export type AgentPhase = 'intake' | 'planning' | 'validation' | 'confirmation' | 'execution' | 'verification' | 'logging' | 'response';
export type ChannelType = 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'webchat' | 'api' | 'email' | 'sms' | 'line' | 'reddit' | 'matrix' | 'desktop' | 'hub' | 'mission-control' | 'voice' | 'twitter' | 'github' | 'notion' | 'calendar' | 'rest' | 'mqtt' | 'rss';
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

// ─── Trace Logger ───

export interface TraceEntry {
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
  type: 'message' | 'command' | 'event' | 'response' | 'stream';
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

// ─── Intelligence & Memory ───

export interface UserProfile {
  user_id: string;
  preferences: UserPreferences;
  behavior_patterns: BehaviorPattern[];
  skill_usage: Record<string, number>;
  model_preferences: Record<string, string>;
  interaction_count: number;
  first_seen: string;
  last_seen: string;
  avg_risk_tolerance: number;
  topics_of_interest: string[];
}

export interface UserPreferences {
  preferred_language: string;
  verbosity: 'concise' | 'normal' | 'detailed';
  confirmation_style: 'minimal' | 'detailed';
  timezone?: string;
  custom: Record<string, unknown>;
}

export interface BehaviorPattern {
  pattern_type: string;
  frequency: number;
  last_observed: string;
  confidence: number;
}

export interface RAGDocument {
  id: string;
  source: string;
  content: string;
  chunk_count: number;
  metadata: Record<string, unknown>;
  indexed_at: string;
}

export interface RAGChunk {
  id: string;
  document_id: string;
  content: string;
  embedding: number[];
  position: number;
  metadata: Record<string, unknown>;
}

export interface RAGSearchResult {
  chunk: RAGChunk;
  score: number;
  document_source: string;
}

export type TaskType = 'code' | 'math' | 'creative' | 'analysis' | 'simple_qa' | 'complex_reasoning' | 'blockchain' | 'data_processing';

export interface TaskClassification {
  task_type: TaskType;
  confidence: number;
  complexity: 'simple' | 'moderate' | 'complex';
  recommended_model: string;
  recommended_provider: string;
}

export interface ConversationBranch {
  branch_id: string;
  parent_branch_id?: string;
  branch_point_index: number;
  messages: ConversationMessage[];
  created_at: string;
  label?: string;
  is_active: boolean;
}

export interface ConversationTree {
  user_id: string;
  root_branch_id: string;
  branches: Record<string, ConversationBranch>;
  active_branch_id: string;
}

export interface ModelPerformanceRecord {
  provider: string;
  model: string;
  task_type: TaskType;
  latency_ms: number;
  success: boolean;
  quality_score: number;
  timestamp: string;
}

// ─── Composable DeFi ───

export type DeFiProtocol = 'jupiter' | 'raydium' | 'orca' | 'marinade' | 'drift';
export type DeFiAction = 'swap' | 'add_liquidity' | 'remove_liquidity' | 'stake' | 'unstake';

export interface DeFiQuote {
  protocol: DeFiProtocol;
  input_mint: string;
  output_mint: string;
  input_amount: number;
  output_amount: number;
  price_impact_pct: number;
  fee_amount: number;
  fee_mint: string;
  route_plan: DeFiRouteLeg[];
  expires_at: number;
}

export interface DeFiRouteLeg {
  protocol: DeFiProtocol;
  pool: string;
  input_mint: string;
  output_mint: string;
  input_amount: number;
  output_amount: number;
  fee_pct: number;
}

export interface DeFiSwapParams {
  input_mint: string;
  output_mint: string;
  amount: number;
  slippage_bps: number;
  max_accounts?: number;
  only_direct_routes?: boolean;
  user_wallet: string;
}

export interface DeFiSwapResult {
  success: boolean;
  signature?: string;
  input_amount: number;
  output_amount: number;
  price_impact_pct: number;
  fee_lamports: number;
  route_used: DeFiRouteLeg[];
  simulation: DeFiSimulationResult;
  error?: string;
}

export interface DeFiSimulationResult {
  passed: boolean;
  estimated_output: number;
  minimum_output: number;
  price_impact_pct: number;
  fee_estimate: number;
  slippage_check: boolean;
  balance_sufficient: boolean;
  warnings: string[];
  error?: string;
}

export interface DeFiPositionInfo {
  protocol: DeFiProtocol;
  position_type: 'liquidity' | 'stake' | 'lending';
  pool_address: string;
  token_a_mint: string;
  token_b_mint?: string;
  token_a_amount: number;
  token_b_amount?: number;
  value_usd_estimate: number;
  apy_estimate?: number;
  opened_at?: string;
}

export interface DeFiSafetyConfig {
  max_slippage_bps: number;
  max_price_impact_pct: number;
  max_swap_lamports: number;
  allowed_protocols: DeFiProtocol[];
  blocked_mints: string[];
  require_simulation: boolean;
  max_route_legs: number;
  min_output_ratio: number;
}

// ─── v3.4 — Platform & Scale ───

// Multi-Tenant
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: 'free' | 'pro' | 'enterprise';
  config: TenantConfig;
  created_at: string;
  active: boolean;
}

export interface TenantConfig {
  max_users: number;
  max_agents: number;
  allowed_channels: ChannelType[];
  allowed_providers: string[];
  rate_limit_per_minute: number;
  custom_branding?: { logo_url?: string; accent_color?: string; name?: string };
}

export interface TenantUser {
  user_id: string;
  tenant_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joined_at: string;
  permissions: string[];
}

// Plugin Marketplace
export interface Plugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: PluginCategory;
  entry_point: string;
  permissions: string[];
  config_schema: Record<string, unknown>;
  installed: boolean;
  enabled: boolean;
  marketplace_url?: string;
  rating?: number;
  downloads?: number;
}

export type PluginCategory = 'channel' | 'skill' | 'model' | 'defi' | 'analytics' | 'security' | 'integration' | 'utility';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  paw_version: string;
  author: string;
  description: string;
  category: PluginCategory;
  entry_point: string;
  permissions: string[];
  config_schema: Record<string, unknown>;
  hooks: PluginHook[];
}

export interface PluginHook {
  event: 'before_plan' | 'after_plan' | 'before_execute' | 'after_execute' | 'on_message' | 'on_error';
  handler: string;
  priority: number;
}

export interface PluginInstance {
  manifest: PluginManifest;
  config: Record<string, unknown>;
  state: 'loaded' | 'active' | 'error' | 'disabled';
  error?: string;
}

// Workflow Templates
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: WorkflowStep[];
  variables: WorkflowVariable[];
  triggers: WorkflowTrigger[];
  author: string;
  version: string;
  public: boolean;
  uses: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'skill' | 'condition' | 'loop' | 'delay' | 'webhook' | 'agent_call';
  config: Record<string, unknown>;
  on_success?: string;
  on_failure?: string;
  timeout_ms?: number;
}

export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  default_value?: unknown;
  required: boolean;
  description: string;
}

export interface WorkflowTrigger {
  type: 'manual' | 'cron' | 'webhook' | 'event' | 'message_pattern';
  config: Record<string, unknown>;
}

export interface WorkflowExecution {
  id: string;
  template_id: string;
  tenant_id?: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  current_step: string;
  variables: Record<string, unknown>;
  started_at: string;
  completed_at?: string;
  error?: string;
  step_results: Record<string, unknown>;
}

// OAuth2 / SSO
export interface OAuth2Config {
  enabled: boolean;
  client_id: string;
  client_secret: string;
  issuer_url: string;
  redirect_uri: string;
  scopes: string[];
}

export interface AuthSession {
  session_id: string;
  user_id: string;
  tenant_id?: string;
  access_token: string;
  refresh_token?: string;
  expires_at: string;
  scopes: string[];
  provider: 'local' | 'oauth2' | 'sso';
}

// Horizontal Scaling
export interface NodeInfo {
  node_id: string;
  host: string;
  port: number;
  status: 'active' | 'draining' | 'offline';
  load: number;
  connected_clients: number;
  last_heartbeat: string;
  capabilities: string[];
}

export interface ScalingConfig {
  mode: 'single' | 'cluster';
  redis_url?: string;
  node_id: string;
  heartbeat_interval_ms: number;
  max_nodes: number;
}

// ─── Mission Control ───

export interface MissionControlState {
  agents: AgentStatus[];
  tasks: TaskQueueItem[];
  metrics: SystemMetrics;
  alerts: Alert[];
  logs: LogEntry[];
}

export interface AgentStatus {
  agent_id: string;
  name: string;
  status: 'active' | 'idle' | 'processing' | 'error';
  current_task?: string;
  uptime_ms: number;
  tasks_completed: number;
  tasks_failed: number;
  model_provider: string;
  memory_usage_mb: number;
  last_activity: string;
}

export interface TaskQueueItem {
  id: string;
  type: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  assigned_agent?: string;
  source_channel: ChannelType;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  payload: unknown;
  result?: unknown;
  error?: string;
}

export interface SystemMetrics {
  cpu_usage_pct: number;
  memory_usage_mb: number;
  memory_total_mb: number;
  active_connections: number;
  messages_per_minute: number;
  avg_response_time_ms: number;
  uptime_seconds: number;
  total_tasks_today: number;
  error_rate_pct: number;
  model_calls_today: Record<string, number>;
}

export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  source: string;
  timestamp: string;
  acknowledged: boolean;
  resolved: boolean;
}

export interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ─── PAW Hub ───

export interface HubState {
  active_view: 'dashboard' | 'mission-control' | 'cli' | 'plugins' | 'workflows' | 'settings';
  connected: boolean;
  authenticated: boolean;
  theme: 'dark' | 'light';
  notifications: HubNotification[];
  recent_actions: ActionRecord[];
}

export interface HubNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  source_channel: ChannelType;
  timestamp: string;
  read: boolean;
}

export interface ActionRecord {
  id: string;
  action: string;
  description: string;
  source_channel: ChannelType;
  user_id: string;
  tenant_id?: string;
  timestamp: string;
  duration_ms: number;
  status: 'success' | 'failed';
  metadata?: Record<string, unknown>;
}

// ─── Cross-App Memory Sync ───

export interface SyncEvent {
  event_id: string;
  type: 'memory_update' | 'action_completed' | 'session_created' | 'session_ended' | 'mode_changed' | 'alert';
  source_channel: ChannelType;
  target_channels: ChannelType[] | 'all';
  payload: unknown;
  timestamp: string;
  user_id: string;
}

export interface SharedMemory {
  key: string;
  value: unknown;
  scope: MemoryScope;
  source_channel: ChannelType;
  updated_at: string;
  version: number;
  ttl_ms?: number;
}

export interface CrossAppSession {
  session_id: string;
  user_id: string;
  active_channels: ChannelType[];
  shared_context: Record<string, unknown>;
  conversation_history: CrossAppMessage[];
  created_at: string;
  last_sync: string;
}

export interface CrossAppMessage {
  id: string;
  content: string;
  role: 'user' | 'agent';
  source_channel: ChannelType;
  timestamp: string;
  action_type?: string;
  metadata?: Record<string, unknown>;
}
