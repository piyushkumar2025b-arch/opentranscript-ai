import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fetchSubtitlesViaYtDlp } from './ytDlpService.ts';

test('F-15: yt-dlp Executable Selection and Spawn Robustness', async (t) => {
  await t.test('rejects invalid or malformed video IDs immediately without spawning', async () => {
    assert.equal(await fetchSubtitlesViaYtDlp(''), null);
    assert.equal(await fetchSubtitlesViaYtDlp('short'), null);
    assert.equal(await fetchSubtitlesViaYtDlp('invalid!@#$characters'), null);
    assert.equal(await fetchSubtitlesViaYtDlp('toolongvideoid12345'), null);
  });

  await t.test('handles video without subtitles and cleans temporary directory reliably', async () => {
    const beforeTmp = await fs.readdir(os.tmpdir());
    const initialYtdlpDirs = beforeTmp.filter((f) => f.startsWith('ytdlp-'));

    // Video ID format is valid 11 chars
    const result = await fetchSubtitlesViaYtDlp('00000000000', { timeoutMs: 3000 });
    assert.equal(result, null, 'No subtitles found must return null gracefully');

    const afterTmp = await fs.readdir(os.tmpdir());
    const remainingYtdlpDirs = afterTmp.filter(
      (f) => f.startsWith('ytdlp-00000000000-')
    );
    assert.equal(remainingYtdlpDirs.length, 0, 'Temporary directory must be cleaned up in finally block');
  });
});
