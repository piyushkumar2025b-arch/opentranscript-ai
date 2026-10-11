import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch } from './safeFetch.ts';

describe('safeFetch cross-origin redirect credential stripping (F-10)', () => {
  it('strips sensitive headers on cross-origin redirect with plain object headers', async () => {
    // Mock global fetch to intercept requests
    const originalFetch = globalThis.fetch;
    const interceptedRequests: { url: string; headers: Record<string, string> }[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headersRecord: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => { headersRecord[k.toLowerCase()] = v; });
        } else if (Array.isArray(init.headers)) {
          for (const [k, v] of init.headers) { headersRecord[k.toLowerCase()] = String(v); }
        } else {
          for (const [k, v] of Object.entries(init.headers)) { headersRecord[k.toLowerCase()] = String(v); }
        }
      }
      interceptedRequests.push({ url, headers: headersRecord });

      if (url === 'https://example.com/initial') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://other-domain.org/destination' },
        });
      }

      return new Response('ok', { status: 200 });
    }) as any;

    try {
      const initialHeaders = {
        'Authorization': 'Bearer secret_token_123',
        'Cookie': 'session=abc',
        'X-OpenRouter-Key': 'sk-or-v1-secret',
        'X-User-Key': 'user_key_xyz',
        'X-YouTube-API-Key': 'yt_key_999',
        'X-YouTube-Cookies': 'yt_cookies_abc',
        'Accept': 'application/json',
      };

      await safeFetch('https://example.com/initial', {
        headers: initialHeaders,
        allowedHosts: new Set(['example.com', 'other-domain.org']),
      });

      assert.equal(interceptedRequests.length, 2);
      // First request should contain all headers
      assert.equal(interceptedRequests[0].headers['authorization'], 'Bearer secret_token_123');
      assert.equal(interceptedRequests[0].headers['x-openrouter-key'], 'sk-or-v1-secret');
      assert.equal(interceptedRequests[0].headers['accept'], 'application/json');

      // Second request (redirected to other-domain.org) MUST NOT contain sensitive headers
      assert.equal(interceptedRequests[1].headers['authorization'], undefined);
      assert.equal(interceptedRequests[1].headers['cookie'], undefined);
      assert.equal(interceptedRequests[1].headers['x-openrouter-key'], undefined);
      assert.equal(interceptedRequests[1].headers['x-user-key'], undefined);
      assert.equal(interceptedRequests[1].headers['x-youtube-api-key'], undefined);
      assert.equal(interceptedRequests[1].headers['x-youtube-cookies'], undefined);
      // Non-sensitive headers must be preserved
      assert.equal(interceptedRequests[1].headers['accept'], 'application/json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('strips sensitive headers on cross-origin redirect with Headers instance', async () => {
    const originalFetch = globalThis.fetch;
    const interceptedRequests: { url: string; headers: Record<string, string> }[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headersRecord: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => { headersRecord[k.toLowerCase()] = v; });
        } else if (typeof init.headers === 'object') {
          for (const [k, v] of Object.entries(init.headers)) { headersRecord[k.toLowerCase()] = String(v); }
        }
      }
      interceptedRequests.push({ url, headers: headersRecord });

      if (url === 'https://example.com/start') {
        return new Response(null, {
          status: 301,
          headers: { Location: 'https://example.org/finish' },
        });
      }

      return new Response('done', { status: 200 });
    }) as any;

    try {
      const h = new Headers();
      h.set('Authorization', 'Bearer my-token');
      h.set('User-Agent', 'MyTestAgent');

      await safeFetch('https://example.com/start', {
        headers: h,
        allowedHosts: new Set(['example.com', 'example.org']),
      });

      assert.equal(interceptedRequests.length, 2);
      assert.equal(interceptedRequests[0].headers['authorization'], 'Bearer my-token');
      assert.equal(interceptedRequests[1].headers['authorization'], undefined);
      assert.equal(interceptedRequests[1].headers['user-agent'], 'MyTestAgent');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
