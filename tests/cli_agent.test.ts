import { describe, it, expect, vi } from 'vitest';
import {
  agentListAction,
  agentDeleteAction,
  agentShowAction,
  agentSetAction,
} from '../src/cli_commands/agent.js';

function mockFetch(body: unknown, status = 200) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
    () => Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
  spy.mockClear();
  return spy;
}

describe('agent list', () => {
  it('prints JSON when --json', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockFetch({
      agents: [
        { id: 'a1', name: 'alpha', status: 'active',
          capabilities: ['code-review'], last_seen_at: null,
          created_at: '2026-04-22T00:00:00Z' },
      ],
      total: 1,
    });
    await agentListAction({ json: true, jwt: 'fake-jwt' });
    expect(JSON.parse(spy.mock.calls[0][0] as string).agents[0].name).toBe('alpha');
    spy.mockRestore();
  });
});

describe('agent delete', () => {
  it('sends DELETE and prints confirmation when --yes', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = mockFetch({ deleted: true, agent_id: 'a1' });
    await agentDeleteAction('a1', { yes: true, jwt: 'fake-jwt' });
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('DELETE');
    expect(spy.mock.calls.some(c => String(c[0]).includes('Deleted'))).toBe(true);
    spy.mockRestore();
  });
});

describe('agent set', () => {
  it('splits comma values for capabilities', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fetchSpy = mockFetch({ id: 'a1', capabilities: ['a', 'b'] });
    await agentSetAction('capabilities', 'a,b', { json: false });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.capabilities).toEqual(['a', 'b']);
    delete process.env.SOTA_API_KEY;
  });

  it('sends string verbatim for non-list fields', async () => {
    process.env.SOTA_API_KEY = 'k';
    const fetchSpy = mockFetch({ id: 'a1', description: 'new' });
    await agentSetAction('description', 'new', { json: false });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.description).toBe('new');
    delete process.env.SOTA_API_KEY;
  });

  it('rejects unknown fields', async () => {
    await expect(
      agentSetAction('badfield', 'x', { json: false }),
    ).rejects.toThrow(/field/);
  });
});

describe('agent show', () => {
  it('returns current agent via GET /agents/me', async () => {
    process.env.SOTA_API_KEY = 'k';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockFetch({
      id: 'a1', name: 'alpha', capabilities: ['code-review'],
      status: 'active', created_at: '2026-04-22T00:00:00Z',
    });
    await agentShowAction(undefined, { json: true });
    const out = JSON.parse(spy.mock.calls[0][0] as string);
    expect(out.name).toBe('alpha');
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});
