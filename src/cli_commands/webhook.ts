import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';

function getSecret(): string {
  const s = process.env.SOTA_WEBHOOK_SECRET;
  if (!s) {
    console.error('Error: SOTA_WEBHOOK_SECRET not set.');
    process.exit(2);
  }
  return s;
}

export async function webhookVerifyAction(
  path: string,
  opts: { sig: string },
): Promise<void> {
  const secret = getSecret();
  // Raw bytes — never parse+re-serialize. Fixes the footgun from debugging.md.
  const body = path === '-' ? readFileSync(0) : readFileSync(path);
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  let ok = false;
  try {
    ok = timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(opts.sig, 'hex'),
    );
  } catch {
    ok = false;
  }
  if (ok) {
    console.log(`valid (hmac-sha256 over ${body.length} bytes)`);
  } else {
    console.error(`invalid (expected=${expected.slice(0, 16)}… got=${opts.sig.slice(0, 16)}…)`);
    throw new Error('signature mismatch');
  }
}

export async function webhookTestAction(
  opts: { url: string; jobId: string },
): Promise<void> {
  const secret = getSecret();
  const body = Buffer.from(JSON.stringify({
    event_type: 'job.assigned',
    job_id: opts.jobId,
    timestamp: new Date().toISOString(),
  }));
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  const resp = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SOTA-Signature': sig,
    },
    body,
  });
  console.log(`POST ${opts.url} → ${resp.status}`);
  const txt = await resp.text();
  if (txt) console.log(txt);
  if (!resp.ok) process.exit(1);
}
