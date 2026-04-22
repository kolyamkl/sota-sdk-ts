/** Identity commands: logout, whoami, version. */

import { existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { getApiUrl, loadCredentials, credentialsFile } from '../auth.js';
import { emit } from '../cli_output.js';

const SDK_VERSION = '0.1.0';

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N]: `, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 'y');
    });
  });
}

export async function logoutAction(opts: { yes?: boolean }): Promise<void> {
  const cred = credentialsFile();
  if (!existsSync(cred)) {
    console.log('Already logged out (no credentials file).');
    return;
  }
  if (!opts.yes) {
    const ok = await confirm(`Delete ${cred}?`);
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }
  rmSync(cred, { force: true });
  console.log('Logged out.');
}

export async function versionAction(): Promise<void> {
  console.log(`sota-agent-ts ${SDK_VERSION}`);
  try {
    const r = await fetch(`${getApiUrl()}/api/health`);
    if (r.ok) {
      const data = await r.json() as { version?: string };
      console.log(`backend ${data.version ?? '(no version field)'}`);
    }
  } catch {
    console.log('backend unreachable');
  }
}

export async function whoamiAction(opts: { json?: boolean }): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    console.error('Error: not logged in. Run `sota-agent-ts login` first.');
    throw new Error('not logged in');
  }
  const data = {
    email: creds.email,
    user_id: creds.user_id,
  };
  emit({
    jsonMode: !!opts.json,
    data,
    render: (d) => `email:   ${d.email}\nuser_id: ${d.user_id}`,
  });
}
