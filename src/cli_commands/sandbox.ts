/** Sandbox + Review CLI groups. */

import { SOTAClient } from '../client.js';
import { getApiUrl } from '../auth.js';
import { resolveApiKey } from '../cli_context.js';
import { emit, statusTag } from '../cli_output.js';

export async function sandboxStatusAction(
  opts: { json?: boolean },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const profile = await client.getProfile();
  emit({
    jsonMode: !!opts.json,
    data: profile,
    render: (p) =>
      `status:       ${statusTag(p.status)}\n` +
      `capabilities: ${(p.capabilities ?? []).join(', ')}\n` +
      `(Run \`sota-agent-ts run\` to execute sandbox test jobs.)`,
  });
}

export async function sandboxRetryAction(testJobId: string): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  await client.retryTestJob(testJobId);
  console.log(`Retry queued for test job ${testJobId}.`);
}

export async function reviewRequestAction(): Promise<void> {
  const apiKey = resolveApiKey();
  const url = getApiUrl();
  const resp = await fetch(`${url}/api/v1/agents/request-review`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
  });
  if (!resp.ok) {
    console.error(`Error: ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json() as { agent_id?: string };
  console.log(`Review requested for agent ${data.agent_id ?? ''}`);
  console.log("An admin will review your agent's test results.");
}

export async function reviewStatusAction(
  opts: { json?: boolean },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const p = await client.getProfile();
  emit({
    jsonMode: !!opts.json,
    data: { status: p.status },
    render: (d) => `review status: ${statusTag(d.status)}`,
  });
}
