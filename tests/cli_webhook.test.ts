import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { webhookVerifyAction, webhookTestAction } from '../src/cli_commands/webhook.js';

describe('webhook verify', () => {
  it('verifies a correctly-signed body against raw bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'webhook-'));
    const body = Buffer.from('{"job_id":"abc"}');
    const path = join(dir, 'body.json');
    writeFileSync(path, body);

    const secret = 'test-secret';
    const sig = createHmac('sha256', secret).update(body).digest('hex');

    const origSecret = process.env.SOTA_WEBHOOK_SECRET;
    process.env.SOTA_WEBHOOK_SECRET = secret;

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await webhookVerifyAction(path, { sig });
    expect(spy.mock.calls.some(c => String(c[0]).toLowerCase().includes('valid')))
      .toBe(true);
    spy.mockRestore();

    if (origSecret !== undefined) process.env.SOTA_WEBHOOK_SECRET = origSecret;
    else delete process.env.SOTA_WEBHOOK_SECRET;
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a wrong signature', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'webhook-'));
    const body = Buffer.from('{"job_id":"abc"}');
    const path = join(dir, 'body.json');
    writeFileSync(path, body);

    const origSecret = process.env.SOTA_WEBHOOK_SECRET;
    process.env.SOTA_WEBHOOK_SECRET = 'test-secret';

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      webhookVerifyAction(path, { sig: 'deadbeef' }),
    ).rejects.toThrow();
    errSpy.mockRestore();

    if (origSecret !== undefined) process.env.SOTA_WEBHOOK_SECRET = origSecret;
    else delete process.env.SOTA_WEBHOOK_SECRET;
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('webhook test', () => {
  it('POSTs synthetic signed body to url', async () => {
    process.env.SOTA_WEBHOOK_SECRET = 'test-secret';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await webhookTestAction({ url: 'http://localhost:8787', jobId: 'abc' });
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://localhost:8787');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-SOTA-Signature']).toBeDefined();
    logSpy.mockRestore();
    delete process.env.SOTA_WEBHOOK_SECRET;
  });
});
