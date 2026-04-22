import { APIError, SOTAClient } from './client.js';
import { RealtimeManager } from './realtime.js';
import { AgentError, ErrorCode } from './errors.js';
import { JobLogger, NoopJobLogger } from './logger.js';
import type { IJobLogger } from './logger.js';
import type { Job, AutoBidConfig, AgentProfile, TestJob } from './models.js';

export const SDK_VERSION = '0.1.0';
export const SANDBOX_POLL_INTERVAL_MS = 5_000;
export const HEARTBEAT_INTERVAL_MS = 25_000; // 3 beats within backend's 90s offline threshold

/** Context passed to job handler functions. */
export interface JobContext {
  job: Job;
  agentId: string;
  log: IJobLogger;
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
  private _stopPromise: Promise<void> = Promise.resolve();
  private _resolveStop: () => void = () => {};
  private _fatalError: Error | null = null;
  private _jwtExpiresAt = 0; // unix ms; 0 = unknown/not yet exchanged

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

  /** Start the agent.
   *
   * Branches on profile.status:
   *   - 'sandbox': poll /agents/jobs, deliver to /test-jobs/{id}/deliver
   *   - 'active':  subscribe to Realtime, normal marketplace flow
   *   - others:    idle-poll /agents/me every 60s waiting for an active flip
   */
  async run(): Promise<void> {
    this._fatalError = null;
    this._stopPromise = new Promise<void>((resolve) => {
      this._resolveStop = resolve;
    });

    // 1. Get agent profile (validates API key)
    this._profile = await this._client.getProfile();
    const status = this._profile.status ?? 'active';
    const caps = this._profile.capabilities?.length
      ? this._profile.capabilities.join(', ')
      : 'none';
    console.log(
      `[SOTA] Connected: ${this._profile.name} [${this._profile.id}] | ` +
      `status=${status} | capabilities=[${caps}]`,
    );

    // 2. Report SDK version (best-effort)
    await this._client
      .updateProfile({ sdk_version: SDK_VERSION } as Partial<AgentProfile>)
      .catch(() => {});

    this._running = true;
    this._scheduleHeartbeat();

    // 3. Graceful shutdown
    const shutdown = () => {
      console.log('[SOTA] Shutting down gracefully...');
      this.stop();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // 4. Branch on status
    if (status === 'sandbox') {
      await this._runSandboxLoop();
      this._profile = await this._client.getProfile();
    }

    const currentStatus = this._profile.status ?? '';
    if (currentStatus === 'active') {
      await this._runActiveLoop();
    } else if (
      ['testing_passed', 'pending_review', 'rejected', 'suspended'].includes(currentStatus)
    ) {
      await this._waitForActive(currentStatus);
    } else if (currentStatus !== 'sandbox') {
      console.warn(
        `[SOTA] Unknown agent status '${currentStatus}' — idling. Check the developer portal.`,
      );
      await this._stopPromise; // wake on fatal or stop()
    }

    if (this._fatalError) throw this._fatalError;
  }

  private async _runActiveLoop(): Promise<void> {
    const { token, expires_in } = await this._client.exchangeToken();
    this._jwtExpiresAt = Date.now() + (expires_in ?? 900) * 1000;
    if (this._realtime) {
      await this._realtime.connect(token);
      const capabilities = Array.from(this._jobHandlers.keys());
      this._realtime.subscribeJobs(capabilities, (job) => this._handleNewJob(job));
      this._realtime.subscribeJobUpdates((job) => this._handleJobUpdate(job));
      console.log(`[SOTA] Listening for jobs: ${capabilities.join(', ')}`);
    }
    this._scheduleTokenRefresh();
    console.log('[SOTA] Agent running (active). Waiting for jobs...');
    await this._stopPromise; // wake on fatal or stop()
  }

  private async _runSandboxLoop(): Promise<void> {
    console.log(
      `[SOTA] Sandbox mode. Polling for test jobs every ` +
      `${SANDBOX_POLL_INTERVAL_MS / 1000}s. Complete all 3 to unlock review.`,
    );
    const seen = new Set<string>();
    let firstPoll = true;

    while (this._running) {
      let resp: { sandbox?: boolean; jobs: TestJob[] };
      try {
        resp = (await this._client.listAvailableJobs()) as { sandbox?: boolean; jobs: TestJob[] };
      } catch (err) {
        console.warn(`[SOTA] [sandbox] listAvailableJobs failed: ${err}`);
        await new Promise((r) => setTimeout(r, SANDBOX_POLL_INTERVAL_MS));
        continue;
      }

      if (!resp.sandbox) {
        console.log('[SOTA] [sandbox] Backend no longer reports sandbox mode — exiting sandbox loop.');
        return;
      }

      if (firstPoll) {
        const pending = resp.jobs.filter(
          (j) => j.status === 'pending' || j.status === 'assigned',
        );
        console.log(`[SOTA] [sandbox] Ready — ${pending.length} test job(s) pending.`);
        firstPoll = false;
      }

      for (const tj of resp.jobs) {
        if (!tj.id || seen.has(tj.id)) continue;
        if (tj.status !== 'pending' && tj.status !== 'assigned') continue;
        seen.add(tj.id);
        try {
          await this._executeTestJob(tj);
        } catch (err) {
          console.error(`[SOTA] [sandbox] Unexpected error on test job ${tj.id}:`, err);
        }
      }

      await new Promise((r) => setTimeout(r, SANDBOX_POLL_INTERVAL_MS));
    }
  }

  private async _executeTestJob(testJob: TestJob): Promise<void> {
    const capability = testJob.capability ?? '';
    const handler = this._jobHandlers.get(capability) ?? this._jobHandlers.get('_default');
    if (!handler) {
      console.warn(
        `[SOTA] [sandbox] No handler for capability '${capability}' ` +
        `(and no '_default' fallback). Skipping test job ${testJob.id}.`,
      );
      return;
    }

    const syntheticJob: Job = {
      id: testJob.id,
      description: testJob.description,
      parameters: testJob.parameters,
      budget_usdc: 0,
      tags: capability ? [capability] : [],
      status: 'executing',
      created_at: testJob.created_at,
    };

    let delivered = false;
    let lastValidation: { passed: boolean; reason?: string } | null = null;
    const ctx: JobContext = {
      job: syntheticJob,
      agentId: this._profile!.id,
      log: new NoopJobLogger(),
      updateProgress: async () => { /* no-op in sandbox */ },
      deliver: async (result) => {
        lastValidation = await this._client.deliverTestJob(testJob.id, result);
        delivered = true;
        if (!lastValidation.passed) {
          // Surface the verdict to the handler so failures are visible in
          // dev logs immediately, not only via the portal.
          throw new AgentError({
            code: ErrorCode.INVALID_INPUT,
            message: `Test job validation failed: ${lastValidation.reason ?? 'validation failed'}`,
          });
        }
      },
      fail: (code, message, partialResult, retryable) => {
        throw new AgentError({ code, message, partialResult, retryable });
      },
    };

    try {
      // Support both callback-style and return-value handlers
      const maybeResult = await handler(ctx) as unknown;
      if (!delivered && typeof maybeResult === 'string') {
        // Route through ctx.deliver so the passed=false path throws the
        // same AgentError as the callback-style handler does.
        await ctx.deliver(maybeResult);
      }
      const verdict = lastValidation ?? { passed: false, reason: 'handler did not deliver' };
      const label = verdict.passed ? 'passed' : 'failed';
      const reason = verdict.reason ? `  ${verdict.reason}` : '';
      console.log(`[SOTA] [sandbox] Test job ${testJob.id} (${capability}): ${label}${reason}`);
    } catch (err) {
      console.error(`[SOTA] [sandbox] Handler for '${capability}' raised:`, err);
    }
  }

  private async _waitForActive(status: string): Promise<void> {
    const messages: Record<string, string> = {
      testing_passed: "all test jobs passed — run `sota-agent-ts request-review`",
      pending_review: 'waiting for admin review',
      rejected: 'admin rejected this agent — fix and resubmit',
      suspended: 'agent is suspended by admin',
    };
    console.log(`[SOTA] Agent status '${status}' — ${messages[status] ?? ''}`);
    let current = status;
    while (this._running) {
      await Promise.race([
        new Promise((r) => setTimeout(r, 60_000)),
        this._stopPromise,
      ]);
      if (!this._running) return;
      try {
        this._profile = await this._client.getProfile();
      } catch {
        continue;
      }
      const next = this._profile.status ?? '';
      if (next === current) continue;
      console.log(`[SOTA] Agent status: ${current} -> ${next}`);
      current = next;
      if (next === 'active') {
        console.log('[SOTA] Entering active mode.');
        await this._runActiveLoop();
        return;
      }
      if (next === 'sandbox') {
        await this._runSandboxLoop();
        return;
      }
      if (messages[next]) console.log(`[SOTA] ${messages[next]}`);
    }
  }

  /** Stop the agent: clear timers, disconnect realtime. */
  stop(): void {
    this._running = false;
    if (this._heartbeatTimeout) clearTimeout(this._heartbeatTimeout);
    if (this._tokenRefreshTimeout) clearTimeout(this._tokenRefreshTimeout);
    this._realtime?.disconnect();
    this._resolveStop();
    console.log('[SOTA] Agent stopped');
  }

  private _scheduleHeartbeat(): void {
    if (!this._running) return;
    this._heartbeatTimeout = setTimeout(async () => {
      try {
        await this._client.heartbeat();
      } catch (err) {
        // 401 is fatal: API key was rotated or revoked. Retrying would
        // just log the same error every 25s forever.
        if (err instanceof APIError && err.status === 401) {
          console.error(
            '[SOTA] Heartbeat rejected with 401 — API key revoked or invalid. ' +
            'Stopping agent; rotate credentials and restart.',
          );
          this._fatalError = err;
          this._running = false;
          this._resolveStop();
          return;
        }
        console.error('[SOTA] Heartbeat failed:', err);
      }
      this._scheduleHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private _scheduleTokenRefresh(): void {
    if (!this._running) return;
    // Refresh 3 min before expiry, matching the Python SDK. Floor at 60s
    // so a short-lived token (or a past-expiry clock) still paces sanely.
    const delay = Math.max(this._jwtExpiresAt - Date.now() - 180_000, 60_000);
    this._tokenRefreshTimeout = setTimeout(async () => {
      try {
        const { token: newToken, expires_in } = await this._client.exchangeToken();
        this._jwtExpiresAt = Date.now() + (expires_in ?? 900) * 1000;
        this._realtime?.setAuth(newToken);
      } catch (err) {
        console.error('[SOTA] Token refresh failed:', err);
      }
      this._scheduleTokenRefresh();
    }, delay);
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
    // Only react to jobs where this agent is the declared winner.
    if (job.winner_agent_id !== this._profile?.id) return;

    // On award (status=assigned) push the transition to executing ourselves.
    // Escrow may still fund in the background, but we don't want to wait on
    // it — the backend gates the handler on status='executing' and wallet-
    // less / devnet-ATA-missing agents would otherwise stall forever.
    if (job.status === 'assigned') {
      try {
        await this._client.acceptJob(job.id);
      } catch (err) {
        console.error(`[SOTA] Failed to accept job ${job.id}:`, err);
      }
      return;
    }

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
              // Unhandled exceptions default to retryable=true — they're
              // almost always transient. Developers opt out via AgentError.
              await this._client.deliverError(
                job.id,
                ErrorCode.INTERNAL_ERROR,
                err instanceof Error ? err.message : String(err),
                undefined,
                true,
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
      log: new JobLogger(job.id, this._client),
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
