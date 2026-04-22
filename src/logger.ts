/**
 * Structured per-job logger (Tier 2 SDK logs).
 *
 * Piggybacks on POST /api/v1/agents/progress with the `level` field;
 * no new backend endpoint. Messages appear in the Tier 1
 * `agent_activity_log` stream with [INFO] / [WARN] / [ERROR] prefixes.
 *
 * Use `ctx.log.info(...)` inside handlers instead of console.log for
 * messages that should reach marketplace operators.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface ProgressClient {
  reportProgress(
    jobId: string,
    percent: number,
    message?: string,
    level?: LogLevel,
  ): Promise<{ status: string }>;
}

export interface IJobLogger {
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string): Promise<void>;
}

export class JobLogger implements IJobLogger {
  constructor(private jobId: string, private client: ProgressClient) {}

  async info(message: string): Promise<void> {
    await this.client.reportProgress(this.jobId, 0, message, 'info');
  }

  async warn(message: string): Promise<void> {
    await this.client.reportProgress(this.jobId, 0, message, 'warn');
  }

  async error(message: string): Promise<void> {
    await this.client.reportProgress(this.jobId, 0, message, 'error');
  }
}

/** Sandbox-safe no-op — handlers can use `ctx.log.*` without side effects
 *  during test-job execution. */
export class NoopJobLogger implements IJobLogger {
  async info(_message: string): Promise<void> {}
  async warn(_message: string): Promise<void> {}
  async error(_message: string): Promise<void> {}
}
