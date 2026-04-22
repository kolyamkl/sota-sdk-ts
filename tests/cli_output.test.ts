import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printJson, printTable, statusTag, emit } from '../src/cli_output.js';

describe('printJson', () => {
  it('prints JSON and round-trips', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printJson({ a: 1, b: [1, 2] });
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({ a: 1, b: [1, 2] });
    spy.mockRestore();
  });
});

describe('statusTag', () => {
  it('returns a non-empty string for known statuses', () => {
    expect(statusTag('active')).not.toBe('');
    expect(statusTag('sandbox')).not.toBe('');
    expect(statusTag('deleted')).not.toBe('');
  });

  it('returns the raw status for unknown inputs', () => {
    expect(statusTag('unknown_status')).toContain('unknown_status');
  });
});

describe('emit', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints JSON when jsonMode=true', () => {
    emit({ jsonMode: true, data: { status: 'ok' } });
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({ status: 'ok' });
  });

  it('calls render when jsonMode=false', () => {
    emit({
      jsonMode: false,
      data: { status: 'ok' },
      render: (d: { status: string }) => `status: ${d.status}`,
    });
    expect(logSpy.mock.calls[0][0]).toBe('status: ok');
  });
});

describe('printTable', () => {
  it('smoke: prints without throwing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTable(
      ['name', 'status'],
      [['alpha', 'active'], ['beta', 'sandbox']],
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
