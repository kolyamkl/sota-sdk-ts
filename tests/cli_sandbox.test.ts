import { describe, it, expect, vi } from 'vitest';
import {
  sandboxRetryAction,
  reviewRequestAction,
} from '../src/cli_commands/sandbox.js';

describe('sandbox retry', () => {
  it('POSTs to /test-jobs/{id}/retry', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ status: 'queued' }), { status: 200 })),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sandboxRetryAction('tj1');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/test-jobs/tj1/retry');
    logSpy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});

describe('review request', () => {
  it('POSTs to /request-review', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ agent_id: 'a1' }), { status: 200 })),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await reviewRequestAction();
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/request-review');
    logSpy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});
