import { describe, it, expect, vi } from 'vitest';
import { logsAction } from '../src/cli_commands/runtime.js';

describe('logs --no-follow', () => {
  it('prints NDJSON when --json and exits after one page', async () => {
    process.env.SOTA_API_KEY = 'k';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({
        entries: [
          { id: 1, agent_id: 'a1', event_type: 'progress',
            level: 'info', job_id: 'j1',
            payload: { percent: 50, message: 'halfway' },
            created_at: '2026-04-22T00:00:00Z' },
          { id: 2, agent_id: 'a1', event_type: 'job_status',
            level: 'info', job_id: 'j1',
            payload: { from: 'executing', to: 'completed' },
            created_at: '2026-04-22T00:00:30Z' },
        ],
        next_since_id: null,
      }), { status: 200 })),
    );
    await logsAction({ follow: false, json: true, interval: 0.01, limit: 200 });
    expect(spy).toHaveBeenCalledTimes(2);
    const line0 = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line0.id).toBe(1);
    expect(line0.event_type).toBe('progress');
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });

  it('pretty mode formats with level tags', async () => {
    process.env.SOTA_API_KEY = 'k';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({
        entries: [
          { id: 1, agent_id: 'a1', event_type: 'progress',
            level: 'warn', job_id: 'j1',
            payload: { percent: 0, message: 'slow' },
            created_at: '2026-04-22T00:00:00Z' },
        ],
        next_since_id: null,
      }), { status: 200 })),
    );
    await logsAction({ follow: false, json: false, interval: 0.01, limit: 200 });
    const out = spy.mock.calls.map(c => String(c[0])).join('\n');
    expect(out).toContain('WARN');
    expect(out).toContain('slow');
    spy.mockRestore();
    delete process.env.SOTA_API_KEY;
  });
});
