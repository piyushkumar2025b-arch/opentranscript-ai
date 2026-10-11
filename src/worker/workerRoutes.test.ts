import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import worker, { Env } from '../worker.ts';

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

function createMockKV(): any {
  const store = new Map<string, string>();
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
  };
}

test('F-01: Cloudflare Pages Advanced Mode Static Asset Handling', async (t) => {
  await t.test('calls env.ASSETS.fetch for static asset routes', async () => {
    let assetsFetchCalled = false;
    let requestedAssetPath = '';

    const mockAssets = {
      async fetch(req: Request) {
        assetsFetchCalled = true;
        requestedAssetPath = new URL(req.url).pathname;
        return new Response('<!DOCTYPE html><html><body>OpenTranscript AI</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      },
    };

    const env: Env = {
      DB: createMockD1Database(),
      CACHE: createMockKV(),
      ASSETS: mockAssets as any,
    };

    const req = new Request('http://localhost/');
    const res = await worker.fetch(req, env, {} as any);

    assert.equal(assetsFetchCalled, true, 'env.ASSETS.fetch must be invoked for non-API route');
    assert.equal(requestedAssetPath, '/');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('OpenTranscript AI'));
  });

  await t.test('returns 404 when ASSETS is unconfigured on non-API route', async () => {
    const env: Env = {
      DB: createMockD1Database(),
      CACHE: createMockKV(),
    };

    const req = new Request('http://localhost/missing-page');
    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 404);
  });
});

test('F-07: Worker Route Parity — Frontend Used API Endpoints', async (t) => {
  const db = createMockD1Database();
  const env: Env = {
    DB: db,
    CACHE: createMockKV(),
    GEMINI_API_KEY: 'test-gemini-key',
    OPENROUTER_API_KEY: 'test-openrouter-key',
  };

  const expectedRoutes = [
    { method: 'GET', path: '/api/health', expectedStatus: [200] },
    { method: 'GET', path: '/api/status', expectedStatus: [200] },
    { method: 'POST', path: '/api/transcript', body: { rawText: 'Hello world transcript with realistic length for processing.' }, expectedStatus: [200] },
    { method: 'GET', path: '/api/books-search?q=calculus', expectedStatus: [200] },
    { method: 'GET', path: '/api/academic-search?q=neural+networks', expectedStatus: [200] },
    { method: 'GET', path: '/api/github-search?q=react', expectedStatus: [200] },
    { method: 'GET', path: '/api/community-search?q=typescript', expectedStatus: [200] },
    { method: 'GET', path: '/api/podcasts-datasets?q=science', expectedStatus: [200] },
    { method: 'GET', path: '/api/web-search?q=artificial+intelligence', expectedStatus: [200] },
    { method: 'GET', path: '/api/image-search?q=galaxy', expectedStatus: [200] },
    { method: 'GET', path: '/api/news-search?q=technology', expectedStatus: [200] },
    { method: 'GET', path: '/api/tts', expectedStatus: [501] },
  ];

  for (const r of expectedRoutes) {
    await t.test(`Worker implements ${r.method} ${r.path}`, async () => {
      const req = new Request(`http://localhost${r.path}`, {
        method: r.method,
        headers: { 'Content-Type': 'application/json' },
        body: r.body ? JSON.stringify(r.body) : undefined,
      });

      const res = await worker.fetch(req, env, {} as any);
      assert.ok(
        r.expectedStatus.includes(res.status),
        `Route ${r.path} returned status ${res.status}, expected one of [${r.expectedStatus.join(', ')}]`
      );
      assert.notEqual(res.status, 404, `Route ${r.path} must not return 404 Endpoint Not Found`);
    });
  }
});
