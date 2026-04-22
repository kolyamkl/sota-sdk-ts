import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { SOTAClient } from '../client.js';
import { getApiUrl, loadCredentials } from '../auth.js';
import { resolveApiKey, atomicReplaceEnvVar } from '../cli_context.js';
import { emit, printTable } from '../cli_output.js';

function confirm(q: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${q} [y/N]: `, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 'y');
    });
  });
}

export async function keysListAction(
  opts: { json?: boolean; includeRevoked?: boolean },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const data = await client.listKeys({ includeRevoked: opts.includeRevoked });
  emit({
    jsonMode: !!opts.json,
    data,
    render: (d) => {
      if (!d.keys.length) return 'No keys.';
      printTable(
        ['id', 'label', 'prefix', 'active', 'created', 'expires'],
        d.keys.map((k) => [
          k.id.slice(0, 8),
          k.label ?? '—',
          k.key_prefix,
          k.revoked_at === null ? 'yes' : 'no',
          k.created_at,
          k.expires_at ?? 'never',
        ]),
      );
      return '';
    },
  });
}

export async function keysRotateAction(): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const result = await client.rotateApiKey();
  atomicReplaceEnvVar(join(process.cwd(), '.env'), 'SOTA_API_KEY', result.api_key);
  console.log('Key rotated. New key written to .env (backup: .env.bak).');
  console.log('Old key valid for 60s — restart your agent process to pick up the new key.');
}

export async function keysCreateAction(
  opts: { label?: string; expiresDays?: number; json?: boolean },
): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    console.error('Error: not logged in. Run `sota-agent-ts login` first.');
    process.exit(3);
  }
  const client = new SOTAClient('unused', getApiUrl());
  client.setJwt(creds.access_token);
  const apiKey = resolveApiKey();
  const keyClient = new SOTAClient(apiKey, getApiUrl());
  const profile = await keyClient.getProfile();
  const result = await client.createApiKey(profile.id, {
    label: opts.label,
    expiresDays: opts.expiresDays,
  });
  emit({
    jsonMode: !!opts.json,
    data: result,
    render: (r) =>
      `Created key.\n` +
      `  id:         ${r.key_id}\n` +
      `  api_key:    ${r.api_key}   ← save this now; it will not be shown again\n` +
      `  expires_at: ${r.expires_at}`,
  });
}

export async function keysRevokeAction(
  keyId: string,
  opts: { yes?: boolean },
): Promise<void> {
  if (!opts.yes) {
    const ok = await confirm(`Revoke key ${keyId}?`);
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const result = await client.revokeKey(keyId);
  console.log(`Revoked key ${result.key_id}.`);
}
