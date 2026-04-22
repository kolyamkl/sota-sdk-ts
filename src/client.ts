import type {
  AgentProfile,
  TokenResponse,
  Job,
  WebhookEvent,
  AgentRegisterRequest,
  AgentRegisterResponse,
  JobsListResponse,
  TestJobDeliveryResult,
  AgentListResponse,
  KeysListResponse,
  BidsListResponse,
  ActivityLogResponse,
  ReputationResponse,
  DeleteAgentResponse,
  RevokeKeyResponse,
  CreateApiKeyResponse,
} from './models.js';
import type { ErrorCode } from './errors.js';

/** Structured error from the SOTA API. */
export class APIError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`HTTP ${status}: ${detail}`);
    this.name = 'APIError';
    this.status = status;
    this.detail = detail;
  }
}

export class SOTAClient {
  private apiKey: string;
  private baseUrl: string;
  private jwt: string | null = null;

  constructor(apiKey: string, baseUrl = 'http://localhost:3001') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setJwt(jwt: string | null): void {
    this.jwt = jwt;
  }

  private headers(authMode: 'api-key' | 'jwt' = 'api-key'): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authMode === 'jwt') {
      if (!this.jwt) {
        throw new APIError(401, 'JWT not set; call setJwt() first');
      }
      h['Authorization'] = `Bearer ${this.jwt}`;
    } else {
      h['X-API-Key'] = this.apiKey;
    }
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { retries?: number; authMode?: 'api-key' | 'jwt' } = {},
  ): Promise<T> {
    const retries = opts.retries ?? 3;
    const authMode = opts.authMode ?? 'api-key';
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers(authMode),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(url, init);
        if (!resp.ok) {
          let detail: string;
          const rawText = await resp.text();
          try {
            const json = JSON.parse(rawText);
            detail = json.detail ?? json.message ?? rawText;
          } catch {
            detail = rawText;
          }
          const err = new APIError(resp.status, detail);
          // Don't retry 4xx errors (client errors) except 429 (rate limited)
          if (resp.status < 500 && resp.status !== 429) throw err;
          lastError = err;
        } else {
          return resp.json() as Promise<T>;
        }
      } catch (err) {
        if (err instanceof APIError && err.status < 500 && err.status !== 429) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < retries) {
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError!;
  }

  async getProfile(): Promise<AgentProfile> {
    return this.request<AgentProfile>('GET', '/api/v1/agents/me');
  }

  async updateProfile(fields: Partial<AgentProfile>): Promise<AgentProfile> {
    return this.request<AgentProfile>('PATCH', '/api/v1/agents/me', fields);
  }

  async exchangeToken(): Promise<TokenResponse> {
    return this.request<TokenResponse>('POST', '/api/v1/agents/token');
  }

  async heartbeat(): Promise<{ status: string }> {
    return this.request<{ status: string }>('POST', '/api/v1/agents/heartbeat');
  }

  async listJobs(): Promise<{ jobs: Job[] }> {
    return this.request<{ jobs: Job[] }>('GET', '/api/v1/agents/jobs');
  }

  /** List available jobs including the `sandbox` flag and test-job shape.
   *  Sandbox agents get test jobs back with a singular `capability` field
   *  instead of `tags`; active agents get real marketplace jobs. */
  async listAvailableJobs(): Promise<JobsListResponse> {
    return this.request<JobsListResponse>('GET', '/api/v1/agents/jobs');
  }

  /** Deliver a sandbox test job result. Backend validates the JSON
   *  against the template's expected schema. */
  async deliverTestJob(
    testJobId: string,
    result: string,
  ): Promise<TestJobDeliveryResult> {
    return this.request<TestJobDeliveryResult>(
      'POST',
      `/api/v1/agents/test-jobs/${testJobId}/deliver`,
      { result },
    );
  }

  async submitBid(
    jobId: string,
    amountUsdc: number,
    estimatedSeconds: number,
  ): Promise<{ status: string; bid_id?: string }> {
    return this.request('POST', '/api/v1/agents/bid', {
      job_id: jobId,
      amount_usdc: amountUsdc,
      estimated_seconds: estimatedSeconds,
    });
  }

  /** Acknowledge an award and advance the job to ``executing``.
   * Use when the payment path hasn't promoted us out of ``assigned`` yet
   * (devnet ATA missing, RPC outage, or the job was created without
   * escrow funding). Safe to call idempotently — the backend rejects
   * with 409 if we're already past ``assigned``. */
  async acceptJob(jobId: string): Promise<{ job_id: string; status: string }> {
    return this.request('POST', `/api/v1/agents/jobs/${jobId}/accept`);
  }

  async deliver(
    jobId: string,
    result: string,
    resultHash?: string,
  ): Promise<{ status: string }> {
    const body: Record<string, unknown> = { job_id: jobId, result };
    if (resultHash) body.result_hash = resultHash;
    return this.request('POST', '/api/v1/agents/deliver', body);
  }

  async deliverError(
    jobId: string,
    errorCode: ErrorCode,
    errorMessage: string,
    partialResult?: string,
    retryable = false,
  ): Promise<{ status: string }> {
    return this.request('POST', '/api/v1/agents/deliver', {
      job_id: jobId,
      error_code: errorCode,
      error_message: errorMessage,
      partial_result: partialResult,
      retryable,
    });
  }

  async reportProgress(
    jobId: string,
    percent: number,
    message?: string,
    level: 'info' | 'warn' | 'error' = 'info',
  ): Promise<{ status: string }> {
    if (level !== 'info' && level !== 'warn' && level !== 'error') {
      throw new Error(`level must be info|warn|error, got ${level}`);
    }
    const body: Record<string, unknown> = { job_id: jobId, percent, level };
    if (message !== undefined) body.message = message;
    return this.request('POST', '/api/v1/agents/progress', body);
  }

  async getEvents(since?: string): Promise<WebhookEvent[]> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.request<WebhookEvent[]>('GET', `/api/v1/agents/events${qs}`);
  }

  async rotateApiKey(): Promise<{
    api_key: string;
    token?: string;
    expires_in?: number;
    message: string;
  }> {
    const data = await this.request<{
      api_key: string;
      token?: string;
      expires_in?: number;
      message: string;
    }>('POST', '/api/v1/agents/keys/rotate');
    if (data.api_key) {
      // Old key keeps working for 60s (backend grace window) but all
      // new calls on this client should use the new key.
      this.apiKey = data.api_key;
    }
    return data;
  }

  async listAgents(
    opts: { status?: string; includeDeleted?: boolean } = {},
  ): Promise<AgentListResponse> {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.includeDeleted) params.set('include_deleted', 'true');
    const qs = params.toString();
    return this.request<AgentListResponse>(
      'GET',
      `/api/v1/agents${qs ? `?${qs}` : ''}`,
      undefined,
      { authMode: 'jwt' },
    );
  }

  async deleteAgent(agentId: string): Promise<DeleteAgentResponse> {
    return this.request<DeleteAgentResponse>(
      'DELETE',
      `/api/v1/agents/${agentId}`,
      undefined,
      { authMode: 'jwt' },
    );
  }

  async listBids(
    opts: { status?: string; since?: string } = {},
  ): Promise<BidsListResponse> {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.since) params.set('since', opts.since);
    const qs = params.toString();
    return this.request<BidsListResponse>(
      'GET',
      `/api/v1/agents/bids${qs ? `?${qs}` : ''}`,
    );
  }

  async listKeys(
    opts: { includeRevoked?: boolean } = {},
  ): Promise<KeysListResponse> {
    const params = new URLSearchParams();
    if (opts.includeRevoked) params.set('include_revoked', 'true');
    const qs = params.toString();
    return this.request<KeysListResponse>(
      'GET',
      `/api/v1/agents/keys${qs ? `?${qs}` : ''}`,
    );
  }

  async revokeKey(keyId: string): Promise<RevokeKeyResponse> {
    return this.request<RevokeKeyResponse>(
      'POST',
      `/api/v1/agents/keys/${keyId}/revoke`,
    );
  }

  async getActivityLog(
    opts: {
      sinceId?: number;
      sinceTs?: string;
      jobId?: string;
      limit?: number;
    } = {},
  ): Promise<ActivityLogResponse> {
    const params = new URLSearchParams();
    params.set('limit', String(opts.limit ?? 200));
    if (opts.sinceId !== undefined) params.set('since_id', String(opts.sinceId));
    if (opts.sinceTs) params.set('since_ts', opts.sinceTs);
    if (opts.jobId) params.set('job_id', opts.jobId);
    return this.request<ActivityLogResponse>(
      'GET',
      `/api/v1/agents/activity-log?${params.toString()}`,
    );
  }

  async getReputation(agentId: string): Promise<ReputationResponse> {
    return this.request<ReputationResponse>(
      'GET',
      `/api/v1/agents/${agentId}/reputation`,
    );
  }

  async retryTestJob(testJobId: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(
      'POST',
      `/api/v1/agents/test-jobs/${testJobId}/retry`,
    );
  }

  async createApiKey(
    agentId: string,
    opts: { label?: string; expiresDays?: number } = {},
  ): Promise<CreateApiKeyResponse> {
    return this.request<CreateApiKeyResponse>(
      'POST',
      `/api/v1/agents/${agentId}/keys`,
      { label: opts.label, expires_days: opts.expiresDays },
      { authMode: 'jwt' },
    );
  }

  /**
   * Register a new agent. Requires a user JWT (Bearer token), not an API key.
   * Returns the agent_id, api_key, and webhook_secret.
   *
   * Usage:
   *   const result = await SOTAClient.registerAgent('http://localhost:3001', userJwt, { name: 'my-agent', capabilities: ['web-scraping'] });
   *   // Use result.api_key to create a SOTAClient for the new agent
   */
  static async registerAgent(
    baseUrl: string,
    userJwt: string,
    body: AgentRegisterRequest,
  ): Promise<AgentRegisterResponse> {
    const url = `${baseUrl.replace(/\/$/, '')}/api/v1/agents/register`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userJwt}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      let detail: string;
      try {
        const json = await resp.json();
        detail = json.detail ?? json.message ?? JSON.stringify(json);
      } catch {
        detail = await resp.text();
      }
      throw new APIError(resp.status, detail);
    }
    return resp.json() as Promise<AgentRegisterResponse>;
  }
}
