import { describe, it, expect, vi } from 'vitest';
import {
  doctorAction,
  capabilitiesAction,
  onboardAction,
} from '../src/cli_commands/reputation_diag.js';

describe('capabilities', () => {
  it('prints available_capabilities from /onboard', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({
        available_capabilities: ['code-review', 'web-scraping'],
      }), { status: 200 })),
    );
    await capabilitiesAction({ json: true });
    const out = JSON.parse(spy.mock.calls[0][0] as string);
    expect(out.available_capabilities).toContain('code-review');
    spy.mockRestore();
  });
});

describe('onboard', () => {
  it('prints onboard.md body', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response('# SOTA Onboard\n...', { status: 200 })),
    );
    await onboardAction();
    expect(spy.mock.calls[0][0]).toContain('SOTA Onboard');
    spy.mockRestore();
  });
});

describe('doctor', () => {
  it('runs all checks without crashing when all green', async () => {
    process.env.SOTA_API_KEY = 'k';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) // /api/health
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'a1', name: 'alpha', status: 'active',
        capabilities: [], created_at: '2026-04-22T00:00:00Z',
      }), { status: 200 })) // getProfile
      .mockResolvedValueOnce(new Response(JSON.stringify({
        available_capabilities: ['code-review'],
      }), { status: 200 })); // /onboard
    await doctorAction();
    const out = spy.mock.calls.map(c => String(c[0])).join('\n');
    expect(out).toContain('API key');
    expect(out).toContain('Backend');
    expect(out).toContain('Onboard');
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});
