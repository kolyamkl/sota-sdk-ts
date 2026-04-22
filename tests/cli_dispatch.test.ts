import { describe, it, expect, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildProgram } from '../src/cli.js';

describe('cli dispatch', () => {
  it('`init --help` prints help and does NOT scaffold a directory', async () => {
    const program = buildProgram();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    program.exitOverride();
    try {
      await program.parseAsync(['node', 'sota-agent-ts', 'init', '--help']);
    } catch {
      // commander throws CommanderError on --help; that's the "exit" signal.
    }
    expect(existsSync(join(process.cwd(), '--help'))).toBe(false);
    if (existsSync(join(process.cwd(), '--help'))) {
      rmSync(join(process.cwd(), '--help'), { recursive: true, force: true });
    }
    spy.mockRestore();
  });

  it('unknown command exits with non-zero', async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'sota-agent-ts', 'definitely-not-a-command']),
    ).rejects.toThrow();
  });

  it('`--help` at root exits cleanly', async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(['node', 'sota-agent-ts', '--help']),
    ).rejects.toThrow();
  });
});
