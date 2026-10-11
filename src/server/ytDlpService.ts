import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ParsedSegment } from '../utils/subtitleParser.ts';
import { parseSubtitlePayload } from './transcriptHelper.ts';

export interface YtDlpOptions {
  cookies?: string;
  timeoutMs?: number;
  subLangs?: string;
}

/**
 * Downloads subtitles for a given YouTube video using the standalone yt-dlp binary.
 * Supports auto-generated captions, multi-language subtitle tracks, and custom cookies.
 */
export async function fetchSubtitlesViaYtDlp(
  videoId: string,
  options?: YtDlpOptions
): Promise<ParsedSegment[] | null> {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  // Determine yt-dlp command candidates (F-15: Windows compatibility & PATH fallback)
  const isWindows = process.platform === 'win32';
  const localExe = path.resolve(process.cwd(), 'bin', 'yt-dlp.exe');
  const localScript = path.resolve(process.cwd(), 'bin', 'yt-dlp');

  interface LaunchCandidate {
    cmd: string;
    prefixArgs: string[];
  }

  const candidates: LaunchCandidate[] = [];

  let hasLocalExe = false;
  try {
    await fs.access(localExe);
    hasLocalExe = true;
  } catch {}

  let hasLocalScript = false;
  try {
    await fs.access(localScript);
    hasLocalScript = true;
    try { await fs.chmod(localScript, 0o755); } catch {}
  } catch {}

  if (hasLocalExe) {
    candidates.push({ cmd: localExe, prefixArgs: [] });
  } else if (hasLocalScript) {
    if (isWindows) {
      // On Windows, a Unix zipapp/script without .exe cannot be spawned directly by execFile;
      // try python/py runner first, then PATH yt-dlp
      candidates.push({ cmd: 'python', prefixArgs: [localScript] });
      candidates.push({ cmd: 'py', prefixArgs: ['-3', localScript] });
    } else {
      candidates.push({ cmd: localScript, prefixArgs: [] });
    }
  }

  // Always include system PATH yt-dlp as reliable fallback
  candidates.push({ cmd: 'yt-dlp', prefixArgs: [] });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ytdlp-${videoId}-`));
  const outPattern = path.join(tempDir, `${videoId}.%(ext)s`);

  let tempCookiePath: string | null = null;
  try {
    const rawCookies = (options?.cookies || process.env.YOUTUBE_COOKIES || '').trim();
    if (rawCookies) {
      tempCookiePath = path.join(tempDir, 'cookies.txt');
      await fs.writeFile(tempCookiePath, rawCookies, 'utf-8');
    } else {
      // Check if a root cookies.txt exists
      const rootCookie = path.resolve(process.cwd(), 'cookies.txt');
      try {
        await fs.access(rootCookie);
        tempCookiePath = rootCookie;
      } catch {
        // no cookies file
      }
    }

    const baseArgs: string[] = [
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      options?.subLangs || 'en.*,en,es.*,fr.*,de.*,ja.*,zh.*',
      '--sub-format',
      'vtt/srv3/ttml/srt/best',
      '--output',
      outPattern,
      '--no-playlist',
      '--no-warnings',
    ];

    // Enable node as JavaScript runtime for challenge solving if available
    const nodePath = process.execPath;
    if (nodePath) {
      baseArgs.unshift('--js-runtimes', `node:${nodePath}`);
    }

    if (tempCookiePath) {
      baseArgs.push('--cookies', tempCookiePath);
    }

    baseArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

    const timeout = Math.min(Math.max(options?.timeoutMs || 15000, 5000), 30000);

    for (const candidate of candidates) {
      const fullArgs = [...candidate.prefixArgs, ...baseArgs];
      const execResult = await new Promise<{ error: Error | null; spawnFailed: boolean }>((resolve) => {
        execFile(
          candidate.cmd,
          fullArgs,
          {
            timeout,
            maxBuffer: 5 * 1024 * 1024,
          },
          (err) => {
            if (err) {
              const code = (err as any).code;
              const isSpawnError = Boolean(
                ['ENOENT', 'EINVAL', 'EACCES', 'UNKNOWN'].includes(code) ||
                (err.message && err.message.includes('not a valid Win32 application'))
              );
              resolve({ error: err, spawnFailed: isSpawnError });
            } else {
              resolve({ error: null, spawnFailed: false });
            }
          }
        );
      });

      // If spawn was successful (even if exit code > 0 for videos without subtitles), don't try next candidate
      if (!execResult.spawnFailed) {
        break;
      }
    }

    const downloadedFiles = await fs.readdir(tempDir);
    const subFiles = downloadedFiles.filter((f) =>
      /\.(vtt|srt|srv3|ttml|json3)$/i.test(f)
    );

    if (subFiles.length === 0) {
      return null;
    }

    // Sort to prioritize English standard, then English auto, then other languages
    const prioritizedFiles = subFiles.sort((a, b) => {
      const getScore = (name: string) => {
        const lower = name.toLowerCase();
        if (lower.includes('.en.') || lower.includes('.en-orig.')) return 10;
        if (lower.includes('.en-')) return 8;
        if (lower.includes('.vtt')) return 6;
        if (lower.includes('.srt')) return 4;
        return 1;
      };
      return getScore(b) - getScore(a);
    });

    for (const subFile of prioritizedFiles) {
      try {
        const filePath = path.join(tempDir, subFile);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseSubtitlePayload(content, false);
        if (parsed && parsed.length > 0) {
          return parsed;
        }
      } catch {
        // Try next file
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
