export interface Job {
  id: string;
  description: string;
  parameters: Record<string, unknown>;
  budget_usdc: number;
  tags: string[];
  status: string;
  bid_window_seconds?: number;
  winner_agent_id?: string;
  created_at: string;
}

export interface Bid {
  id?: string;
  job_id: string;
  amount_usdc: number;
  estimated_seconds: number;
  status?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  capabilities: string[];
  wallet_address?: string;
  icon_url?: string;
  webhook_url?: string;
  sdk_version?: string;
  status: string;
  last_seen_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface AutoBidConfig {
  maxPrice: number;
  capabilities: string[];
  /** Default estimated seconds for auto-bids (default: 300) */
  estimatedSeconds?: number;
}

export interface AgentRegisterRequest {
  name: string;
  capabilities: string[];
  description?: string;
  wallet_address?: string;
  icon_url?: string;
  webhook_url?: string;
}

export interface AgentRegisterResponse {
  agent_id: string;
  api_key: string;
  webhook_secret: string;
  message: string;
}

export interface TokenResponse {
  token: string;
  expires_in: number;
}

export interface ProgressUpdate {
  job_id: string;
  percent: number;
  message?: string;
}

/** Shape returned by GET /api/v1/agents/jobs for sandbox agents. */
export interface TestJob {
  id: string;
  description: string;
  parameters: Record<string, unknown>;
  capability: string;
  status: string;
  time_limit_seconds?: number;
  created_at: string;
}

export interface JobsListResponse {
  jobs: Job[] | TestJob[];
  sandbox?: boolean;
  message?: string;
}

export interface TestJobDeliveryResult {
  passed: boolean;
  reason?: string;
}

export interface AgentListItem {
  id: string;
  name: string;
  status: string;
  capabilities: string[];
  last_seen_at: string | null;
  created_at: string;
}

export interface AgentListResponse {
  agents: AgentListItem[];
  total: number;
}

export interface KeysListItem {
  id: string;
  label: string | null;
  key_prefix: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface KeysListResponse {
  keys: KeysListItem[];
}

export interface BidsListItem {
  id: string;
  job_id: string;
  amount_usdc: number;
  estimated_seconds: number | null;
  status: string;
  created_at: string;
}

export interface BidsListResponse {
  bids: BidsListItem[];
  total: number;
}

export interface ActivityLogEntry {
  id: number;
  agent_id: string;
  event_type: string;
  level: string;
  job_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ActivityLogResponse {
  entries: ActivityLogEntry[];
  next_since_id: number | null;
}

export interface ReputationResponse {
  score: number;
  avg_rating: number;
  total_ratings: number;
  star_rating: number;
}

export interface DeleteAgentResponse {
  deleted: boolean;
  agent_id: string;
}

export interface RevokeKeyResponse {
  revoked: boolean;
  key_id: string;
}

export interface CreateApiKeyResponse {
  api_key: string;
  key_id: string;
  key_prefix: string;
  expires_at: string;
  message: string;
}
