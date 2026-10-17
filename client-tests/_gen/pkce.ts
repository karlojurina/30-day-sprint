import { randomBytes, createHash, createHmac, timingSafeEqual } from "crypto";

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Encode the PKCE code_verifier and a random nonce into an HMAC-signed OAuth
 * state parameter. This lets us round-trip the verifier through Whop without
 * relying on a cookie that browsers sometimes drop on cross-site redirects.
 *
 * Format: base64url(nonce).base64url(verifier).hmacSha256
 */
export function signState(verifier: string, secret: string): string {
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${nonce}.${Buffer.from(verifier).toString("base64url")}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Verify the signed state parameter returned by Whop and extract the
 * code_verifier. Returns null on any tampering or malformed input.
 */
export function unsignState(
  raw: string,
  secret: string
): { codeVerifier: string; nonce: string } | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  const [nonce, verifierB64, sig] = parts;
  if (!nonce || !verifierB64 || !sig) return null;

  const payload = `${nonce}.${verifierB64}`;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  let sigOk = false;
  try {
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    sigOk = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return null;
  }
  if (!sigOk) return null;

  let codeVerifier: string;
  try {
    codeVerifier = Buffer.from(verifierB64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  if (!codeVerifier) return null;
  return { codeVerifier, nonce };
}
