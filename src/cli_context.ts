/** CLI context resolution + .env read/write helpers.
 *  Parity with Python Plan 2's sota_sdk.cli_context. */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';

export class NoAgentContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAgentContextError';
  }
}

export function readDotenv(path = '.env'): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function writeDotenv(path: string, values: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  const content = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync(path, content);
  if (platform() !== 'win32') chmodSync(path, 0o600);
}

export function atomicReplaceEnvVar(
  path: string,
  key: string,
  newValue: string,
): void {
  const backup = join(dirname(path), '.env.bak');
  if (existsSync(path)) copyFileSync(path, backup);
  const lines = existsSync(path) ? readFileSync(path, 'utf-8').split(/\r?\n/) : [];
  const out: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (line.trim().startsWith(`${key}=`)) {
      out.push(`${key}=${newValue}`);
      replaced = true;
    } else {
      out.push(line);
    }
  }
  if (!replaced) out.push(`${key}=${newValue}`);
  const trimmed = out.filter((l, i) => !(i === out.length - 1 && l === ''));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, trimmed.join('\n') + '\n');
  if (platform() !== 'win32') chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function resolveApiKey(dotenvPath = '.env'): string {
  const envKey = process.env.SOTA_API_KEY;
  if (envKey) return envKey;
  const dv = readDotenv(dotenvPath);
  if (dv.SOTA_API_KEY) return dv.SOTA_API_KEY;
  throw new NoAgentContextError(
    'No SOTA_API_KEY found in env or .env. ' +
    'Run `sota-agent-ts login` + `sota-agent-ts agent register` ' +
    'or `sota-agent-ts agent switch <id>` first.',
  );
}
