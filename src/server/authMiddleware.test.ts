import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireAuthOrUserKey } from './authMiddleware.ts';

describe('requireAuthOrUserKey development bypass security (F-14)', () => {
  function createMockReqRes(options: {
    host?: string;
    remoteAddress?: string;
    authHeader?: string;
    openRouterKey?: string;
    user?: any;
  }) {
    const req: any = {
      headers: {
        host: options.host || 'localhost:3000',
      },
      socket: {
        remoteAddress: options.remoteAddress || '127.0.0.1',
      },
      body: {},
      user: options.user,
    };
    if (options.authHeader) req.headers.authorization = options.authHeader;
    if (options.openRouterKey) req.headers['x-openrouter-key'] = options.openRouterKey;

    let statusCode = 200;
    let jsonBody: any = null;
    let nextCalled = false;

    const res: any = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(data: any) {
        jsonBody = data;
        return res;
      },
    };

    const next = () => {
      nextCalled = true;
    };

    return { req, res, next, getResult: () => ({ statusCode, jsonBody, nextCalled }) };
  }

  it('rejects spoofed Host header ending in .run.app (F-14)', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const { req, res, next, getResult } = createMockReqRes({
        host: 'malicious.run.app',
        remoteAddress: '203.0.113.195', // external attacker IP
      });

      requireAuthOrUserKey(req, res, next);
      const result = getResult();

      assert.equal(result.nextCalled, false);
      assert.equal(result.statusCode, 401);
      assert.match(result.jsonBody?.error, /Authentication or valid OpenRouter API key required/);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('rejects spoofed Host header ending in .aistudio.google.com (F-14)', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const { req, res, next, getResult } = createMockReqRes({
        host: 'spoofed.aistudio.google.com',
        remoteAddress: '203.0.113.195',
      });

      requireAuthOrUserKey(req, res, next);
      const result = getResult();

      assert.equal(result.nextCalled, false);
      assert.equal(result.statusCode, 401);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('rejects external IP even if Host header is set to localhost (F-14)', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const { req, res, next, getResult } = createMockReqRes({
        host: 'localhost',
        remoteAddress: '198.51.100.5', // remote IP spoofing Host: localhost
      });

      requireAuthOrUserKey(req, res, next);
      const result = getResult();

      assert.equal(result.nextCalled, false);
      assert.equal(result.statusCode, 401);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('allows genuine local development loopback request (127.0.0.1 + localhost)', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const { req, res, next, getResult } = createMockReqRes({
        host: 'localhost:3000',
        remoteAddress: '127.0.0.1',
      });

      requireAuthOrUserKey(req, res, next);
      const result = getResult();

      assert.equal(result.nextCalled, true);
      assert.equal(result.statusCode, 200);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('enforces authentication in production mode even for loopback (F-14)', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const { req, res, next, getResult } = createMockReqRes({
        host: 'localhost:3000',
        remoteAddress: '127.0.0.1',
      });

      requireAuthOrUserKey(req, res, next);
      const result = getResult();

      assert.equal(result.nextCalled, false);
      assert.equal(result.statusCode, 401);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});
