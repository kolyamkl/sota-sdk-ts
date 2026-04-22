import { describe, it, expect, vi } from 'vitest';
import {
  jobsListAction,
  bidsListAction,
  bidSubmitAction,
  bidCancelAction,
} from '../src/cli_commands/jobs_bids.js';

function mockFetch(body: unknown) {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockClear();
  spy.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  );
  return spy;
}

describe('jobs list', () => {
  it('respects --limit (client-side trim)', async () => {
    process.env.SOTA_API_KEY = 'k';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockFetch({ jobs: [
      { id: 'j1', status: 'pending', budget_usdc: 1, description: 'a' },
      { id: 'j2', status: 'pending', budget_usdc: 2, description: 'b' },
      { id: 'j3', status: 'pending', budget_usdc: 3, description: 'c' },
    ]});
    await jobsListAction({ json: true, limit: 2 });
    const out = JSON.parse(spy.mock.calls[0][0] as string);
    expect(out.jobs).toHaveLength(2);
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});

describe('bids list', () => {
  it('passes status filter', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fetchSpy = mockFetch({ bids: [], total: 0 });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await bidsListAction({ json: true, status: 'won' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('status=won');
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});

describe('bid submit', () => {
  it('POSTs amount_usdc + estimated_seconds', async () => {
    process.env.SOTA_API_KEY = 'k';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = mockFetch({ bid_id: 'b1' });
    await bidSubmitAction('j1', { amount: 5, eta: 300 });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.amount_usdc).toBe(5);
    expect(body.estimated_seconds).toBe(300);
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});

describe('bid cancel', () => {
  it('surfaces backend-pending stub error', async () => {
    await expect(bidCancelAction('b1', { yes: true })).rejects.toThrow(/not yet/i);
  });
});
