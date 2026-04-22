import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { logoutAction, versionAction, whoamiAction } from '../src/cli_commands/identity.js';

describe('logout', () => {
  let home: string;
  const origHome = process.env.HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sota-home-'));
    process.env.HOME = home;
  });

  afterEach(() => {
    if (origHome) process.env.HOME = origHome;
    else delete process.env.HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it('deletes ~/.sota/credentials when present (yes flag)', async () => {
    const dir = join(home, '.sota');
    mkdirSync(dir, { recursive: true });
    const credPath = join(dir, 'credentials');
    writeFileSync(credPath, JSON.stringify({ access_token: 'x' }));
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await logoutAction({ yes: true });
    expect(existsSync(credPath)).toBe(false);
    spy.mockRestore();
  });

  it('no-ops gracefully when credentials file missing', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(logoutAction({ yes: true })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('version', () => {
  it('prints SDK version and does not throw when backend unreachable', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'));
    await versionAction();
    expect(spy.mock.calls.some(c => String(c[0]).includes('sota-agent-ts'))).toBe(true);
    spy.mockRestore();
    fetchSpy.mockRestore();
  });
});

describe('whoami', () => {
  it('throws when no credentials exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sota-home-'));
    const origHome = process.env.HOME;
    process.env.HOME = home;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(whoamiAction({ json: false })).rejects.toThrow();

    if (origHome) process.env.HOME = origHome;
    else delete process.env.HOME;
    rmSync(home, { recursive: true, force: true });
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
