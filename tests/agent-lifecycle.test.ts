import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SOTAAgent, SDK_VERSION } from '../src/agent.js';
import { SOTAClient, APIError } from '../src/client.js';
import { AgentError, ErrorCode } from '../src/errors.js';

// --- Constructor & Validation ---

describe('SOTAAgent constructor', () => {
  it('throws if no API key provided', () => {
    delete process.env.SOTA_API_KEY;
    expect(() => new SOTAAgent()).toThrow('API key required');
  });

  it('accepts apiKey via options', () => {
    const agent = new SOTAAgent({ apiKey: 'test-key' });
    expect(agent).toBeDefined();
  });

  it('warns when Supabase env vars not set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    new SOTAAgent({ apiKey: 'test-key' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('realtime disabled'));
    warn.mockRestore();
  });
});

describe('SOTAAgent.setAutoBid', () => {
  it('throws if maxPrice <= 0', () => {
    const agent = new SOTAAgent({ apiKey: 'key' });
    expect(() => agent.setAutoBid({ maxPrice: 0, capabilities: ['test'] })).toThrow('maxPrice');
    expect(() => agent.setAutoBid({ maxPrice: -1, capabilities: ['test'] })).toThrow('maxPrice');
  });

  it('throws if capabilities empty', () => {
    const agent = new SOTAAgent({ apiKey: 'key' });
    expect(() => agent.setAutoBid({ maxPrice: 10, capabilities: [] })).toThrow('capabilities');
  });

  it('accepts valid config with custom estimatedSeconds', () => {
    const agent = new SOTAAgent({ apiKey: 'key' });
    agent.setAutoBid({ maxPrice: 10, capabilities: ['test'], estimatedSeconds: 60 });
    expect((agent as any)._autoBidConfig.estimatedSeconds).toBe(60);
  });
});

// --- SDK Version ---

describe('SDK_VERSION', () => {
  it('is a semver string', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// --- APIError ---

describe('APIError', () => {
  it('has status and detail', () => {
    const err = new APIError(401, 'Invalid API key');
    expect(err.status).toBe(401);
    expect(err.detail).toBe('Invalid API key');
    expect(err.message).toBe('HTTP 401: Invalid API key');
    expect(err).toBeInstanceOf(Error);
  });
});

// --- Client retry behavior ---

describe('SOTAClient retry', () => {
  let client: SOTAClient;

  beforeEach(() => {
    client = new SOTAClient('test-key', 'http://localhost:3001');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    // First call: 500
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 500,
      json: async () => ({ detail: 'Internal error' }),
      text: async () => 'Internal error',
    });
    // Second call: success
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ status: 'ok' }),
    });

    const result = await client.heartbeat();
    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 400', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400,
      json: async () => ({ detail: 'Bad request' }),
      text: async () => 'Bad request',
    });

    await expect(client.heartbeat()).rejects.toThrow('Bad request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 rate limit', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 429,
      json: async () => ({ detail: 'Rate limited' }),
      text: async () => 'Rate limited',
    });
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ status: 'ok' }),
    });

    const result = await client.heartbeat();
    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network error', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ status: 'ok' }),
    });

    const result = await client.heartbeat();
    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// --- Client deliverError ---

describe('SOTAClient.deliverError', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends error fields to deliver endpoint', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ status: 'delivered' }),
    });

    const client = new SOTAClient('key', 'http://localhost:3001');
    await client.deliverError('job-1', ErrorCode.TIMEOUT, 'Timed out', 'partial', true);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      job_id: 'job-1',
      error_code: 'timeout',
      error_message: 'Timed out',
      partial_result: 'partial',
      retryable: true,
    });
  });
});

// --- Client rotateApiKey ---

describe('SOTAClient.rotateApiKey', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('calls POST /api/v1/agents/keys/rotate', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ api_key: 'new-key', message: 'Rotated' }),
    });

    const client = new SOTAClient('old-key', 'http://localhost:3001');
    const result = await client.rotateApiKey();
    expect(result.api_key).toBe('new-key');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/agents/keys/rotate',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// --- Agent handler registration ---

describe('SOTAAgent handlers', () => {
  it('registers multiple job handlers', () => {
    const agent = new SOTAAgent({ apiKey: 'key' });
    const h1 = vi.fn();
    const h2 = vi.fn();
    agent.onJob('scraping', h1);
    agent.onJob('analysis', h2);
    expect((agent as any)._jobHandlers.size).toBe(2);
  });

  it('registers bid handlers separately from job handlers', () => {
    const agent = new SOTAAgent({ apiKey: 'key' });
    agent.onJob('scraping', vi.fn());
    agent.onBidOpportunity('scraping', vi.fn());
    expect((agent as any)._jobHandlers.size).toBe(1);
    expect((agent as any)._bidHandlers.size).toBe(1);
  });

  it('overwrites handler for same capability', () => {
    const agent = new SOTAAgent({ apiKey: 'key' });
    const h1 = vi.fn();
    const h2 = vi.fn();
    agent.onJob('scraping', h1);
    agent.onJob('scraping', h2);
    expect((agent as any)._jobHandlers.get('scraping')).toBe(h2);
  });
});

// --- Token refresh cadence ---

describe('token refresh cadence', () => {
  it('refreshes 3 minutes before JWT expiry, not on a fixed interval', async () => {
    vi.useFakeTimers();
    const agent = new SOTAAgent({ apiKey: 'key' });

    // 900s token => expect refresh at 720s (12 min), not at 600s (10 min).
    (agent as any)._running = true;
    (agent as any)._jwtExpiresAt = Date.now() + 900 * 1000;

    const exchangeSpy = vi
      .spyOn((agent as any)._client, 'exchangeToken')
      .mockResolvedValue({ token: 'new-jwt', expires_in: 900 });

    (agent as any)._scheduleTokenRefresh();

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(exchangeSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    expect(exchangeSpy).toHaveBeenCalledTimes(1);

    (agent as any)._running = false;
    vi.useRealTimers();
  });

  it('falls back to 60s floor when token already near expiry', async () => {
    vi.useFakeTimers();
    const agent = new SOTAAgent({ apiKey: 'key' });

    (agent as any)._running = true;
    (agent as any)._jwtExpiresAt = Date.now() + 30 * 1000; // already past the 3min buffer

    const exchangeSpy = vi
      .spyOn((agent as any)._client, 'exchangeToken')
      .mockResolvedValue({ token: 'new-jwt', expires_in: 900 });

    (agent as any)._scheduleTokenRefresh();

    await vi.advanceTimersByTimeAsync(59_000);
    expect(exchangeSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(exchangeSpy).toHaveBeenCalledTimes(1);

    (agent as any)._running = false;
    vi.useRealTimers();
  });
});

// --- Heartbeat 401 handling ---

describe('heartbeat 401', () => {
  it('sets fatalError and resolves stopPromise on 401, does not reschedule', async () => {
    vi.useFakeTimers();
    const agent = new SOTAAgent({ apiKey: 'key' });

    vi.spyOn((agent as any)._client, 'heartbeat').mockRejectedValue(
      new APIError(401, 'API key revoked'),
    );

    (agent as any)._running = true;
    (agent as any)._stopPromise = new Promise<void>((resolve) => {
      (agent as any)._resolveStop = resolve;
    });

    (agent as any)._scheduleHeartbeat();
    await vi.advanceTimersByTimeAsync(25_001);
    await Promise.resolve(); // flush microtasks so the catch block runs

    expect((agent as any)._running).toBe(false);
    expect((agent as any)._fatalError).toBeInstanceOf(APIError);
    expect(((agent as any)._fatalError as APIError).status).toBe(401);

    // Confirm no further heartbeats scheduled
    const tasksBefore = (agent as any)._heartbeatTimeout;
    await vi.advanceTimersByTimeAsync(60_000);
    expect((agent as any)._heartbeatTimeout).toBe(tasksBefore);

    vi.useRealTimers();
  });

  it('continues after non-auth errors', async () => {
    vi.useFakeTimers();
    const agent = new SOTAAgent({ apiKey: 'key' });

    const hbSpy = vi
      .spyOn((agent as any)._client, 'heartbeat')
      .mockRejectedValueOnce(new APIError(503, 'upstream down'))
      .mockResolvedValue({ status: 'ok' });

    (agent as any)._running = true;
    (agent as any)._stopPromise = new Promise<void>(() => {});

    (agent as any)._scheduleHeartbeat();
    await vi.advanceTimersByTimeAsync(25_001);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25_001);
    await Promise.resolve();

    expect((agent as any)._fatalError).toBeNull();
    expect((agent as any)._running).toBe(true);
    expect(hbSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    (agent as any)._running = false;
    vi.useRealTimers();
  });
});

// --- Webhook replay protection ---

describe('verifyWebhookSignature replay protection', () => {
  it('rejects expired timestamp', async () => {
    const { verifyWebhookSignature } = await import('../src/crypto.js');
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
    const header = `t=${oldTimestamp},v1=deadbeef`;
    expect(await verifyWebhookSignature('payload', header, 'secret')).toBe(false);
  });

  it('rejects future timestamp', async () => {
    const { verifyWebhookSignature } = await import('../src/crypto.js');
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 600);
    const header = `t=${futureTimestamp},v1=deadbeef`;
    expect(await verifyWebhookSignature('payload', header, 'secret')).toBe(false);
  });

  it('rejects malformed header', async () => {
    const { verifyWebhookSignature } = await import('../src/crypto.js');
    expect(await verifyWebhookSignature('payload', 'garbage', 'secret')).toBe(false);
    expect(await verifyWebhookSignature('payload', 't=abc', 'secret')).toBe(false);
    expect(await verifyWebhookSignature('payload', '', 'secret')).toBe(false);
  });
});
