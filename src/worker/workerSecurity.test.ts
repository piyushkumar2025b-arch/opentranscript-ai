import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import worker, { rateLimit, Env } from '../worker.ts';
import {
  setCustomJwksFetcher,
  verifyFirebaseToken,
  VerifiedWorkerUser,
} from './auth.ts';
import { isSafeWorkerUrl, fetchRemoteSubtitleWithSafety } from './ssrf.ts';
import { isOriginAllowed, corsHeaders, handleCorsPreflight } from './cors.ts';
import { CloudflareDbService } from '../services/cloudflareDbService.ts';

// ---------------------------------------------------------------------------
// Helpers for Web Crypto Token Minting
// ---------------------------------------------------------------------------

let testKeyPair: CryptoKeyPair;
let testJwk: JsonWebKey & { kid?: string; alg?: string; use?: string };

async function setupCrypto() {
  testKeyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  testJwk = await crypto.subtle.exportKey('jwk', testKeyPair.publicKey);
  testJwk.kid = 'test-worker-key-1';
  testJwk.alg = 'RS256';
  testJwk.use = 'sig';

  setCustomJwksFetcher(async () => [testJwk as any]);
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function signTestToken(
  payload: Record<string, any>,
  kid = 'test-worker-key-1'
): Promise<string> {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    testKeyPair.privateKey,
    data
  );

  const sigB64 = Buffer.from(sig)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

// ---------------------------------------------------------------------------
// Mock D1 Database backed by real SQLite
// ---------------------------------------------------------------------------

function createMockD1Database(): any {
  const sqlite = new DatabaseSync(':memory:');
  const schemaPath = path.resolve(process.cwd(), 'cloudflare.d1.schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  sqlite.exec(schema);

  return {
    prepare(sql: string) {
      return {
        _params: [] as any[],
        bind(...args: any[]) {
          this._params = args;
          return this;
        },
        async first<T = any>() {
          const stmt = sqlite.prepare(sql);
          return (stmt.get(...this._params) as T) ?? null;
        },
        async all<T = any>() {
          const stmt = sqlite.prepare(sql);
          const results = stmt.all(...this._params) as T[];
          return { results, success: true };
        },
        async run() {
          const stmt = sqlite.prepare(sql);
          stmt.run(...this._params);
          return { success: true };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock KV Namespace
// ---------------------------------------------------------------------------

function createMockKV(initialData: Record<string, any> = {}): any {
  const store = new Map<string, string>(
    Object.entries(initialData).map(([k, v]) => [k, JSON.stringify(v)])
  );
  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (!val) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

// ===========================================================================
// Test Suites
// ===========================================================================

test('F-02: Cryptographic Firebase Token Verification & AI Route Protection', async (t) => {
  await setupCrypto();

  const projectId = 'opentranscript-ai';
  const nowSec = Math.floor(Date.now() / 1000);

  await t.test('verifies valid cryptographic token and derives claims', async () => {
    const token = await signTestToken({
      sub: 'user-valid-123',
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      exp: nowSec + 3600,
      email: 'user@example.com',
      email_verified: true,
    });

    const user = await verifyFirebaseToken(token, projectId);
    assert.ok(user, 'User should be verified');
    assert.equal(user?.uid, 'user-valid-123');
    assert.equal(user?.email, 'user@example.com');
  });

  await t.test('rejects expired token', async () => {
    const token = await signTestToken({
      sub: 'user-expired',
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      exp: nowSec - 10,
    });

    const user = await verifyFirebaseToken(token, projectId);
    assert.equal(user, null, 'Expired token must be rejected');
  });

  await t.test('rejects token with wrong project audience', async () => {
    const token = await signTestToken({
      sub: 'user-wrong-project',
      aud: 'different-malicious-project',
      iss: `https://securetoken.google.com/${projectId}`,
      exp: nowSec + 3600,
    });

    const user = await verifyFirebaseToken(token, projectId);
    assert.equal(user, null, 'Wrong project audience must be rejected');
  });

  await t.test('rejects token with wrong issuer', async () => {
    const token = await signTestToken({
      sub: 'user-wrong-iss',
      aud: projectId,
      iss: 'https://attacker.example.com',
      exp: nowSec + 3600,
    });

    const user = await verifyFirebaseToken(token, projectId);
    assert.equal(user, null, 'Wrong issuer must be rejected');
  });

  await t.test('rejects token with unknown kid', async () => {
    const token = await signTestToken(
      {
        sub: 'user-bad-kid',
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        exp: nowSec + 3600,
      },
      'unknown-kid-999'
    );

    const user = await verifyFirebaseToken(token, projectId);
    assert.equal(user, null, 'Unknown kid must be rejected');
  });

  await t.test('unauthenticated POST /api/summarize returns 401 when using server key', async () => {
    const db = createMockD1Database();
    const env: Env = {
      DB: db,
      CACHE: createMockKV(),
      OPENROUTER_API_KEY: 'server-secret-key-do-not-leak',
    };

    const req = new Request('http://localhost/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: 'Sample video transcript text here...',
      }),
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 401, 'Anonymous caller spending server key must be rejected with 401');
    const body = (await res.json()) as any;
    assert.ok(body.error?.includes('Authentication'), 'Error must specify authentication required');
  });
});

test('F-03 & F-04: IDOR Protection & First-Time D1 Write Bootstrap', async (t) => {
  await setupCrypto();
  const db = createMockD1Database();
  const env: Env = {
    DB: db,
    CACHE: createMockKV(),
  };

  const projectId = 'opentranscript-ai';
  const nowSec = Math.floor(Date.now() / 1000);

  const tokenUserA = await signTestToken({
    sub: 'user-alpha',
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    exp: nowSec + 3600,
    email: 'alpha@example.com',
  });

  const tokenUserB = await signTestToken({
    sub: 'user-beta',
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    exp: nowSec + 3600,
    email: 'beta@example.com',
  });

  await t.test('first-time write bootstraps user row without foreign key error (F-04)', async () => {
    // User Alpha has never written before; creating a list should bootstrap users(id)
    const req = new Request('http://localhost/api/lists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUserA}`,
      },
      body: JSON.stringify({
        name: 'Alpha Favorites',
        category: 'favorites',
      }),
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.ok(data.id, 'List ID must be returned');

    // Confirm user was bootstrapped in users table
    const userRow = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind('user-alpha')
      .first();
    assert.ok(userRow, 'User Alpha row must be created in D1 users table');
    assert.equal(userRow.id, 'user-alpha');
  });

  await t.test('cross-user access isolation: User B cannot read User A lists (F-03)', async () => {
    // User B requests /api/lists with query ?userId=user-alpha (IDOR attempt)
    const req = new Request('http://localhost/api/lists?userId=user-alpha', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenUserB}`,
      },
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    // User B must have 0 lists (cannot see Alpha's lists)
    assert.equal(data.lists.length, 0, 'User B must not see User A lists despite query param');
  });

  await t.test('cross-user mutation isolation: User B cannot add item to User A list (F-03)', async () => {
    // Get Alpha's list ID
    const alphaLists = await db
      .prepare('SELECT id FROM saved_lists WHERE owner_id = ?')
      .bind('user-alpha')
      .first();
    const alphaListId = alphaLists.id;

    // User B attempts to insert an item into Alpha's list
    const req = new Request(`http://localhost/api/lists/${alphaListId}/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUserB}`,
      },
      body: JSON.stringify({
        title: 'Malicious Item Injection',
        itemType: 'video',
      }),
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 403, 'User B adding item to Alpha list must be rejected with 403');
  });
});

test('F-05: Subtitle URL Fetch SSRF & Size Limits', async (t) => {
  await t.test('rejects loopback and private IPv4 destinations', () => {
    assert.equal(isSafeWorkerUrl('http://127.0.0.1/captions.vtt'), false);
    assert.equal(isSafeWorkerUrl('http://localhost/captions.vtt'), false);
    assert.equal(isSafeWorkerUrl('http://10.0.0.1/captions.vtt'), false);
    assert.equal(isSafeWorkerUrl('http://192.168.1.1/captions.vtt'), false);
    assert.equal(isSafeWorkerUrl('http://172.16.0.5/captions.vtt'), false);
    assert.equal(isSafeWorkerUrl('http://169.254.169.254/metadata'), false);
  });

  await t.test('rejects IPv6 loopback, site-local, and link-local', () => {
    assert.equal(isSafeWorkerUrl('http://[::1]/captions.vtt'), false);
    assert.equal(isSafeWorkerUrl('http://[fe80::1]/captions.vtt'), false);
  });

  await t.test('rejects single-label internal hosts and userinfo', () => {
    assert.equal(isSafeWorkerUrl('http://internal-db/captions.vtt'), false);
    assert.equal(isSafeWorkerUrl('http://admin:pass@example.com/captions.vtt'), false);
    assert.equal(isSafeWorkerUrl('file:///etc/passwd'), false);
    assert.equal(isSafeWorkerUrl('gopher://example.com'), false);
  });

  await t.test('allows public HTTPS URLs', () => {
    assert.equal(isSafeWorkerUrl('https://example.com/captions.vtt'), true);
    assert.equal(isSafeWorkerUrl('https://subtitles.cdn.youtube.com/track.vtt'), true);
  });
});

test('F-06: CORS Hardening & Wildcard Elimination', async (t) => {
  const env = {
    APP_URL: 'https://opentranscript-ai.pages.dev',
    ALLOWED_ORIGINS: 'https://custom.example.com',
    ENVIRONMENT: 'production',
  };

  await t.test('disallowed origin strictly OMITS Access-Control-Allow-Origin', () => {
    const headers = corsHeaders('https://attacker.example.com', env);
    assert.equal(headers['Access-Control-Allow-Origin'], undefined, 'Must not return ACAO for rejected origin');
    assert.equal(headers['Vary'], 'Origin');
  });

  await t.test('rejects spoofed localhost suffix', () => {
    assert.equal(isOriginAllowed('http://localhost.attacker.com', env), false);
    assert.equal(isOriginAllowed('http://127.0.0.1.attacker.com', env), false);
  });

  await t.test('allows exact configured origins and legitimate Pages subdomains', () => {
    assert.equal(isOriginAllowed('https://opentranscript-ai.pages.dev', env), true);
    assert.equal(isOriginAllowed('https://preview-opentranscript-ai.pages.dev', env), true);
    assert.equal(isOriginAllowed('https://custom.example.com', env), true);
  });

  await t.test('handleCorsPreflight returns 403 on rejected origin', () => {
    const req = new Request('http://localhost/api/health', {
      method: 'OPTIONS',
      headers: { Origin: 'https://malicious.example.com' },
    });
    const res = handleCorsPreflight(req, env);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  });
});

test('F-09: Atomic Rate Limiting & Fail-Closed Behavior', async (t) => {
  const db = createMockD1Database();

  await t.test('concurrent burst atomically tracks request count in SQLite', async () => {
    const tasks = Array.from({ length: 30 }, () =>
      rateLimit('test-burst-ip', 'llm', db)
    );

    const results = await Promise.all(tasks);
    const allowedCount = results.filter((r) => r.allowed).length;
    const blockedCount = results.filter((r) => !r.allowed).length;

    // Limit on LLM is 25
    assert.equal(allowedCount, 25, 'Exactly 25 requests must be allowed in burst');
    assert.equal(blockedCount, 5, 'Requests beyond 25 must be rejected');
  });

  await t.test('fails closed on LLM routes when KV errors', async () => {
    const brokenKV = {
      async get() {
        throw new Error('KV storage timeout');
      },
      async put() {
        throw new Error('KV storage timeout');
      },
    };

    const result = await rateLimit('err-ip', 'llm', undefined, brokenKV as any);
    assert.equal(result.allowed, false, 'Cost-bearing LLM route must fail closed when quota check errors');
  });
});

test('F-11: Model Parameter Validation & Default Provider Consistency', async (t) => {
  const db = createMockD1Database();
  const env: Env = {
    DB: db,
    CACHE: createMockKV(),
    OPENROUTER_API_KEY: 'sk-server-openrouter-key',
  };

  const token = await signTestToken({
    sub: 'user-model-test',
    aud: 'opentranscript-ai',
    iss: 'https://securetoken.google.com/opentranscript-ai',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  await t.test('rejects invalid or unsupported OpenRouter model with 400', async () => {
    const req = new Request('http://localhost/api/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        transcript: 'Some valid video transcript...',
        provider: 'openrouter',
        model: 'invalid-model-name-without-author',
      }),
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 400, 'Invalid model must return 400 validation error');
    const body = (await res.json()) as any;
    assert.ok(body.error?.includes('Invalid or unsupported'), 'Error must specify invalid model');
  });

  await t.test('handleStatus reports defaultProvider consistent with configuration', async () => {
    const req = new Request('http://localhost/api/status');
    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.defaultProvider, 'openrouter', 'When only OpenRouter is configured, defaultProvider must be openrouter');
  });
});

test('F-16: Worker Audio Transcription 25 MB Limit Enforcement', async (t) => {
  const db = createMockD1Database();
  const env: Env = {
    DB: db,
    CACHE: createMockKV(),
    GEMINI_API_KEY: 'gemini-test-key',
  };

  const token = await signTestToken({
    sub: 'user-audio-test',
    aud: 'opentranscript-ai',
    iss: 'https://securetoken.google.com/opentranscript-ai',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  // Base64 string representing > 25MB decoded audio (~35MB base64)
  const hugeAudioBase64 = 'A'.repeat(35 * 1024 * 1024);

  const req = new Request('http://localhost/api/transcribe-audio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      audioBase64: hugeAudioBase64,
      filename: 'massive.mp3',
    }),
  });

  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 413, 'Payload exceeding 25MB decoded audio must return HTTP 413');
});
