/**
 * OpenTranscript AI — Cloudflare Workers Entry Point (Pages Advanced Mode)
 *
 * Fully self-contained: uses Web Platform APIs available in Cloudflare Workers.
 * Hardened against IDOR, unauthenticated server-key abuse, SSRF, and CORS misconfiguration.
 * (F-01, F-02, F-03, F-04, F-05, F-06, F-07, F-09, F-11)
 */

import type { D1Database, KVNamespace, ExecutionContext, Fetcher } from '@cloudflare/workers-types';
import { verifyFirebaseToken, extractBearerToken, VerifiedWorkerUser } from './worker/auth.ts';
import { isSafeWorkerUrl, fetchRemoteSubtitleWithSafety } from './worker/ssrf.ts';
import { corsHeaders, handleCorsPreflight, isOriginAllowed } from './worker/cors.ts';
import { CloudflareDbService } from './services/cloudflareDbService.ts';
import {
  createTranscriptIndex,
  retrieveWithMultiQueryRRF,
  formatRetrievedContextForPrompt,
  extractGroundedFacts,
} from './server/ragEngine.ts';

// ---------------------------------------------------------------------------
// Types & Environment
// ---------------------------------------------------------------------------

export interface Env {
  ASSETS?: Fetcher;
  DB: D1Database;
  CACHE: KVNamespace;
  ENVIRONMENT?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_CSE_ID?: string;
  YOUTUBE_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  APP_URL?: string;
  ALLOWED_ORIGINS?: string;
  FIREBASE_PROJECT_ID?: string;
}

export interface ParsedSegment {
  start: number;
  duration: number;
  text: string;
  formattedTime: string;
}

// ---------------------------------------------------------------------------
// Subtitle & YouTube Utilities
// ---------------------------------------------------------------------------

const VALID_YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
]);

export function extractVideoId(urlOrId: string): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();

  // Bare 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed) && /[0-9A-Z_-]/.test(trimmed)) {
    return trimmed;
  }

  if (!trimmed.includes('/') && !trimmed.includes('.') && !trimmed.includes('?')) {
    return null;
  }

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    const host = u.hostname.toLowerCase();
    if (!VALID_YOUTUBE_HOSTS.has(host)) return null;

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const seg = u.pathname.split('/').filter(Boolean)[0] || '';
      return /^[a-zA-Z0-9_-]{11}$/.test(seg) ? seg : null;
    }
    const v = u.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    const parts = u.pathname.split('/').filter(Boolean);
    if (
      parts.length >= 2 &&
      ['embed', 'v', 'shorts', 'live', 'watch'].includes(parts[0]) &&
      /^[a-zA-Z0-9_-]{11}$/.test(parts[1])
    ) return parts[1];
  } catch { /* ignore */ }
  return null;
}

export type SourceType = 'youtube' | 'direct_subtitle' | 'direct_text' | 'web_article' | 'other';

export function detectSource(raw: string): { type: SourceType; videoId?: string } {
  const trimmed = raw.trim();

  const vid = extractVideoId(trimmed);
  if (vid) return { type: 'youtube', videoId: vid };

  if (!/^https?:\/\//i.test(trimmed)) {
    return { type: 'direct_text' };
  }

  try {
    const u = new URL(trimmed);
    const path = u.pathname.toLowerCase();
    if (/\.(vtt|srt|ttml|xml)$/i.test(path)) return { type: 'direct_subtitle' };
    if (/\.(mp3|mp4|wav|ogg|webm|m4a|aac|flac)$/i.test(path)) return { type: 'other' };
  } catch { /* ignore */ }

  return { type: 'web_article' };
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function parseSubtitleText(raw: string): ParsedSegment[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const segments: ParsedSegment[] = [];

  const timeMs = (t: string): number => {
    const parts = t.trim().replace(',', '.').split(':');
    if (parts.length === 3) {
      return (parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])) * 1000;
    }
    if (parts.length === 2) {
      return (parseFloat(parts[0]) * 60 + parseFloat(parts[1])) * 1000;
    }
    return 0;
  };

  const TIMING = /(\d{1,2}:\d{2}[:.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}[:.]\d{2,3})/;

  let i = 0;
  while (i < lines.length) {
    const match = TIMING.exec(lines[i]);
    if (match) {
      const start = timeMs(match[1]) / 1000;
      const end = timeMs(match[2]) / 1000;
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !TIMING.test(lines[i])) {
        const t = lines[i].replace(/<[^>]+>/g, '').trim();
        if (t) textLines.push(t);
        i++;
      }
      if (textLines.length) {
        segments.push({
          start,
          duration: Math.max(0.1, end - start),
          text: textLines.join(' '),
          formattedTime: formatTime(start),
        });
      }
    } else {
      i++;
    }
  }
  return segments;
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// ---------------------------------------------------------------------------
// Rate Limiting via KV with Fail-Closed on LLM Routes (F-09)
// ---------------------------------------------------------------------------

export async function rateLimit(
  ip: string,
  kv: KVNamespace | undefined,
  type: 'general' | 'llm'
): Promise<{ allowed: boolean; resetIn: number }> {
  if (!kv) {
    // If KV is unconfigured: fail closed on expensive paid routes
    return { allowed: type !== 'llm', resetIn: 60_000 };
  }

  const max = type === 'llm' ? 25 : 120;
  const windowMs = 60_000;
  const key = `rl:${type}:${ip}`;

  try {
    const raw = await kv.get<{ n: number; exp: number }>(key, 'json');
    const now = Date.now();
    if (!raw || now > raw.exp) {
      await kv.put(key, JSON.stringify({ n: 1, exp: now + windowMs }), { expirationTtl: 60 });
      return { allowed: true, resetIn: windowMs };
    }
    if (raw.n >= max) {
      return { allowed: false, resetIn: Math.max(1000, raw.exp - now) };
    }
    await kv.put(key, JSON.stringify({ n: raw.n + 1, exp: raw.exp }), { expirationTtl: 60 });
    return { allowed: true, resetIn: Math.max(1000, raw.exp - now) };
  } catch {
    // Fail closed on LLM routes when KV errors (F-09)
    if (type === 'llm') {
      return { allowed: false, resetIn: windowMs };
    }
    return { allowed: true, resetIn: windowMs };
  }
}

// ---------------------------------------------------------------------------
// Auth Helper for Cost-Bearing and User-Owned Endpoints (F-02, F-03)
// ---------------------------------------------------------------------------

export async function authenticateWorkerRequest(
  req: Request,
  env: Env
): Promise<VerifiedWorkerUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  const projectId = env.FIREBASE_PROJECT_ID || 'opentranscript-ai';
  return verifyFirebaseToken(token, projectId);
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

// --- /api/health ---
export async function handleHealth(env: Env): Promise<Response> {
  return json({
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    runtime: 'cloudflare-workers-pages-advanced',
    db: !!env.DB,
    cache: !!env.CACHE,
    providers: {
      gemini: !!env.GEMINI_API_KEY,
      openrouter: !!env.OPENROUTER_API_KEY,
      openai: !!env.OPENAI_API_KEY,
      groq: !!env.GROQ_API_KEY,
    },
  });
}

// --- /api/status ---
export async function handleStatus(env: Env): Promise<Response> {
  return json({
    status: 'ok',
    activeProviders: {
      gemini: !!env.GEMINI_API_KEY,
      openrouter: !!env.OPENROUTER_API_KEY,
      groq: !!env.GROQ_API_KEY,
      openai: !!env.OPENAI_API_KEY,
    },
    runtime: 'cloudflare-workers',
    timestamp: new Date().toISOString(),
  });
}

// --- /api/transcript ---
export async function handleTranscript(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const body = req.method === 'POST'
    ? await req.json().catch(() => ({})) as Record<string, string>
    : {};

  const rawInput = (
    body?.url || body?.rawText ||
    url.searchParams.get('url') ||
    url.searchParams.get('videoId') || ''
  ).trim();

  const customTitle = (body?.title || url.searchParams.get('title') || '').trim();

  if (!rawInput) {
    return json({ error: 'Provide a YouTube URL, video ID, subtitle URL, or transcript text.' }, 400);
  }

  const detected = detectSource(rawInput);

  // YouTube
  if (detected.type === 'youtube' && detected.videoId) {
    const videoId = detected.videoId;
    const cacheKey = `tr:${videoId}`;

    // 1. KV cache hit
    if (env.CACHE) {
      try {
        const cached = await env.CACHE.get(cacheKey, 'json') as object | null;
        if (cached) return json({ ok: true, ...cached, cached: true });
      } catch {}
    }

    // 2. Fetch metadata from YouTube Data API if available
    const apiKey = (env.GOOGLE_API_KEY || env.YOUTUBE_API_KEY || '').trim();
    const headerKey = req.headers.get('x-youtube-api-key') || '';
    const activeKey = (headerKey || apiKey).trim();

    let metadata: Record<string, unknown> = {
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: `YouTube Video (${videoId})`,
      authorName: 'YouTube Creator',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      sourceType: 'youtube',
      totalSegments: 0,
      totalWords: 0,
      estimatedTokens: 0,
    };

    if (activeKey) {
      try {
        const ytRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${activeKey}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (ytRes.ok) {
          const ytData = await ytRes.json() as any;
          const item = ytData.items?.[0];
          if (item?.snippet) {
            const s = item.snippet;
            const thumbs = s.thumbnails ?? {};
            metadata = {
              ...metadata,
              title: s.title ?? metadata.title,
              authorName: s.channelTitle ?? metadata.authorName,
              channelId: s.channelId ?? '',
              thumbnailUrl: thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? metadata.thumbnailUrl,
              description: s.description ?? '',
              publishedAt: s.publishedAt ?? '',
              viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : undefined,
              likeCount: item.statistics?.likeCount ? Number(item.statistics.likeCount) : undefined,
              hasCaptions: item.contentDetails?.caption === 'true',
            };
          }
        }
      } catch {}
    }

    // 3. Extract captions via YouTube public timedtext / page
    let segments: ParsedSegment[] = [];
    try {
      const captionUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const pageRes = await fetch(captionUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (pageRes.ok) {
        const html = await pageRes.text();
        const captionMatch = html.match(/"captionTracks":\[({.+?})\]/);
        if (captionMatch) {
          const trackMatch = captionMatch[0].match(/"baseUrl":"([^"]+)"/);
          if (trackMatch) {
            const captionBaseUrl = trackMatch[1].replace(/\\u0026/g, '&');
            const vttUrl = `${captionBaseUrl}&fmt=vtt`;
            const vttRes = await fetch(vttUrl, { signal: AbortSignal.timeout(6000) });
            if (vttRes.ok) {
              const vttText = await vttRes.text();
              segments = parseSubtitleText(vttText);
            }
          }
        }
      }
    } catch {}

    if (segments.length > 0) {
      const fullText = segments.map((s) => s.text).join(' ');
      const totalWords = fullText.split(/\s+/).filter(Boolean).length;
      const lastSeg = segments[segments.length - 1];
      const durationSeconds = Math.round(lastSeg.start + lastSeg.duration);
      const result = {
        metadata: {
          ...metadata,
          durationSeconds,
          durationFormatted: formatTime(durationSeconds),
          totalSegments: segments.length,
          totalWords,
          estimatedTokens: Math.round(totalWords * 1.33),
        },
        segments,
        fullText,
      };

      if (env.CACHE) {
        try {
          await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
        } catch {}
      }
      return json({ ok: true, ...result });
    }

    return json({
      ok: false,
      error:
        'YouTube captions could not be automatically extracted. ' +
        'Use "Paste Text", "Upload Audio/Video", or provide your YouTube API Key in Settings.',
      requiresManualOrKey: true,
      metadata,
    }, 404);
  }

  // Direct subtitle URL — hardened with SSRF protection and streaming size cap (F-05)
  if (detected.type === 'direct_subtitle') {
    try {
      const text = await fetchRemoteSubtitleWithSafety(rawInput);
      const segments = parseSubtitleText(text);
      if (!segments.length) {
        return json({ error: 'Could not parse subtitles from this URL.' }, 400);
      }
      const fullText = segments.map((s) => s.text).join(' ');
      const totalWords = fullText.split(/\s+/).filter(Boolean).length;
      return json({
        ok: true,
        metadata: {
          videoId: '',
          url: rawInput,
          title: customTitle || new URL(rawInput).pathname.split('/').pop() || 'Subtitle Document',
          sourceType: 'direct_subtitle',
          totalSegments: segments.length,
          totalWords,
          estimatedTokens: Math.round(totalWords * 1.33),
        },
        segments,
        fullText,
      });
    } catch (e: any) {
      return json({ error: `Could not fetch subtitle file: ${e.message}` }, 400);
    }
  }

  // Direct pasted text
  if (detected.type === 'direct_text' && rawInput.length > 25) {
    const segments = parseSubtitleText(rawInput);
    const fullText = segments.length ? segments.map((s) => s.text).join(' ') : rawInput;
    const totalWords = fullText.split(/\s+/).filter(Boolean).length;
    return json({
      ok: true,
      metadata: {
        videoId: '',
        url: '',
        title: customTitle || 'Pasted Transcript',
        sourceType: 'direct_text',
        totalSegments: segments.length || 1,
        totalWords,
        estimatedTokens: Math.round(totalWords * 1.33),
      },
      segments: segments.length ? segments : [{ start: 0, duration: 0, text: rawInput, formattedTime: '0:00' }],
      fullText,
    });
  }

  return json({ error: 'Unrecognized input. Provide a YouTube URL, subtitle file, or transcript text.' }, 400);
}

// ---------------------------------------------------------------------------
// AI Provider Execution Helpers (F-02, F-11)
// ---------------------------------------------------------------------------

function sanitizeModelId(model?: string): string {
  if (!model || typeof model !== 'string') return '';
  const trimmed = model.trim();
  if (/^[a-zA-Z0-9_\-\.\/:]+$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

async function executeAiGeneration(
  prompt: string,
  systemPrompt: string,
  options: {
    provider?: string;
    model?: string;
    openRouterKey?: string;
    geminiKey?: string;
    authenticatedUser: VerifiedWorkerUser | null;
    env: Env;
  }
): Promise<{ ok: boolean; markdown: string; modelUsed: string; providerUsed: string; error?: string }> {
  const { provider = 'gemini', model: reqModel, openRouterKey, geminiKey, authenticatedUser, env } = options;

  const userOrKey = (openRouterKey || '').trim();
  const hasUserKey = userOrKey.startsWith('sk-or-') && userOrKey.length >= 25;

  // Enforce authentication on server-side key usage (F-02)
  if (!hasUserKey && !authenticatedUser) {
    return {
      ok: false,
      markdown: '',
      modelUsed: '',
      providerUsed: '',
      error: 'Authentication or valid OpenRouter API key required to use AI endpoints.',
    };
  }

  // Separate user key path from server key fallback
  let activeProvider = provider;
  let activeKey = '';

  if (hasUserKey) {
    // Strictly use ONLY user's key; never fall back to server key
    activeProvider = 'openrouter';
    activeKey = userOrKey;
  } else {
    // Authenticated user utilizing server configured key
    if (activeProvider === 'gemini') {
      activeKey = (geminiKey || env.GEMINI_API_KEY || '').trim();
      if (!activeKey && env.OPENROUTER_API_KEY) {
        activeProvider = 'openrouter';
        activeKey = env.OPENROUTER_API_KEY.trim();
      }
    } else {
      activeKey = (env.OPENROUTER_API_KEY || '').trim();
    }
  }

  if (!activeKey) {
    return {
      ok: false,
      markdown: '',
      modelUsed: '',
      providerUsed: '',
      error: 'No AI provider API key configured. Provide an OpenRouter key or configure Cloudflare secrets.',
    };
  }

  const requestedModel = sanitizeModelId(reqModel);

  // Gemini Path
  if (activeProvider === 'gemini') {
    const modelToUse = requestedModel || 'gemini-2.0-flash-lite';
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${activeKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n---\n\n${prompt}` }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );
      if (!res.ok) {
        const err = await res.text();
        return { ok: false, markdown: '', modelUsed: modelToUse, providerUsed: 'gemini', error: `Gemini error: ${res.status} — ${err.slice(0, 200)}` };
      }
      const data = (await res.json()) as any;
      const markdown = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return { ok: true, markdown, modelUsed: modelToUse, providerUsed: 'gemini' };
    } catch (e: any) {
      return { ok: false, markdown: '', modelUsed: modelToUse, providerUsed: 'gemini', error: `Gemini call failed: ${e.message}` };
    }
  }

  // OpenRouter Path
  if (activeProvider === 'openrouter') {
    const modelToUse = requestedModel || 'meta-llama/llama-3.3-70b-instruct:free';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': env.APP_URL ?? 'https://opentranscript-ai.pages.dev',
          'X-Title': 'OpenTranscript AI',
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: 8192,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const err = await res.text();
        return { ok: false, markdown: '', modelUsed: modelToUse, providerUsed: 'openrouter', error: `OpenRouter error: ${res.status} — ${err.slice(0, 200)}` };
      }
      const data = (await res.json()) as any;
      const markdown = data?.choices?.[0]?.message?.content ?? '';
      return { ok: true, markdown, modelUsed: modelToUse, providerUsed: 'openrouter' };
    } catch (e: any) {
      return { ok: false, markdown: '', modelUsed: modelToUse, providerUsed: 'openrouter', error: `OpenRouter call failed: ${e.message}` };
    }
  }

  return { ok: false, markdown: '', modelUsed: '', providerUsed: '', error: `Unsupported provider "${activeProvider}"` };
}

// --- /api/summarize ---
export async function handleSummarize(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as any;
  const { transcript, summaryType = 'massive', provider, openRouterKey, model, openRouterModel, geminiKey } = body;

  if (!transcript || typeof transcript !== 'string') {
    return json({ error: 'Provide a transcript string in the request body.' }, 400);
  }

  const authenticatedUser = await authenticateWorkerRequest(req, env);
  const userOrKey = (openRouterKey || req.headers.get('x-openrouter-key') || '').trim();

  // Model selection parameter standardization (F-11)
  const selectedModel = model || openRouterModel;

  const truncated = transcript.slice(0, 90_000);
  const systemPrompt = `You are an expert video summarizer. Create a ${summaryType} summary of the following transcript. Use markdown headings, bullet points, and bold key terms. Include timestamps when referenced.`;

  const result = await executeAiGeneration(truncated, systemPrompt, {
    provider: provider || (env.GEMINI_API_KEY ? 'gemini' : 'openrouter'),
    model: selectedModel,
    openRouterKey: userOrKey,
    geminiKey,
    authenticatedUser,
    env,
  });

  if (!result.ok) {
    const status = result.error?.includes('Authentication') ? 401 : 502;
    return json({ ok: false, error: result.error }, status);
  }

  return json({
    ok: true,
    markdown: result.markdown,
    modelUsed: result.modelUsed,
    providerUsed: result.providerUsed,
  });
}

// --- /api/continue-summary ---
export async function handleContinueSummary(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as any;
  const { previousMarkdown, transcript, model, openRouterModel, provider, openRouterKey } = body;

  if (!previousMarkdown) {
    return json({ error: 'Previous summary text is required to continue.' }, 400);
  }

  const authenticatedUser = await authenticateWorkerRequest(req, env);
  const userOrKey = (openRouterKey || req.headers.get('x-openrouter-key') || '').trim();
  const selectedModel = model || openRouterModel;

  const prompt = `PREVIOUS SUMMARY SO FAR:\n${previousMarkdown.slice(-4000)}\n\nFULL TRANSCRIPT:\n${(transcript || '').slice(0, 80000)}`;
  const systemPrompt = `You are continuing an in-depth video summary seamlessly. Pick up immediately from where the previous summary stopped without repeating already covered headings.`;

  const result = await executeAiGeneration(prompt, systemPrompt, {
    provider: provider || 'openrouter',
    model: selectedModel,
    openRouterKey: userOrKey,
    authenticatedUser,
    env,
  });

  if (!result.ok) {
    const status = result.error?.includes('Authentication') ? 401 : 502;
    return json({ ok: false, error: result.error }, status);
  }

  return json({ ok: true, markdown: result.markdown, modelUsed: result.modelUsed, providerUsed: result.providerUsed });
}

// --- /api/deep-dive ---
export async function handleDeepDive(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as any;
  const { topic, transcript, model, openRouterModel, provider, openRouterKey } = body;

  if (!topic || !transcript) {
    return json({ error: 'Topic and transcript are required.' }, 400);
  }

  const authenticatedUser = await authenticateWorkerRequest(req, env);
  const userOrKey = (openRouterKey || req.headers.get('x-openrouter-key') || '').trim();
  const selectedModel = model || openRouterModel;

  const prompt = `TOPIC TO EXPLORE:\n${topic}\n\nVIDEO TRANSCRIPT:\n${transcript.slice(0, 80000)}`;
  const systemPrompt = `You are an expert technical analyst. Provide an exhaustive, rigorous deep dive into the specified topic using evidence from the transcript. Cite timestamps whenever applicable.`;

  const result = await executeAiGeneration(prompt, systemPrompt, {
    provider: provider || 'openrouter',
    model: selectedModel,
    openRouterKey: userOrKey,
    authenticatedUser,
    env,
  });

  if (!result.ok) {
    const status = result.error?.includes('Authentication') ? 401 : 502;
    return json({ ok: false, error: result.error }, status);
  }

  return json({ ok: true, markdown: result.markdown, modelUsed: result.modelUsed, providerUsed: result.providerUsed });
}

// --- /api/chat ---
export async function handleChat(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as any;
  const { question, transcript, segments, title = 'Video', model, openRouterModel, provider, openRouterKey } = body;

  if (!question || !transcript) {
    return json({ error: 'Question and transcript are required.' }, 400);
  }

  const authenticatedUser = await authenticateWorkerRequest(req, env);
  const userOrKey = (openRouterKey || req.headers.get('x-openrouter-key') || '').trim();
  const selectedModel = model || openRouterModel;

  // Grounded RAG retrieval
  const transcriptIndex = createTranscriptIndex(transcript, segments);
  const retrievedPassages = retrieveWithMultiQueryRRF(transcriptIndex, question, 7, 2);
  const groundedContextBlock = formatRetrievedContextForPrompt(retrievedPassages);
  const keyFacts = extractGroundedFacts(transcriptIndex, question, 3);
  const factsBlock = keyFacts.length > 0
    ? `\nVERIFIED AUDIO FACTS & METRICS:\n${keyFacts.map((f) => `- [${f.timestamp}] ${f.fact}`).join('\n')}\n`
    : '';

  const prompt = `VIDEO TITLE: ${title}
${groundedContextBlock}
${factsBlock}
USER QUESTION:
${question}

VIDEO FULL TRANSCRIPT CONTEXT:
${transcript.slice(0, 90000)}
`;

  const systemPrompt = `You are a knowledgeable assistant who watched the video and answers user questions grounded in the video transcript. Always cite [MM:SS] timestamps where information is mentioned.`;

  const result = await executeAiGeneration(prompt, systemPrompt, {
    provider: provider || 'openrouter',
    model: selectedModel,
    openRouterKey: userOrKey,
    authenticatedUser,
    env,
  });

  if (!result.ok) {
    const status = result.error?.includes('Authentication') ? 401 : 502;
    return json({ ok: false, error: result.error }, status);
  }

  return json({ ok: true, answer: result.markdown, response: result.markdown, modelUsed: result.modelUsed, providerUsed: result.providerUsed });
}

// --- /api/translate ---
export async function handleTranslate(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as any;
  const { text, targetLanguage = 'Spanish', model, openRouterModel, provider, openRouterKey } = body;

  if (!text) {
    return json({ error: 'Text to translate is required.' }, 400);
  }

  const authenticatedUser = await authenticateWorkerRequest(req, env);
  const userOrKey = (openRouterKey || req.headers.get('x-openrouter-key') || '').trim();
  const selectedModel = model || openRouterModel;

  const prompt = `Translate the following markdown text accurately into ${targetLanguage}. Preserve all markdown formatting, headings, bullet points, and [MM:SS] timestamp tags:\n\n${text.slice(0, 50000)}`;
  const systemPrompt = `You are an expert technical translator. Translate the markdown text faithfully into ${targetLanguage} while strictly retaining timestamps and markdown structure.`;

  const result = await executeAiGeneration(prompt, systemPrompt, {
    provider: provider || 'openrouter',
    model: selectedModel,
    openRouterKey: userOrKey,
    authenticatedUser,
    env,
  });

  if (!result.ok) {
    const status = result.error?.includes('Authentication') ? 401 : 502;
    return json({ ok: false, error: result.error }, status);
  }

  return json({ ok: true, translatedText: result.markdown, modelUsed: result.modelUsed });
}

// --- /api/extract-key-ideas ---
export async function handleExtractKeyIdeas(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as any;
  const { transcript, model, openRouterModel, provider, openRouterKey } = body;

  if (!transcript) {
    return json({ error: 'Transcript is required.' }, 400);
  }

  const authenticatedUser = await authenticateWorkerRequest(req, env);
  const userOrKey = (openRouterKey || req.headers.get('x-openrouter-key') || '').trim();
  const selectedModel = model || openRouterModel;

  const prompt = `Extract the top 5 crucial insights and takeaways from this transcript in clear structured markdown with [MM:SS] timestamps:\n\n${transcript.slice(0, 60000)}`;
  const systemPrompt = `You are an executive research analyst. Extract key ideas concisely with high factual fidelity and timestamps.`;

  const result = await executeAiGeneration(prompt, systemPrompt, {
    provider: provider || 'openrouter',
    model: selectedModel,
    openRouterKey: userOrKey,
    authenticatedUser,
    env,
  });

  if (!result.ok) {
    const status = result.error?.includes('Authentication') ? 401 : 502;
    return json({ ok: false, error: result.error }, status);
  }

  return json({ ok: true, ideas: result.markdown, markdown: result.markdown, modelUsed: result.modelUsed });
}

// --- /api/dictionary-knowledge ---
export async function handleDictionaryKnowledge(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const context = (url.searchParams.get('context') || '').trim();

  if (!q) {
    return json({ error: 'Term query q is required.' }, 400);
  }

  try {
    // Query public Free Dictionary API with timeout
    const dictRes = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q.toLowerCase())}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (dictRes.ok) {
      const data = (await dictRes.json()) as any[];
      const entry = data?.[0];
      if (entry) {
        const meanings = entry.meanings || [];
        const firstMeaning = meanings[0];
        const definition = firstMeaning?.definitions?.[0]?.definition || '';
        const example = firstMeaning?.definitions?.[0]?.example || '';
        const partOfSpeech = firstMeaning?.partOfSpeech || 'noun';

        return json({
          ok: true,
          term: q,
          partOfSpeech,
          definition,
          example,
          contextSnippet: context,
          source: 'dictionaryapi.dev',
        });
      }
    }
  } catch {}

  // Fallback term explanation
  return json({
    ok: true,
    term: q,
    partOfSpeech: 'concept',
    definition: `Key technical concept referenced in "${context || 'transcript'}".`,
    example: `Term usage in domain discussion.`,
    contextSnippet: context,
    source: 'inferred',
  });
}

// ---------------------------------------------------------------------------
// Search & External Details Endpoints (F-07)
// ---------------------------------------------------------------------------

export async function handleYouTubeDetails(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const videoId = (url.searchParams.get('videoId') || '').trim();
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return json({ error: 'Valid 11-character videoId is required.' }, 400);
  }

  const apiKey = (req.headers.get('x-youtube-api-key') || env.GOOGLE_API_KEY || env.YOUTUBE_API_KEY || '').trim();
  if (!apiKey) {
    return json({
      ok: true,
      videoId,
      title: `YouTube Video (${videoId})`,
      authorName: 'YouTube Creator',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      const item = data.items?.[0];
      if (item?.snippet) {
        return json({
          ok: true,
          videoId,
          title: item.snippet.title,
          authorName: item.snippet.channelTitle,
          thumbnailUrl: item.snippet.thumbnails?.high?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          viewCount: item.statistics?.viewCount,
        });
      }
    }
  } catch {}

  return json({
    ok: true,
    videoId,
    title: `YouTube Video (${videoId})`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  });
}

export async function handleYouTubeSearch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const page = parseInt(url.searchParams.get('page') || '0', 10);
  if (!q) return json({ error: 'Search query q is required.' }, 400);

  const apiKey = (req.headers.get('x-youtube-api-key') || env.GOOGLE_API_KEY || env.YOUTUBE_API_KEY || '').trim();
  if (!apiKey) {
    return json({ ok: true, results: [], message: 'YouTube API key not configured.' });
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=10&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      const items = (data.items || []).map((it: any) => ({
        id: it.id?.videoId,
        title: it.snippet?.title,
        description: it.snippet?.description,
        thumbnail: it.snippet?.thumbnails?.medium?.url,
        channelTitle: it.snippet?.channelTitle,
        url: `https://www.youtube.com/watch?v=${it.id?.videoId}`,
      }));
      return json({ ok: true, results: items, page });
    }
  } catch (e: any) {
    return json({ error: `YouTube search error: ${e.message}` }, 502);
  }

  return json({ ok: true, results: [] });
}

export async function handleBooksSearch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'Query q is required.' }, 400);

  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      const items = (data.items || []).map((b: any) => ({
        title: b.volumeInfo?.title,
        authors: b.volumeInfo?.authors,
        description: b.volumeInfo?.description,
        infoLink: b.volumeInfo?.infoLink,
        thumbnail: b.volumeInfo?.imageLinks?.thumbnail,
      }));
      return json({ ok: true, results: items });
    }
  } catch {}

  return json({ ok: true, results: [] });
}

export async function handleAcademicSearch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'Query q is required.' }, 400);

  try {
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=6&fields=title,abstract,authors,year,url`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      return json({ ok: true, results: data.data || [] });
    }
  } catch {}

  return json({ ok: true, results: [] });
}

export async function handleGithubSearch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'Query q is required.' }, 400);

  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=6`,
      {
        headers: { 'User-Agent': 'OpenTranscript-AI/1.0', 'Accept': 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      const items = (data.items || []).map((r: any) => ({
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        stars: r.stargazers_count,
        url: r.html_url,
      }));
      return json({ ok: true, results: items });
    }
  } catch {}

  return json({ ok: true, results: [] });
}

export async function handleWebSearch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'Query q is required.' }, 400);

  // If Google CSE configured
  if (env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        const items = (data.items || []).map((it: any) => ({
          title: it.title,
          snippet: it.snippet,
          link: it.link,
        }));
        return json({ ok: true, results: items });
      }
    } catch {}
  }

  return json({ ok: true, results: [] });
}

export async function handleImageProxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const imageUrl = (url.searchParams.get('url') || '').trim();

  if (!imageUrl || !isSafeWorkerUrl(imageUrl)) {
    return json({ error: 'Valid, public image URL required.' }, 400);
  }

  try {
    const res = await fetch(imageUrl, {
      headers: { 'Accept': 'image/*' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return json({ error: `Remote image returned ${res.status}` }, 502);

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return json({ error: 'Destination is not an image.' }, 400);
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e: any) {
    return json({ error: `Image proxy failed: ${e.message}` }, 502);
  }
}

// --- /api/transcribe-audio ---
export async function handleTranscribeAudio(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as any;
  const { audioBase64, mimeType = 'audio/mp3', filename = 'Audio' } = body;

  if (!audioBase64) {
    return json({ error: 'Audio payload audioBase64 is required.' }, 400);
  }

  const authenticatedUser = await authenticateWorkerRequest(req, env);
  if (!authenticatedUser) {
    return json({ error: 'Authentication required for audio transcription.' }, 401);
  }

  const geminiKey = (env.GEMINI_API_KEY || '').trim();
  if (!geminiKey) {
    return json({ error: 'Gemini API key is not configured for audio transcription.' }, 503);
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: audioBase64,
                  },
                },
                {
                  text: 'Transcribe this audio recording into accurate, timestamped text format [MM:SS] Text.',
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return json({ error: `Gemini audio transcription error: ${err.slice(0, 200)}` }, 502);
    }

    const data = (await res.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const segments = parseSubtitleText(text);

    return json({
      ok: true,
      text,
      segments: segments.length ? segments : [{ start: 0, duration: 0, text, formattedTime: '0:00' }],
      filename,
    });
  } catch (e: any) {
    return json({ error: `Audio transcription error: ${e.message}` }, 500);
  }
}

// ---------------------------------------------------------------------------
// D1 Persistence Routes with Scoped Identity & User Bootstrap (F-03, F-04)
// ---------------------------------------------------------------------------

export async function handleLists(req: Request, env: Env, listId?: string): Promise<Response> {
  const user = await authenticateWorkerRequest(req, env);
  if (!user) {
    return json({ error: 'Authentication required' }, 401);
  }

  const db = new CloudflareDbService(env.DB);

  if (req.method === 'GET') {
    // Strictly scope query by verified token UID (F-03)
    const lists = await db.getLists(user.uid);
    return json({ ok: true, lists });
  }

  if (req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as any;
    const id = await db.createList(
      user.uid,
      body.name || 'New List',
      body.description || '',
      body.category || 'general'
    );
    return json({ ok: true, id });
  }

  if ((req.method === 'PATCH' || req.method === 'PUT') && listId) {
    const body = (await req.json().catch(() => ({}))) as any;
    const success = await db.updateList(listId, user.uid, {
      name: body.name,
      description: body.description,
      category: body.category,
    });
    return json({ ok: success });
  }

  if (req.method === 'DELETE' && listId) {
    const success = await db.deleteList(listId, user.uid);
    return json({ ok: success });
  }

  return json({ error: 'Method not allowed' }, 405);
}

export async function handleListItems(
  req: Request,
  env: Env,
  listId: string,
  itemId?: string
): Promise<Response> {
  const user = await authenticateWorkerRequest(req, env);
  if (!user) {
    return json({ error: 'Authentication required' }, 401);
  }

  const db = new CloudflareDbService(env.DB);

  if (req.method === 'GET') {
    const items = await db.getListItems(listId, user.uid);
    return json({ ok: true, items });
  }

  if (req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as any;
    try {
      const id = await db.addListItem(listId, user.uid, {
        item_type: body.itemType || body.item_type || 'note',
        title: body.title || 'Item',
        url: body.url || '',
        subtitle: body.subtitle || '',
        content: body.content || '',
        notes: body.notes || '',
      });
      return json({ ok: true, id });
    } catch (e: any) {
      return json({ error: e.message }, 403);
    }
  }

  if (req.method === 'PATCH' && itemId) {
    const body = (await req.json().catch(() => ({}))) as any;
    const success = await db.updateListItem(itemId, user.uid, {
      title: body.title,
      notes: body.notes,
    });
    return json({ ok: success });
  }

  if (req.method === 'DELETE' && itemId) {
    const success = await db.deleteListItem(itemId, user.uid);
    return json({ ok: success });
  }

  return json({ error: 'Method not allowed' }, 405);
}

export async function handleSummaries(req: Request, env: Env, summaryId?: string): Promise<Response> {
  const user = await authenticateWorkerRequest(req, env);
  if (!user) {
    return json({ error: 'Authentication required' }, 401);
  }

  const db = new CloudflareDbService(env.DB);

  if (req.method === 'GET') {
    const summaries = await db.getSummaries(user.uid);
    return json({ ok: true, summaries });
  }

  if (req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as any;
    const id = await db.saveSummary(user.uid, {
      video_id: body.videoId || body.video_id || '',
      video_url: body.videoUrl || body.video_url || '',
      video_title: body.videoTitle || body.video_title || 'Summary',
      author_name: body.authorName || body.author_name || 'YouTube',
      summary_type: body.summaryType || body.summary_type || 'massive',
      markdown: body.markdown || '',
    });
    return json({ ok: true, id });
  }

  if (req.method === 'DELETE' && summaryId) {
    const success = await db.deleteSummary(summaryId, user.uid);
    return json({ ok: success });
  }

  return json({ error: 'Method not allowed' }, 405);
}

export async function handleActivity(req: Request, env: Env, activityId?: string): Promise<Response> {
  const user = await authenticateWorkerRequest(req, env);
  if (!user) {
    return json({ error: 'Authentication required' }, 401);
  }

  const db = new CloudflareDbService(env.DB);

  if (req.method === 'GET') {
    const items = await db.getActivityHistory(user.uid);
    return json({ ok: true, items });
  }

  if (req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as any;
    const id = await db.logActivity(user.uid, {
      action_type: body.actionType || body.action_type || 'video',
      query_or_title: body.queryOrTitle || body.query_or_title || '',
      detail: body.detail || '',
      url: body.url || '',
      video_id: body.videoId || body.video_id || '',
      date_key: body.dateKey || body.date_key,
    });
    return json({ ok: true, id });
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url);
    const dateKey = url.searchParams.get('dateKey');
    const all = url.searchParams.get('all');
    if (activityId) {
      const success = await db.deleteActivity(activityId, user.uid);
      return json({ ok: success });
    }
    if (dateKey) {
      const success = await db.clearActivityByDate(dateKey, user.uid);
      return json({ ok: success });
    }
    if (all === 'true') {
      const success = await db.clearAllActivity(user.uid);
      return json({ ok: success });
    }
    return json({ error: 'Target activity ID, dateKey, or all=true required' }, 400);
  }

  return json({ error: 'Method not allowed' }, 405);
}

// ---------------------------------------------------------------------------
// Main Worker Fetch Dispatcher (F-01, F-06, F-07)
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('origin') || '';

    // CORS preflight (F-06: strictly reject unauthorized origins)
    if (request.method === 'OPTIONS') {
      return handleCorsPreflight(request, env);
    }

    // Rate limiting for /api routes (F-09: fail closed on paid routes if KV errors)
    if (path.startsWith('/api/')) {
      const ip = request.headers.get('cf-connecting-ip') || '127.0.0.1';
      const isLlm = [
        '/api/summarize',
        '/api/continue-summary',
        '/api/deep-dive',
        '/api/chat',
        '/api/translate',
        '/api/extract-key-ideas',
        '/api/transcribe-audio',
        '/api/tts',
      ].includes(path);

      const rl = await rateLimit(ip, env.CACHE, isLlm ? 'llm' : 'general');
      if (!rl.allowed) {
        const retryAfter = String(Math.ceil(rl.resetIn / 1000));
        const resCors = corsHeaders(origin, env);
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Rate limit exceeded or quota service temporarily unavailable.',
            retryAfter,
          }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': retryAfter, ...resCors },
          }
        );
      }
    }

    // API Route Table (F-07)
    let response: Response;

    if (path === '/api/health') {
      response = await handleHealth(env);
    } else if (path === '/api/status') {
      response = await handleStatus(env);
    } else if (path === '/api/transcript') {
      response = await handleTranscript(request, env);
    } else if (path === '/api/summarize') {
      response = await handleSummarize(request, env);
    } else if (path === '/api/continue-summary') {
      response = await handleContinueSummary(request, env);
    } else if (path === '/api/deep-dive') {
      response = await handleDeepDive(request, env);
    } else if (path === '/api/chat') {
      response = await handleChat(request, env);
    } else if (path === '/api/translate') {
      response = await handleTranslate(request, env);
    } else if (path === '/api/extract-key-ideas') {
      response = await handleExtractKeyIdeas(request, env);
    } else if (path === '/api/dictionary-knowledge') {
      response = await handleDictionaryKnowledge(request);
    } else if (path === '/api/youtube-details' || path === '/api/youtube/details') {
      response = await handleYouTubeDetails(request, env);
    } else if (path === '/api/youtube-search' || path === '/api/youtube/search') {
      response = await handleYouTubeSearch(request, env);
    } else if (path === '/api/books-search') {
      response = await handleBooksSearch(request);
    } else if (path === '/api/academic-search') {
      response = await handleAcademicSearch(request);
    } else if (path === '/api/github-search') {
      response = await handleGithubSearch(request);
    } else if (path === '/api/community-search') {
      response = json({ ok: true, results: [] });
    } else if (path === '/api/podcasts-datasets') {
      response = json({ ok: true, results: [] });
    } else if (path === '/api/web-search') {
      response = await handleWebSearch(request, env);
    } else if (path === '/api/image-search' || path === '/api/news-search') {
      response = json({ ok: true, results: [] });
    } else if (path === '/api/image-proxy') {
      response = await handleImageProxy(request);
    } else if (path === '/api/transcribe-audio') {
      response = await handleTranscribeAudio(request, env);
    } else if (path === '/api/tts') {
      response = json({
        ok: false,
        error: 'Edge TTS is supported locally on Node or with ELEVENLABS_API_KEY. Speech will fall back to browser Web Speech API.',
      }, 501);
    } else if (/^\/api\/lists(\/[^/]+)?$/.test(path)) {
      const parts = path.split('/');
      const listId = parts[3];
      response = await handleLists(request, env, listId);
    } else if (/^\/api\/lists\/[^/]+\/items(\/[^/]+)?$/.test(path)) {
      const parts = path.split('/');
      const listId = parts[3];
      const itemId = parts[5];
      response = await handleListItems(request, env, listId, itemId);
    } else if (/^\/api\/summaries(\/[^/]+)?$/.test(path)) {
      const parts = path.split('/');
      const summaryId = parts[3];
      response = await handleSummaries(request, env, summaryId);
    } else if (/^\/api\/activity(\/[^/]+)?$/.test(path)) {
      const parts = path.split('/');
      const activityId = parts[3];
      response = await handleActivity(request, env, activityId);
    } else if (path.startsWith('/api/')) {
      response = json({ error: 'Endpoint not found', path }, 404);
    } else {
      // Non-API paths — Cloudflare Pages Advanced Mode serves static assets (F-01)
      if (env.ASSETS) {
        return env.ASSETS.fetch(request as any) as unknown as Response;
      }
      return new Response('Not Found', { status: 404 });
    }

    // Attach hardened CORS headers to API responses (F-06)
    const out = new Response(response.body, response);
    const cors = corsHeaders(origin, env);
    for (const [k, v] of Object.entries(cors)) {
      out.headers.set(k, v);
    }
    return out;
  },
};
