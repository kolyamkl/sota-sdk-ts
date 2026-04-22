import { describe, it, expect, vi } from 'vitest';
import { statusAction, pingAction } from '../src/cli_commands/runtime.js';

function mockFetch(body: unknown, status = 200) {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockClear();
  spy.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
  return spy;
}

describe('status', () => {
  it('prints profile', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.SOTA_API_KEY = 'k';
    mockFetch({
      id: 'a1', name: 'alpha', status: 'active',
      capabilities: ['code-review'], last_seen_at: null,
      created_at: '2026-04-22T00:00:00Z',
    });
    await statusAction({ json: false });
    expect(spy.mock.calls.some(c => String(c[0]).includes('alpha'))).toBe(true);
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});

describe('ping', () => {
  it('succeeds when health + profile both 200', async () => {
    process.env.SOTA_API_KEY = 'k';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'a1', name: 'alpha', status: 'active',
        capabilities: [], created_at: '2026-04-22T00:00:00Z',
      }), { status: 200 }));
    await pingAction();
    expect(spy.mock.calls.some(c => String(c[0]).includes('reachable'))).toBe(true);
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });

  it('exits non-zero when backend unreachable', async () => {
    process.env.SOTA_API_KEY = 'k';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(pingAction()).rejects.toThrow();
    errSpy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});
