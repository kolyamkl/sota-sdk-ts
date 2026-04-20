import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { Job } from './models.js';

export class RealtimeManager {
  private supabase: SupabaseClient | null = null;
  private jobsChannel: RealtimeChannel | null = null;
  private updatesChannel: RealtimeChannel | null = null;
  private supabaseUrl: string;
  private supabaseAnonKey: string;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;
  }

  async connect(jwt: string): Promise<void> {
    this.supabase = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      realtime: { params: { apikey: this.supabaseAnonKey } },
    });
  }

  /** Subscribe to new jobs (INSERT events on jobs table). */
  subscribeJobs(
    capabilities: string[],
    callback: (job: Job) => void,
  ): void {
    if (!this.supabase) throw new Error('Not connected. Call connect() first.');

    this.jobsChannel = this.supabase
      .channel('agent-jobs')
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'jobs',
        },
        (payload: { new: Record<string, unknown> }) => {
          const job = payload.new as unknown as Job;
          const hasMatch = job.tags?.some((t: string) => capabilities.includes(t));
          if (hasMatch) {
            callback(job);
          }
        },
      )
      .subscribe();
  }

  /** Subscribe to job status updates (UPDATE events — for assignment detection). */
  subscribeJobUpdates(callback: (job: Job) => void): void {
    if (!this.supabase) throw new Error('Not connected. Call connect() first.');

    this.updatesChannel = this.supabase
      .channel('agent-job-updates')
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
        },
        (payload: { new: Record<string, unknown> }) => {
          const job = payload.new as unknown as Job;
          callback(job);
        },
      )
      .subscribe();
  }

  setAuth(jwt: string): void {
    if (this.supabase) {
      this.supabase.realtime.setAuth(jwt);
    }
  }

  disconnect(): void {
    if (this.supabase) {
      if (this.jobsChannel) this.supabase.removeChannel(this.jobsChannel);
      if (this.updatesChannel) this.supabase.removeChannel(this.updatesChannel);
    }
    this.jobsChannel = null;
    this.updatesChannel = null;
    this.supabase = null;
  }
}
