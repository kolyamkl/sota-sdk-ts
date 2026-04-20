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
