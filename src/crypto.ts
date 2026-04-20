/**
 * Verify a SOTA webhook signature header.
 *
 * Header format: "t={timestamp},v1={hmac_sha256_hex}"
 * The HMAC is computed over "{timestamp}.{payload}" using the webhook secret.
 *
 * @param maxAgeSeconds Maximum allowed age of the signature (default 5 minutes).
 *                      Set to 0 to disable replay protection.
 */
export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  maxAgeSeconds = 300,
): Promise<boolean> {
  const parts = signatureHeader.split(',');
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const sigPart = parts.find((p) => p.startsWith('v1='));
  if (!timestampPart || !sigPart) return false;

  const timestamp = timestampPart.slice(2);
  const receivedSig = sigPart.slice(3);

  // Replay protection: reject stale or future signatures
  if (maxAgeSeconds > 0) {
    const tsNum = parseInt(timestamp, 10);
    if (isNaN(tsNum)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - tsNum) > maxAgeSeconds) return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${payload}`),
  );
  const expectedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (expectedSig.length !== receivedSig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= expectedSig.charCodeAt(i) ^ receivedSig.charCodeAt(i);
  }
  return mismatch === 0;
}
