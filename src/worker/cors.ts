/**
 * Hardened CORS origin validation for Cloudflare Workers.
 * Never falls back to wildcard '*' on disallowed origins.
 * (F-06)
 */

export interface CorsEnv {
  APP_URL?: string;
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
}

export function isOriginAllowed(origin: string, env: CorsEnv): boolean {
  if (!origin || typeof origin !== 'string') return false;

  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    const isDev = env.ENVIRONMENT !== 'production' || !env.APP_URL;

    // 1. Strict localhost check (exact hostname matching, not startsWith)
    if (isDev && (u.protocol === 'http:' || u.protocol === 'https:')) {
      if (host === 'localhost' || host === '127.0.0.1') {
        return true;
      }
    }

    // 2. Configured exact allowed origins
    const allowedOrigins = new Set<string>();

    if (env.APP_URL) {
      try {
        allowedOrigins.add(new URL(env.APP_URL).origin);
      } catch {}
    }

    if (env.ALLOWED_ORIGINS) {
      for (const item of env.ALLOWED_ORIGINS.split(',')) {
        const trimmed = item.trim();
        if (trimmed) {
          try {
            allowedOrigins.add(new URL(trimmed).origin);
          } catch {}
        }
      }
    }

    if (allowedOrigins.has(u.origin)) {
      return true;
    }

    // 3. Trusted Cloudflare Pages subdomains (scoped strictly to opentranscript-ai project)
    if (host.endsWith('.pages.dev')) {
      const parts = host.split('.');
      if (parts.length === 3) {
        const subdomain = parts[0];
        if (subdomain === 'opentranscript-ai' || subdomain.endsWith('-opentranscript-ai')) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function corsHeaders(origin: string, env: CorsEnv): Record<string, string> {
  const allowed = isOriginAllowed(origin, env);

  if (!allowed) {
    // For disallowed origins: strictly OMIT Access-Control-Allow-Origin, NEVER return '*' (F-06)
    return {
      'Vary': 'Origin',
    };
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-YouTube-API-Key, X-OpenRouter-Key, X-YouTube-Cookies',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function handleCorsPreflight(request: Request, env: CorsEnv): Response {
  const origin = request.headers.get('origin') || '';
  const allowed = isOriginAllowed(origin, env);

  if (!allowed) {
    return new Response('CORS Origin Not Allowed', {
      status: 403,
      headers: { 'Vary': 'Origin', 'Content-Type': 'text/plain' },
    });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, env),
  });
}
