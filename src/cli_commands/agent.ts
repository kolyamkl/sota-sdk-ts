/** Agent CRUD CLI group. */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

import { SOTAClient } from '../client.js';
import { loadCredentials, getApiUrl } from '../auth.js';
import { resolveApiKey } from '../cli_context.js';
import { emit, printTable, statusTag } from '../cli_output.js';

const EDITABLE_FIELDS = new Set([
  'name',
  'description',
  'capabilities',
  'webhook_url',
  'icon_url',
  'wallet_address',
]);

const LIST_FIELDS = new Set(['capabilities']);

function getJwt(override?: string): string {
  if (override) return override;
  const creds = loadCredentials();
  if (!creds) {
    throw new Error('Not logged in. Run `sota-agent-ts login` first.');
  }
  return creds.access_token;
}

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N]: `, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 'y');
    });
  });
}

export async function agentListAction(
  opts: { json?: boolean; status?: string; includeDeleted?: boolean; jwt?: string },
): Promise<void> {
  const client = new SOTAClient('unused-for-jwt-endpoints', getApiUrl());
  client.setJwt(getJwt(opts.jwt));
  const data = await client.listAgents({
    status: opts.status,
    includeDeleted: opts.includeDeleted,
  });
  emit({
    jsonMode: !!opts.json,
    data,
    render: (d) => {
      if (!d.agents.length) return 'No agents.';
      printTable(
        ['name', 'id', 'status', 'caps', 'last_seen'],
        d.agents.map((a) => [
          a.name,
          a.id.slice(0, 8),
          statusTag(a.status),
          a.capabilities.join(','),
          a.last_seen_at ?? 'never',
        ]),
      );
      return '';
    },
  });
}

export async function agentDeleteAction(
  idOrName: string,
  opts: { yes?: boolean; jwt?: string },
): Promise<void> {
  if (!opts.yes) {
    const ok = await confirm(`Soft-delete agent "${idOrName}"?`);
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }
  const client = new SOTAClient('unused', getApiUrl());
  client.setJwt(getJwt(opts.jwt));
  const result = await client.deleteAgent(idOrName);
  console.log(`Deleted agent ${result.agent_id}`);
}

export async function agentShowAction(
  _idOrName: string | undefined,
  opts: { json?: boolean },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const profile = await client.getProfile();
  emit({
    jsonMode: !!opts.json,
    data: profile,
    render: (p) =>
      `${p.name} [${p.id.slice(0, 8)}]\n` +
      `  status:       ${statusTag(p.status)}\n` +
      `  capabilities: ${(p.capabilities ?? []).join(', ')}\n` +
      `  description:  ${p.description ?? '(none)'}\n` +
      `  wallet:       ${p.wallet_address ?? '(none)'}\n` +
      `  webhook:      ${p.webhook_url ?? '(none)'}\n` +
      `  created:      ${p.created_at}`,
  });
}

export async function agentSetAction(
  field: string,
  value: string,
  opts: { json?: boolean },
): Promise<void> {
  if (!EDITABLE_FIELDS.has(field)) {
    throw new Error(
      `Unknown field "${field}". Allowed: ${[...EDITABLE_FIELDS].join(', ')}`,
    );
  }
  const payload: Record<string, unknown> = {};
  if (LIST_FIELDS.has(field)) {
    payload[field] = value.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (value === '-' || value === '') {
    payload[field] = null;
  } else {
    payload[field] = value;
  }
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const updated = await client.updateProfile(payload);
  emit({
    jsonMode: !!opts.json,
    data: updated,
    render: () => `Updated ${field}.`,
  });
  if (field === 'capabilities' && (updated as { sandbox_regate?: boolean }).sandbox_regate) {
    console.log('Note: capability change re-triggered sandbox. Status is now: sandbox.');
  }
}

export async function agentEditAction(
  _idOrName: string | undefined,
  opts: { yes?: boolean },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const profile = await client.getProfile();

  const editable = {
    name: profile.name,
    description: profile.description ?? '',
    capabilities: profile.capabilities,
    webhook_url: profile.webhook_url ?? '',
    icon_url: profile.icon_url ?? '',
    wallet_address: profile.wallet_address ?? '',
  };

  const nonce = randomBytes(6).toString('hex');
  const tmpPath = join(tmpdir(), `sota-agent-edit-${nonce}.yaml`);
  writeFileSync(
    tmpPath,
    '# Edit editable fields, save and close. Empty lines/comments ignored.\n' +
    yamlStringify(editable),
  );
  try {
    const editor = process.env.EDITOR ?? 'vi';
    const res = spawnSync(editor, [tmpPath], { stdio: 'inherit' });
    if (res.status !== 0) {
      console.log('Editor exited non-zero; aborting.');
      return;
    }
    const after = yamlParse(readFileSync(tmpPath, 'utf-8')) as Record<string, unknown>;
    const diff: Record<string, unknown> = {};
    for (const k of Object.keys(editable) as Array<keyof typeof editable>) {
      const before = editable[k];
      const next = after[k];
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        diff[k] = next === '' ? null : next;
      }
    }
    if (Object.keys(diff).length === 0) {
      console.log('No changes.');
      return;
    }
    if ('capabilities' in diff && !opts.yes) {
      const ok = await confirm(
        'Changing capabilities will re-trigger sandbox testing. Continue?',
      );
      if (!ok) {
        console.log('Aborted.');
        return;
      }
    }
    const updated = await client.updateProfile(diff);
    console.log('Updated:', Object.keys(diff).join(', '));
    if ((updated as { sandbox_regate?: boolean }).sandbox_regate) {
      console.log('Note: status is now: sandbox (capability re-gate).');
    }
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

export async function agentSwitchAction(
  _idOrName: string,
  _opts: { yes?: boolean; jwt?: string },
): Promise<void> {
  // v1 stub — backend GET /agents/{id}/credentials endpoint pending.
  console.error(
    'Error: `agent switch` requires per-agent credential fetch ' +
    'from backend. Tracked as follow-up `GET /agents/{id}/credentials`. ' +
    "For now: cd into each agent's project dir and rely on its .env.",
  );
  throw new Error('not implemented (backend endpoint pending)');
}

export async function agentRegisterAction(
  opts: {
    name?: string;
    caps?: string;
    wallet?: string;
    desc?: string;
    webhook?: string;
    jwt?: string;
  },
): Promise<void> {
  if (!opts.name) throw new Error('--name is required');
  const capabilities = (opts.caps ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (capabilities.length === 0) throw new Error('--caps required (comma list)');
  const jwt = getJwt(opts.jwt);
  const result = await SOTAClient.registerAgent(getApiUrl(), jwt, {
    name: opts.name,
    capabilities,
    description: opts.desc,
    wallet_address: opts.wallet,
    webhook_url: opts.webhook,
  });
  console.log(`Registered agent ${result.agent_id}`);
  console.log(`  API key:      ${result.api_key}`);
  console.log(`  Webhook secret: ${result.webhook_secret}`);
  console.log('\nWrite these to your agent project\'s .env and run `npm start`.');
}
