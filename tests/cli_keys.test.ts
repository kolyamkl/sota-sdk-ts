import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  keysListAction,
  keysRotateAction,
  keysRevokeAction,
} from '../src/cli_commands/keys.js';

describe('keys list', () => {
  it('prints table', async () => {
    process.env.SOTA_API_KEY = 'k';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ keys: [
        { id: 'k1', label: 'primary', key_prefix: 'sota_abc',
          created_at: '2026-04-22T00:00:00Z', expires_at: null,
          revoked_at: null, last_used_at: null },
      ]}), { status: 200 })),
    );
    await keysListAction({ json: true });
    const out = JSON.parse(spy.mock.calls[0][0] as string);
    expect(out.keys[0].key_prefix).toBe('sota_abc');
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});

describe('keys rotate', () => {
  it('rewrites .env atomically', async () => {
    const origCwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'sota-keys-'));
    writeFileSync(join(dir, '.env'), 'SOTA_API_KEY=old\nOTHER=keep\n');
    process.chdir(dir);
    process.env.SOTA_API_KEY = 'old';

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ api_key: 'new-key',
        message: 'rotated' }), { status: 200 })),
    );

    await keysRotateAction();

    const env = readFileSync(join(dir, '.env'), 'utf-8');
    expect(env).toContain('SOTA_API_KEY=new-key');
    expect(env).toContain('OTHER=keep');
    expect(existsSync(join(dir, '.env.bak'))).toBe(true);

    logSpy.mockRestore();
    process.chdir(origCwd);
    delete process.env.SOTA_API_KEY;
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('keys revoke', () => {
  it('POSTs to revoke endpoint when --yes', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ revoked: true, key_id: 'k1' }),
        { status: 200 })),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await keysRevokeAction('k1', { yes: true });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/v1/agents/keys/k1/revoke');
    logSpy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});
