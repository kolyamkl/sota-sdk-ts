/**
 * Credential storage and device-code auth flow (D-08, D-09, D-10).
 * Shares ~/.sota/credentials with Python CLI.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export function credentialsDir(): string {
  return join(homedir(), '.sota');
}

export function credentialsFile(): string {
  return join(credentialsDir(), 'credentials');
}

export interface Credentials {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
}

export function saveCredentials(data: Credentials): void {
  mkdirSync(credentialsDir(), { recursive: true });
  writeFileSync(credentialsFile(), JSON.stringify(data, null, 2));
  // Set file permissions to 600 on Unix (D-09)
  if (platform() !== 'win32') {
    chmodSync(credentialsFile(), 0o600);
  }
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(credentialsFile())) return null;
  try {
    return JSON.parse(readFileSync(credentialsFile(), 'utf-8'));
  } catch {
    return null;
  }
}

export function getApiUrl(): string {
  return process.env.SOTA_API_URL ?? 'https://sota-backend-production.up.railway.app';
}

export async function deviceCodeLogin(): Promise<Credentials> {
  const apiUrl = getApiUrl();

  // Step 1: Request device code
  const codeResp = await fetch(`${apiUrl}/api/v1/auth/device-code`, { method: 'POST' });
  if (!codeResp.ok) throw new Error(`Failed to create device code: ${await codeResp.text()}`);

  const { device_code, verify_url, expires_in } = await codeResp.json() as {
    device_code: string;
    verify_url: string;
    expires_in: number;
  };

  // verify_url is absolute (backend resolves DEVPORTAL_URL env var).
  console.log(`\n  Your device code: ${device_code}`);
  console.log(`  Opening browser to authorize...`);
  console.log(`  If browser doesn't open, visit: ${verify_url}`);
  console.log(`  Code expires in ${Math.floor(expires_in / 60)} minutes.\n`);

  // Try to open browser
  try {
    const { exec } = await import('node:child_process');
    const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} "${verify_url}"`);
  } catch {
    // Browser may not be available
  }

  // Step 2: Poll every 2s (D-10)
  const start = Date.now();
  while (Date.now() - start < expires_in * 1000) {
    await new Promise(r => setTimeout(r, 2000));

    const pollResp = await fetch(`${apiUrl}/api/v1/auth/device-poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code }),
    });

    if (pollResp.ok) {
      const result = await pollResp.json() as Record<string, string>;
      if (result.status === 'authorized') {
        const credentials: Credentials = {
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          user_id: result.user_id,
          email: result.email,
        };
        saveCredentials(credentials);
        return credentials;
      }
    } else if (pollResp.status === 410) {
      throw new Error('Device code expired. Please try again.');
    } else if (pollResp.status === 404) {
      throw new Error('Device code not found.');
    }

    process.stdout.write('.');
  }

  throw new Error('Device code expired (timeout). Please try again.');
}
