import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import {
  resolveApiKey,
  readDotenv,
  writeDotenv,
  atomicReplaceEnvVar,
  NoAgentContextError,
} from '../src/cli_context.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'cli-ctx-'));
}

describe('resolveApiKey', () => {
  const origCwd = process.cwd();
  const origKey = process.env.SOTA_API_KEY;
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (origKey === undefined) delete process.env.SOTA_API_KEY;
    else process.env.SOTA_API_KEY = origKey;
    rmSync(dir, { recursive: true, force: true });
  });

  it('env var wins over .env', () => {
    writeFileSync(join(dir, '.env'), 'SOTA_API_KEY=from-dotenv\n');
    process.env.SOTA_API_KEY = 'from-env';
    expect(resolveApiKey()).toBe('from-env');
  });

  it('.env fallback', () => {
    writeFileSync(join(dir, '.env'), 'SOTA_API_KEY=from-dotenv\n');
    delete process.env.SOTA_API_KEY;
    expect(resolveApiKey()).toBe('from-dotenv');
  });

  it('no key raises NoAgentContextError', () => {
    delete process.env.SOTA_API_KEY;
    expect(() => resolveApiKey()).toThrow(NoAgentContextError);
  });
});

describe('readDotenv', () => {
  it('handles quoted values', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, '.env'), 'SOTA_API_KEY="quoted-key"\nOTHER=plain\n');
    expect(readDotenv(join(dir, '.env'))).toEqual({
      SOTA_API_KEY: 'quoted-key',
      OTHER: 'plain',
    });
  });

  it('returns {} for missing file', () => {
    const dir = tmpDir();
    expect(readDotenv(join(dir, 'missing.env'))).toEqual({});
  });
});

describe('writeDotenv', () => {
  it('writes a 600-perm file on Unix', () => {
    const dir = tmpDir();
    const p = join(dir, '.env');
    writeDotenv(p, { SOTA_API_KEY: 'new-key' });
    expect(readFileSync(p, 'utf-8').trim()).toBe('SOTA_API_KEY=new-key');
    if (platform() !== 'win32') {
      expect(statSync(p).mode & 0o777).toBe(0o600);
    }
  });
});

describe('atomicReplaceEnvVar', () => {
  it('preserves other lines + backs up', () => {
    const dir = tmpDir();
    const p = join(dir, '.env');
    writeFileSync(p, '# comment\nSOTA_API_KEY=old\nOTHER=keep\n');
    atomicReplaceEnvVar(p, 'SOTA_API_KEY', 'new');
    const out = readFileSync(p, 'utf-8');
    expect(out).toContain('SOTA_API_KEY=new');
    expect(out).toContain('OTHER=keep');
    expect(out).toContain('# comment');
    expect(existsSync(join(dir, '.env.bak'))).toBe(true);
  });

  it('adds var if missing', () => {
    const dir = tmpDir();
    const p = join(dir, '.env');
    writeFileSync(p, 'OTHER=x\n');
    atomicReplaceEnvVar(p, 'SOTA_API_KEY', 'new');
    expect(readFileSync(p, 'utf-8')).toContain('SOTA_API_KEY=new');
  });
});
