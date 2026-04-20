import { SOTAClient } from './client.js';
import { RealtimeManager } from './realtime.js';
import { AgentError, ErrorCode } from './errors.js';
import type { Job, AutoBidConfig, AgentProfile } from './models.js';

export const SDK_VERSION = '0.1.0';

/** Context passed to job handler functions. */
export interface JobContext {
  job: Job;
  agentId: string;
  updateProgress: (percent: number, message?: string) => Promise<void>;
  deliver: (result: string, resultHash?: string) => Promise<void>;
  fail: (code: ErrorCode, message: string, partialResult?: string, retryable?: boolean) => never;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;
export type BidHandler = (job: Job) => Promise<{ amount_usdc: number; estimated_seconds: number } | null>;

export interface SOTAAgentOptions {
  apiKey?: string;
  baseUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export class SOTAAgent {
  private _client: SOTAClient;
  private _realtime: RealtimeManager | null = null;
  private _jobHandlers: Map<string, JobHandler> = new Map();
  private _bidHandlers: Map<string, BidHandler> = new Map();
  private _autoBidConfig: AutoBidConfig | null = null;
  private _profile: AgentProfile | null = null;
  private _heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private _tokenRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private _running = false;

  constructor(options: SOTAAgentOptions = {}) {
    const apiKey = options.apiKey ?? process.env.SOTA_API_KEY;
    if (!apiKey) {
      throw new Error('API key required: pass apiKey option or set SOTA_API_KEY env var');
    }
    const baseUrl = options.baseUrl ?? process.env.SOTA_API_URL ?? 'http://localhost:3001';
    this._client = new SOTAClient(apiKey, baseUrl);

    const supabaseUrl = options.supabaseUrl ?? process.env.SUPABASE_URL;
    const supabaseAnonKey = options.supabaseAnonKey ?? process.env.SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseAnonKey) {
      this._realtime = new RealtimeManager(supabaseUrl, supabaseAnonKey);
    } else {
      console.warn('[SOTA] SUPABASE_URL or SUPABASE_ANON_KEY not set — realtime disabled, agent will poll for jobs');
    }
  }

  /** Register a handler for jobs matching a capability tag. */
  onJob(capability: string, handler: JobHandler): void {
    this._jobHandlers.set(capability, handler);
  }

  /** Register a custom bid evaluator for a capability. */
  onBidOpportunity(capability: string, handler: BidHandler): void {
    this._bidHandlers.set(capability, handler);
  }

  /** Enable automatic bidding for matching capabilities. */
  setAutoBid(config: AutoBidConfig): void {
    if (config.maxPrice <= 0) {
      throw new Error('maxPrice must be greater than 0');
    }
    if (!config.capabilities || config.capabilities.length === 0) {
      throw new Error('capabilities array cannot be empty');
    }
    this._autoBidConfig = config;
  }

  /** Start the agent: authenticate, connect realtime, begin heartbeat loop. */
  async run(): Promise<void> {
    // 1. Get agent profile (validates API key)
    this._profile = await this._client.getProfile();
    console.log(`[SOTA] Agent "${this._profile.name}" connected (${this._profile.id})`);

    // 2. Report SDK version
    await this._client.updateProfile({ sdk_version: SDK_VERSION } as Partial<AgentProfile>).catch(() => {});

    // 3. Exchange API key for JWT
    const { token } = await this._client.exchangeToken();

    // 4. Connect realtime if available
    if (this._realtime) {
      await this._realtime.connect(token);
      const capabilities = Array.from(this._jobHandlers.keys());
      this._realtime.subscribeJobs(capabilities, (job) => this._handleNewJob(job));
      this._realtime.subscribeJobUpdates((job) => this._handleJobUpdate(job));
      console.log(`[SOTA] Listening for jobs: ${capabilities.join(', ')}`);
    }

    // 5. Start heartbeat (every 25 seconds, non-stacking)
    this._running = true;
    this._scheduleHeartbeat();

    // 6. Start token refresh (every 10 minutes for 15-min tokens)
    this._scheduleTokenRefresh();

    // 7. Handle graceful shutdown
    const shutdown = () => {
      console.log('[SOTA] Shutting down gracefully...');
      this.stop();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  /** Stop the agent: clear timers, disconnect realtime. */
  stop(): void {
    this._running = false;
    if (this._heartbeatTimeout) clearTimeout(this._heartbeatTimeout);
    if (this._tokenRefreshTimeout) clearTimeout(this._tokenRefreshTimeout);
    this._realtime?.disconnect();
    console.log('[SOTA] Agent stopped');
  }

  private _scheduleHeartbeat(): void {
    if (!this._running) return;
    this._heartbeatTimeout = setTimeout(async () => {
      try {
        await this._client.heartbeat();
      } catch (err) {
        console.error('[SOTA] Heartbeat failed:', err);
      }
      this._scheduleHeartbeat();
    }, 25_000);
  }

  private _scheduleTokenRefresh(): void {
    if (!this._running) return;
    this._tokenRefreshTimeout = setTimeout(async () => {
      try {
        const { token: newToken } = await this._client.exchangeToken();
        this._realtime?.setAuth(newToken);
      } catch (err) {
        console.error('[SOTA] Token refresh failed:', err);
      }
      this._scheduleTokenRefresh();
    }, 10 * 60 * 1000);
  }

  private async _handleNewJob(job: Job): Promise<void> {
    // Auto-bid check
    if (this._autoBidConfig) {
      const { maxPrice, capabilities } = this._autoBidConfig;
      const matches = job.tags.some((t) => capabilities.includes(t));
      if (matches && job.budget_usdc <= maxPrice) {
        try {
          await this._client.submitBid(job.id, job.budget_usdc, this._autoBidConfig.estimatedSeconds ?? 300);
          console.log(`[SOTA] Auto-bid on job ${job.id}`);
        } catch (err) {
          console.error(`[SOTA] Auto-bid failed for ${job.id}:`, err);
        }
      }
    }

    // Custom bid handlers
    for (const [cap, handler] of this._bidHandlers) {
      if (job.tags.includes(cap)) {
        try {
          const bid = await handler(job);
          if (bid) {
            await this._client.submitBid(job.id, bid.amount_usdc, bid.estimated_seconds);
          }
        } catch (err) {
          console.error(`[SOTA] Bid handler error for ${cap}:`, err);
        }
      }
    }
  }

  private async _handleJobUpdate(job: Job): Promise<void> {
    // Execute job when this agent is assigned as winner
    if (job.winner_agent_id !== this._profile?.id) return;
    if (job.status !== 'executing') return;

    for (const [cap, handler] of this._jobHandlers) {
      if (job.tags.includes(cap)) {
        const ctx = this._makeContext(job);
        try {
          await handler(ctx);
        } catch (err) {
          if (err instanceof AgentError) {
            try {
              await this._client.deliverError(
                job.id,
                err.code,
                err.message,
                err.partialResult,
                err.retryable,
              );
            } catch (deliverErr) {
              console.error(`[SOTA] Failed to report error for ${job.id}:`, deliverErr);
            }
          } else {
            console.error(`[SOTA] Job handler error for ${job.id}:`, err);
            try {
              await this._client.deliverError(
                job.id,
                ErrorCode.INTERNAL_ERROR,
                err instanceof Error ? err.message : String(err),
              );
            } catch (deliverErr) {
              console.error(`[SOTA] Failed to report error for ${job.id}:`, deliverErr);
            }
          }
        }
        break;
      }
    }
  }

  private _makeContext(job: Job): JobContext {
    if (!this._profile) {
      throw new Error('Agent profile not loaded. Call run() first.');
    }
    return {
      job,
      agentId: this._profile.id,
      updateProgress: async (percent, message) => {
        await this._client.reportProgress(job.id, percent, message);
      },
      deliver: async (result, resultHash) => {
        await this._client.deliver(job.id, result, resultHash);
      },
      fail: (code, message, partialResult, retryable) => {
        throw new AgentError({ code, message, partialResult, retryable });
      },
    };
  }
}
