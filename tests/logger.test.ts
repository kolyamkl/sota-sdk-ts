import { describe, it, expect, vi } from 'vitest';
import { JobLogger, NoopJobLogger } from '../src/logger.js';

function makeClientMock() {
  return {
    reportProgress: vi.fn().mockResolvedValue({ status: 'ok' }),
  };
}

describe('JobLogger', () => {
  it('info delegates to reportProgress with level=info and percent=0', async () => {
    const client = makeClientMock();
    const log = new JobLogger('j1', client as never);
    await log.info('parsing request');
    expect(client.reportProgress).toHaveBeenCalledWith(
      'j1', 0, 'parsing request', 'info',
    );
  });

  it('warn sends level=warn', async () => {
    const client = makeClientMock();
    const log = new JobLogger('j1', client as never);
    await log.warn('upstream slow');
    expect(client.reportProgress).toHaveBeenCalledWith(
      'j1', 0, 'upstream slow', 'warn',
    );
  });

  it('error sends level=error', async () => {
    const client = makeClientMock();
    const log = new JobLogger('j1', client as never);
    await log.error('failed to connect');
    expect(client.reportProgress).toHaveBeenCalledWith(
      'j1', 0, 'failed to connect', 'error',
    );
  });
});

describe('NoopJobLogger', () => {
  it('info/warn/error resolve without calling anything', async () => {
    const log = new NoopJobLogger();
    await expect(log.info('x')).resolves.toBeUndefined();
    await expect(log.warn('x')).resolves.toBeUndefined();
    await expect(log.error('x')).resolves.toBeUndefined();
  });
});
