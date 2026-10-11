import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import firebaseConfig from '../firebase-applet-config.json';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
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

async function getGoogleJwks(): Promise<GoogleJwk[]> {
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

/**
 * Parses and validates Firebase ID Token from standard Authorization Bearer header.
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+([a-zA-Z0-9_\-\.]+)/i);
  return match ? match[1] : null;
}

/**
 * Decodes and cryptographically verifies Firebase ID token (aud, iss, exp, kid, RS256 signature).
 */
export async function decodeFirebaseIdToken(token: string): Promise<AuthenticatedUser | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const headerJson = Buffer.from(parts[0], 'base64url').toString('utf-8');
    const header = JSON.parse(headerJson);
    if (header.alg !== 'RS256' || !header.kid) {
      return null;
    }

    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson);

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      return null;
    }

    const expectedProject = firebaseConfig.projectId;
    if (payload.aud !== expectedProject) {
      return null;
    }
    if (payload.iss !== `https://securetoken.google.com/${expectedProject}`) {
      return null;
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      return null;
    }

    // Verify cryptographic signature against Google JWKS (C-01)
    const jwks = await getGoogleJwks();
    const matchingKey = jwks.find((k) => k.kid === header.kid);
    if (!matchingKey) {
      return null;
    }

    const publicKey = crypto.createPublicKey({
      key: matchingKey as any,
      format: 'jwk',
    });

    const isSignatureValid = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2], 'base64url')
    );

    if (!isSignatureValid) {
      return null;
    }

    return {
      uid: payload.sub,
      email: payload.email,
      emailVerified: Boolean(payload.email_verified),
    };
  } catch {
    return null;
  }
}

/**
 * Middleware that extracts and validates Firebase user authentication on incoming API requests.
 */
export async function authenticateFirebaseUser(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearerToken(req);
  if (token) {
    const user = await decodeFirebaseIdToken(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}

/**
 * Enforces authentication or user-provided key on expensive AI routes (C-02).
 */
export function requireAuthOrUserKey(req: Request, res: Response, next: NextFunction): void {
  // Allow if user is authenticated via verified Firebase ID Token
  if (req.user?.uid) {
    next();
    return;
  }

  // Allow if user provides their own valid OpenRouter API key (sk-or- prefix check)
  const openRouterKey = String(req.headers['x-openrouter-key'] || req.body?.openRouterKey || '').trim();
  if (openRouterKey.startsWith('sk-or-') && openRouterKey.length >= 25) {
    next();
    return;
  }

  // In non-production preview / development environment, allow local test calls
  if (process.env.NODE_ENV !== 'production') {
    const host = String(req.headers.host || '').toLowerCase();
    const isLocalhost =
      /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
      host.endsWith('.run.app') ||
      host.endsWith('.aistudio.google.com');

    if (isLocalhost) {
      next();
      return;
    }
  }

  res.status(401).json({
    ok: false,
    error: 'Authentication or valid OpenRouter API key required to access cost-bearing AI endpoints.',
  });
}
