import { SOTAClient } from '../client.js';
import { getApiUrl } from '../auth.js';
import { resolveApiKey } from '../cli_context.js';
import { emit } from '../cli_output.js';

export async function reputationAction(
  opts: { json?: boolean },
): Promise<void> {
  const apiKey = resolveApiKey();
  const client = new SOTAClient(apiKey, getApiUrl());
  const profile = await client.getProfile();
  const rep = await client.getReputation(profile.id);
  emit({
    jsonMode: !!opts.json,
    data: rep,
    render: (r) => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join('\n'),
  });
}

export async function doctorAction(): Promise<void> {
  type Check = readonly [name: string, ok: boolean, detail: string];
  const checks: Check[] = [];

  let apiKey: string | null = null;
  try {
    apiKey = resolveApiKey();
    checks.push(['API key present', true, `${apiKey.slice(0, 8)}…`] as const);
  } catch (e) {
    checks.push(['API key present', false,
      e instanceof Error ? e.message : String(e)] as const);
  }

  const url = getApiUrl();
  let backendOk = false;
  try {
    const r = await fetch(`${url}/api/health`);
    if (!r.ok) throw new Error(`status ${r.status}`);
    backendOk = true;
    checks.push(['Backend reachable', true, url] as const);
  } catch (e) {
    checks.push(['Backend reachable', false,
      e instanceof Error ? e.message : String(e)] as const);
  }

  if (apiKey && backendOk) {
    try {
      const client = new SOTAClient(apiKey, url);
      const p = await client.getProfile();
      checks.push(['API key valid', true,
        `${p.name} (${p.status})`] as const);
    } catch (e) {
      checks.push(['API key valid', false,
        e instanceof Error ? e.message : String(e)] as const);
    }
  } else {
    checks.push(['API key valid', false,
      'skipped (missing key or backend unreachable)'] as const);
  }

  try {
    const r = await fetch(`${url}/api/v1/onboard`);
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json() as { available_capabilities?: string[] };
    checks.push(['Onboard info', true,
      `${(data.available_capabilities ?? []).length} capabilities`] as const);
  } catch (e) {
    checks.push(['Onboard info', false,
      e instanceof Error ? e.message : String(e)] as const);
  }

  const allOk = checks.every((c) => c[1]);
  for (const [name, ok, detail] of checks) {
    const mark = ok ? '✓' : '✗';
    console.log(`  ${mark} ${name}: ${detail}`);
  }
  console.log('');
  if (allOk) {
    console.log('All checks passed.');
  } else {
    console.error('Issues found. Fix the ✗ items above.');
    process.exit(1);
  }
}

export async function capabilitiesAction(
  opts: { json?: boolean },
): Promise<void> {
  const r = await fetch(`${getApiUrl()}/api/v1/onboard`);
  if (!r.ok) {
    console.error(`Error: ${await r.text()}`);
    process.exit(5);
  }
  const data = await r.json() as { available_capabilities?: string[] };
  const caps = data.available_capabilities ?? [];
  emit({
    jsonMode: !!opts.json,
    data: { available_capabilities: caps },
    render: (d) =>
      'Available capabilities:\n  - ' + d.available_capabilities.join('\n  - '),
  });
}

export async function onboardAction(): Promise<void> {
  const r = await fetch(`${getApiUrl()}/onboard.md`);
  if (!r.ok) {
    console.error(`Error: ${await r.text()}`);
    process.exit(5);
  }
  console.log(await r.text());
}
