import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SOTAClient } from '../src/client.js';
import { SOTAAgent } from '../src/agent.js';
import { AgentError, ErrorCode } from '../src/errors.js';
import { verifyWebhookSignature } from '../src/crypto.js';

// --- SOTAClient tests ---

describe('SOTAClient', () => {
  let client: SOTAClient;

  beforeEach(() => {
    client = new SOTAClient('test-api-key', 'http://localhost:3001');
    vi.stubGlobal('fetch', vi.fn());
  });

  function mockFetch(body: unknown, status = 200) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  it('sets X-API-Key header from api_key param', async () => {
    mockFetch({ id: '1', name: 'test' });
    await client.getProfile();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'test-api-key' }),
      }),
    );
  });

  it('getProfile() calls GET /api/v1/agents/me', async () => {
    mockFetch({ id: '1', name: 'test', capabilities: [], status: 'active', created_at: '' });
    await client.getProfile();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/agents/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('submitBid calls POST /api/v1/agents/bid', async () => {
    mockFetch({ status: 'bid_accepted' });
    await client.submitBid('job-1', 5.0, 120);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/agents/bid',
      expect.objectContaining({ method: 'POST' }),
    );
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({ job_id: 'job-1', amount_usdc: 5.0, estimated_seconds: 120 });
  });

  it('deliver calls POST /api/v1/agents/deliver', async () => {
    mockFetch({ status: 'ok' });
    await client.deliver('job-1', 'result-data');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/agents/deliver',
      expect.objectContaining({ method: 'POST' }),
    );
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({ job_id: 'job-1', result: 'result-data' });
  });

  it('exchangeToken calls POST /api/v1/agents/token', async () => {
    mockFetch({ token: 'jwt-token', expires_in: 900 });
    const resp = await client.exchangeToken();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/agents/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(resp.token).toBe('jwt-token');
  });

  it('heartbeat calls POST /api/v1/agents/heartbeat', async () => {
    mockFetch({ status: 'ok' });
    await client.heartbeat();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/agents/heartbeat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reportProgress calls POST /api/v1/agents/progress', async () => {
    mockFetch({ status: 'ok' });
    await client.reportProgress('job-1', 50, 'halfway');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/agents/progress',
      expect.objectContaining({ method: 'POST' }),
    );
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toEqual({ job_id: 'job-1', percent: 50, level: 'info', message: 'halfway' });
  });
});

// --- ErrorCode & AgentError tests ---

describe('ErrorCode', () => {
  it('has all 6 values', () => {
    expect(ErrorCode.TIMEOUT).toBe('timeout');
    expect(ErrorCode.RESOURCE_UNAVAILABLE).toBe('resource_unavailable');
    expect(ErrorCode.AUTHENTICATION_FAILED).toBe('authentication_failed');
    expect(ErrorCode.INVALID_INPUT).toBe('invalid_input');
    expect(ErrorCode.INTERNAL_ERROR).toBe('internal_error');
    expect(ErrorCode.RATE_LIMITED).toBe('rate_limited');
  });
});

describe('AgentError', () => {
  it('has code, message, partialResult, retryable properties', () => {
    const err = new AgentError({
      code: ErrorCode.TIMEOUT,
      message: 'Request timed out',
      partialResult: 'partial data',
      retryable: true,
    });
    expect(err.code).toBe(ErrorCode.TIMEOUT);
    expect(err.message).toBe('Request timed out');
    expect(err.partialResult).toBe('partial data');
    expect(err.retryable).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });
});

// --- SOTAAgent tests ---

describe('SOTAAgent', () => {
  it('onJob registers handler for capability', () => {
    const agent = new SOTAAgent({ apiKey: 'key' });
    const handler = vi.fn();
    agent.onJob('web-scraping', handler);
    // Access internal handlers to verify registration
    expect((agent as any)._jobHandlers.get('web-scraping')).toBe(handler);
  });

  it('setAutoBid stores config', () => {
    const agent = new SOTAAgent({ apiKey: 'key' });
    agent.setAutoBid({ maxPrice: 10, capabilities: ['data-analysis'] });
    expect((agent as any)._autoBidConfig).toEqual({
      maxPrice: 10,
      capabilities: ['data-analysis'],
    });
  });
});

// --- Webhook signature verification ---

describe('verifyWebhookSignature', () => {
  it('returns true for valid signature', async () => {
    const secret = 'test-secret';
    const payload = '{"event":"job_assigned"}';
    const timestamp = String(Math.floor(Date.now() / 1000));

    // Compute expected HMAC
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${timestamp}.${payload}`),
    );
    const hexSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const header = `t=${timestamp},v1=${hexSig}`;

    expect(await verifyWebhookSignature(payload, header, secret)).toBe(true);
  });

  it('returns false for invalid secret', async () => {
    const header = 't=1710000000,v1=deadbeef';
    const payload = '{"event":"job_assigned"}';
    expect(await verifyWebhookSignature(payload, header, 'wrong-secret')).toBe(false);
  });
});
