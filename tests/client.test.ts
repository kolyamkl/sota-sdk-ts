import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SOTAClient } from '../src/client.js';

describe('SOTAClient.reportProgress level', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults level to "info"', async () => {
    const client = new SOTAClient('k', 'http://localhost:3001');
    await client.reportProgress('j1', 50, 'halfway');
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.level).toBe('info');
  });

  it('sends warn level when passed', async () => {
    const client = new SOTAClient('k', 'http://localhost:3001');
    await client.reportProgress('j1', 60, 'slow', 'warn');
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.level).toBe('warn');
  });

  it('rejects bad level', async () => {
    const client = new SOTAClient('k', 'http://localhost:3001');
    await expect(
      client.reportProgress('j1', 1, 'x', 'badlevel' as never),
    ).rejects.toThrow(/level/);
  });
});

describe('SOTAClient new methods', () => {
  function mkResp(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setJwt + listAgents sends Bearer header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mkResp({ agents: [], total: 0 }),
    );
    const client = new SOTAClient('k', 'http://localhost:3001');
    client.setJwt('fake-jwt');
    await client.listAgents({ status: 'active' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/agents');
    expect(String(url)).toContain('status=active');
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
      Authorization: 'Bearer fake-jwt',
    });
  });

  it('listAgents without JWT throws', async () => {
    const client = new SOTAClient('k', 'http://localhost:3001');
    await expect(client.listAgents()).rejects.toThrow(/jwt/i);
  });

  it('deleteAgent sends DELETE with JWT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mkResp({ deleted: true, agent_id: 'a1' }),
    );
    const client = new SOTAClient('k', 'http://localhost:3001');
    client.setJwt('fake-jwt');
    const r = await client.deleteAgent('a1');
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('DELETE');
    expect(r.deleted).toBe(true);
  });

  it('listBids passes status as query param', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mkResp({ bids: [], total: 0 }),
    );
    const client = new SOTAClient('k', 'http://localhost:3001');
    await client.listBids({ status: 'won' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('status=won');
  });

  it('listKeys passes include_revoked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mkResp({ keys: [] }),
    );
    const client = new SOTAClient('k', 'http://localhost:3001');
    await client.listKeys({ includeRevoked: true });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('include_revoked=true');
  });

  it('revokeKey POSTs to /keys/{id}/revoke', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mkResp({ revoked: true, key_id: 'k1' }),
    );
    const client = new SOTAClient('k', 'http://localhost:3001');
    const r = await client.revokeKey('k1');
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/v1/agents/keys/k1/revoke');
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST');
    expect(r.revoked).toBe(true);
  });

  it('getActivityLog passes since_id and limit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mkResp({ entries: [], next_since_id: null }),
    );
    const client = new SOTAClient('k', 'http://localhost:3001');
    await client.getActivityLog({ sinceId: 42, limit: 50 });
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('since_id=42');
    expect(url).toContain('limit=50');
  });
});
