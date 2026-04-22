/** Jobs + Bids CLI groups. */

import { SOTAClient } from '../client.js';
import { getApiUrl } from '../auth.js';
import { resolveApiKey } from '../cli_context.js';
import { emit, printTable, statusTag } from '../cli_output.js';

export async function jobsListAction(
  opts: { json?: boolean; limit?: number },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const raw = await client.listJobs();
  const items = (raw.jobs ?? []).slice(0, opts.limit ?? 50);
  emit({
    jsonMode: !!opts.json,
    data: { jobs: items },
    render: (d) => {
      if (!d.jobs.length) return 'No jobs.';
      printTable(
        ['id', 'status', 'budget', 'description'],
        d.jobs.map((j) => [
          j.id.slice(0, 8),
          statusTag(j.status ?? '?'),
          j.budget_usdc ?? '—',
          (j.description ?? '').slice(0, 60),
        ]),
      );
      return '';
    },
  });
}

export async function jobShowAction(
  jobId: string,
  opts: { json?: boolean },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const all = await client.listJobs();
  const j = (all.jobs ?? []).find((x) => x.id === jobId || x.id.startsWith(jobId));
  if (!j) {
    console.error(`Error: job ${jobId} not found in agent's job list.`);
    process.exit(4);
  }
  emit({
    jsonMode: !!opts.json,
    data: j,
    render: (x) =>
      `id:          ${x.id}\n` +
      `status:      ${statusTag(x.status ?? '?')}\n` +
      `description: ${x.description ?? ''}\n` +
      `budget:      ${x.budget_usdc ?? '—'} USDC`,
  });
}

export async function bidsListAction(
  opts: { json?: boolean; status?: string; since?: string },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const data = await client.listBids({ status: opts.status, since: opts.since });
  emit({
    jsonMode: !!opts.json,
    data,
    render: (d) => {
      if (!d.bids.length) return 'No bids.';
      printTable(
        ['id', 'job', 'amount', 'status', 'created'],
        d.bids.map((b) => [
          b.id.slice(0, 8),
          b.job_id.slice(0, 8),
          b.amount_usdc,
          statusTag(b.status),
          b.created_at,
        ]),
      );
      return '';
    },
  });
}

export async function bidSubmitAction(
  jobId: string,
  opts: { amount: number; eta: number },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const out = await client.submitBid(jobId, opts.amount, opts.eta);
  console.log(`Submitted bid ${(out.bid_id ?? '?').slice(0, 8)} on ${jobId.slice(0, 8)}.`);
}

export async function bidCancelAction(
  _bidId: string,
  _opts: { yes?: boolean },
): Promise<void> {
  console.error(
    'Error: `bid cancel` is not yet available — the backend does not ' +
    'expose DELETE /agents/bids/{id} yet. Tracked as a follow-up.',
  );
  throw new Error('not yet implemented');
}
