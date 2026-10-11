/**
 * Cryptographic Firebase ID Token verification using Web Crypto API.
 * Runs in both Cloudflare Workers and modern Node.js environments without Node.js crypto imports.
 * (F-02, F-03)
 */

export interface VerifiedWorkerUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

interface GoogleJwk {
  kid: string;
  n: string;
  e: string;
  kty: string;
  alg: string;
  use: string;
}

let cachedJwks: { keys: GoogleJwk[]; expiresAt: number } | null = null;

// Allow injecting custom JWKS fetcher for unit tests
export type JwksFetcher = () => Promise<GoogleJwk[]>;

let customJwksFetcher: JwksFetcher | null = null;

export function setCustomJwksFetcher(fetcher: JwksFetcher | null): void {
  customJwksFetcher = fetcher;
  cachedJwks = null;
}

async function getGoogleJwks(): Promise<GoogleJwk[]> {
  if (customJwksFetcher) {
    return customJwksFetcher();
  }

  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  try {
    const res = await fetch(
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) {
      return cachedJwks?.keys || [];
    }

    const data = (await res.json()) as { keys: GoogleJwk[] };
    const cacheControl = res.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    const ttlSeconds = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

    cachedJwks = {
      keys: Array.isArray(data.keys) ? data.keys : [],
      expiresAt: now + Math.max(300, ttlSeconds) * 1000,
    };
    return cachedJwks.keys;
  } catch {
    return cachedJwks?.keys || [];
  }
}

function base64UrlDecode(str: string): string {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
  return atob(padded);
}

function base64UrlToUint8Array(str: string): Uint8Array {
  const decoded = base64UrlDecode(str);
  const arr = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    arr[i] = decoded.charCodeAt(i);
  }
  return arr;
}

export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+([a-zA-Z0-9_\-\.]+)/i);
  return match ? match[1] : null;
}

/**
 * Cryptographically verifies a Firebase ID Token using Google JWKS and Web Crypto RS256.
 * (F-02, F-03)
 */
export async function verifyFirebaseToken(
  token: string,
  projectId = 'opentranscript-ai'
): Promise<VerifiedWorkerUser | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // 1. Decode and validate header
    const headerJson = base64UrlDecode(headerB64);
    const header = JSON.parse(headerJson);
    if (header.alg !== 'RS256' || !header.kid || typeof header.kid !== 'string') {
      return null;
    }

    // 2. Decode and validate payload
    const payloadJson = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadJson);

    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < nowSec) {
      return null;
    }

    if (payload.aud !== projectId) {
      return null;
    }

    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
      return null;
    }

    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
      return null;
    }

    // 3. Match public key in Google JWKS
    const jwks = await getGoogleJwks();
    const matchingJwk = jwks.find((k) => k.kid === header.kid);
    if (!matchingJwk) {
      return null;
    }

    // 4. Import public key via Web Crypto API
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      matchingJwk as JsonWebKey,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify']
    );

    // 5. Verify cryptographic signature
    const dataBuffer = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureBuffer = base64UrlToUint8Array(signatureB64);

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBuffer as any,
      dataBuffer
    );

    if (!isValid) {
      return null;
    }

    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      emailVerified: Boolean(payload.email_verified),
    };
  } catch {
    return null;
  }
}
