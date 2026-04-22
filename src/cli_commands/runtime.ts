/** Runtime observability: status, watch, ping, run, logs. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { SOTAClient } from '../client.js';
import { getApiUrl } from '../auth.js';
import { resolveApiKey } from '../cli_context.js';
import { emit, statusTag } from '../cli_output.js';
import type { ActivityLogEntry } from '../models.js';

export async function statusAction(opts: { json?: boolean }): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const p = await client.getProfile();
  emit({
    jsonMode: !!opts.json,
    data: p,
    render: (r) =>
      `${r.name} [${r.id.slice(0, 8)}]\n` +
      `  status:       ${statusTag(r.status)}\n` +
      `  capabilities: ${(r.capabilities ?? []).join(', ')}\n` +
      `  last seen:    ${r.last_seen_at ?? 'never'}`,
  });
}

export async function watchAction(
  opts: { interval?: number; forever?: boolean },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const interval = (opts.interval ?? 5) * 1000;
  let prev: string | undefined;
  let running = true;
  process.on('SIGINT', () => { running = false; });
  while (running) {
    const p = await client.getProfile();
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(
      `${p.name} — ${statusTag(p.status)} (${p.last_seen_at ?? 'never'})`,
    );
    if (!opts.forever && prev && prev !== p.status) {
      console.log('Status changed — exiting.');
      return;
    }
    prev = p.status;
    await new Promise((r) => setTimeout(r, interval));
  }
}

export async function pingAction(): Promise<void> {
  const apiKey = resolveApiKey();
  const url = getApiUrl();
  try {
    const r = await fetch(`${url}/api/health`);
    if (!r.ok) throw new Error(`backend ${r.status}`);
  } catch (e) {
    console.error(`✗ backend unreachable: ${e instanceof Error ? e.message : e}`);
    throw e;
  }
  const client = new SOTAClient(apiKey, url);
  try {
    await client.getProfile();
  } catch (e) {
    console.error(`✗ API key auth failed: ${e instanceof Error ? e.message : e}`);
    throw e;
  }
  console.log(`✓ ${url} reachable + key valid.`);
}

export function runAction(): void {
  if (existsSync(join(process.cwd(), 'package.json'))) {
    const res = spawnSync('npm', ['start'], { stdio: 'inherit' });
    process.exit(res.status ?? 1);
  }
  if (existsSync(join(process.cwd(), 'agent.py'))) {
    const res = spawnSync('python', ['agent.py'], { stdio: 'inherit' });
    process.exit(res.status ?? 1);
  }
  console.error('Error: no package.json or agent.py in CWD.');
  process.exit(1);
}

function renderLogEntry(e: ActivityLogEntry): string {
  const tag = ({ info: 'INFO', warn: 'WARN', error: 'ERR!' } as Record<string, string>)[e.level] ?? 'INFO';
  const jobPart = e.job_id ? ` job=${e.job_id.slice(0, 8)}` : '';
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const msg = (payload.message ?? payload.reason ?? '') as string;
  const pct = payload.percent as number | undefined;
  const pctPart = pct !== undefined ? ` ${pct}%` : '';
  const msgPart = msg ? ` — ${msg}` : '';
  return `${e.created_at} [${tag}] ${e.event_type}${jobPart}${pctPart}${msgPart}`;
}

export interface LogsOptions {
  follow: boolean;
  json: boolean;
  interval: number;
  limit: number;
  jobId?: string;
  since?: string;
}

export async function logsAction(opts: LogsOptions): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  if (!opts.json) {
    console.log(
      '# Server-side events only — local stdout ' +
      '(console.log / print) is in your agent terminal.',
    );
  }
  let sinceId: number | undefined;
  while (true) {
    const page = await client.getActivityLog({
      sinceId,
      sinceTs: opts.since,
      jobId: opts.jobId,
      limit: opts.limit,
    });
    for (const entry of page.entries) {
      if (opts.json) {
        console.log(JSON.stringify(entry));
      } else {
        console.log(renderLogEntry(entry));
      }
      sinceId = entry.id;
    }
    if (page.next_since_id !== null && page.next_since_id !== undefined) {
      sinceId = page.next_since_id;
    }
    if (!opts.follow) return;
    await new Promise((r) => setTimeout(r, opts.interval * 1000));
  }
}
