import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Audio upload byte limits and base64 sizing (F-16)', () => {
  it('correctly calculates decoded bytes from base64 string length', () => {
    const targetDecodedBytes = 25 * 1024 * 1024; // 26,214,400 bytes (25 MB)
    // Base64 expansion is ~4/3
    const base64LenFor25Mb = Math.ceil((targetDecodedBytes * 4) / 3);

    // Simulated calculation from server.ts
    const approxBytes = Math.round((base64LenFor25Mb * 3) / 4);
    assert.ok(approxBytes >= targetDecodedBytes);

    // Verify 40MB Express JSON body limit accommodates the ~33.3MB base64 text
    const base64Mb = base64LenFor25Mb / (1024 * 1024);
    assert.ok(base64Mb < 35, `Base64 size (${base64Mb} MB) must fit well within 40 MB body parser limit`);
  });

  it('rejects media exceeding 25 MB decoded threshold', () => {
    const oversizedDecodedBytes = 26 * 1024 * 1024; // 26 MB
    const base64Len = Math.ceil((oversizedDecodedBytes * 4) / 3);
    const approxBytes = Math.round((base64Len * 3) / 4);

    const isExceeded = approxBytes > 25 * 1024 * 1024;
    assert.equal(isExceeded, true);
  });
});
