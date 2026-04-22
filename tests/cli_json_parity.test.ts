import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentListAction } from '../src/cli_commands/agent.js';
import { bidsListAction } from '../src/cli_commands/jobs_bids.js';
import { keysListAction } from '../src/cli_commands/keys.js';
import { logsAction } from '../src/cli_commands/runtime.js';

const __filename = fileURLToPath(import.meta.url);
const GOLDEN = join(dirname(__filename), 'golden/cli_json');

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(GOLDEN, name), 'utf-8'));
}
function readText(name: string): string {
  return readFileSync(join(GOLDEN, name), 'utf-8');
}

describe('CLI --json parity vs Python plan fixtures', () => {
  it('agent list matches golden', async () => {
    const fixture = readJson('agent_list.fixture.json');
    const expected = readJson('agent_list.expected.json');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })),
    );
    await agentListAction({ json: true, jwt: 'fake-jwt' });
    const got = JSON.parse(spy.mock.calls[0][0] as string);
    expect(got).toEqual(expected);
    spy.mockRestore();
  });

  it('bids list matches golden', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fixture = readJson('bids_list.fixture.json');
    const expected = readJson('bids_list.expected.json');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })),
    );
    await bidsListAction({ json: true });
    const got = JSON.parse(spy.mock.calls[0][0] as string);
    expect(got).toEqual(expected);
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });

  it('keys list matches golden', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fixture = readJson('keys_list.fixture.json');
    const expected = readJson('keys_list.expected.json');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })),
    );
    await keysListAction({ json: true });
    const got = JSON.parse(spy.mock.calls[0][0] as string);
    expect(got).toEqual(expected);
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });

  it('logs NDJSON matches golden', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fixture = readJson('activity_log.fixture.json') as { entries: unknown[] };
    const expectedLines = readText('activity_log.expected.ndjson')
      .trim().split('\n');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({
        entries: fixture.entries, next_since_id: null,
      }), { status: 200 })),
    );
    await logsAction({ follow: false, json: true, interval: 0.01, limit: 200 });
    const got = spy.mock.calls.map((c) => String(c[0]));
    expect(got).toHaveLength(expectedLines.length);
    for (let i = 0; i < got.length; i++) {
      expect(JSON.parse(got[i])).toEqual(JSON.parse(expectedLines[i]));
    }
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});
