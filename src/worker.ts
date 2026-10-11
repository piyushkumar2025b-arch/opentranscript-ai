/**
 * OpenTranscript AI — Cloudflare Workers Entry Point
 *
 * Fully self-contained: uses only the Fetch API and Web Platform APIs
 * available in the Cloudflare Workers runtime. No Node.js imports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ENVIRONMENT?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  APP_URL?: string;
  ALLOWED_ORIGINS?: string;
}

interface ParsedSegment {
  start: number;
  duration: number;
  text: string;
  formattedTime: string;
}

// ---------------------------------------------------------------------------
// Utilities — inlined so no Node.js imports are needed
// ---------------------------------------------------------------------------

const VALID_YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
]);

function extractVideoId(urlOrId: string): string | null {
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

type SourceType = 'youtube' | 'direct_subtitle' | 'direct_text' | 'web_article' | 'other';

function detectSource(raw: string): { type: SourceType; videoId?: string } {
  const trimmed = raw.trim();

  // YouTube
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

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Very lightweight VTT/SRT parser that runs in V8 without Node.js modules */
function parseSubtitleText(raw: string): ParsedSegment[] {
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

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function corsHeaders(origin: string, env: Env): Record<string, string> {
  const allowed = new Set<string>(
    [
      env.APP_URL,
      ...(env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) ?? []),
    ].filter(Boolean) as string[]
  );

  const ok =
    allowed.has(origin) ||
    origin.endsWith('.pages.dev') ||
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1');

  return {
    'Access-Control-Allow-Origin': ok ? origin : (env.APP_URL ?? '*'),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-YouTube-API-Key, X-OpenRouter-Key, X-YouTube-Cookies',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// ---------------------------------------------------------------------------
// Rate limiting via KV
// ---------------------------------------------------------------------------

async function rateLimit(
  ip: string,
  kv: KVNamespace,
  type: 'general' | 'llm'
): Promise<{ allowed: boolean; resetIn: number }> {
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
    if (raw.n >= max) return { allowed: false, resetIn: raw.exp - now };
    await kv.put(key, JSON.stringify({ n: raw.n + 1, exp: raw.exp }), { expirationTtl: 60 });
    return { allowed: true, resetIn: raw.exp - now };
  } catch {
    return { allowed: true, resetIn: windowMs };
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleHealth(env: Env): Promise<Response> {
  return json({
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    runtime: 'cloudflare-workers',
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

// --- /api/transcript ---
async function handleTranscript(req: Request, env: Env): Promise<Response> {
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

  // ---------- YouTube ----------
  if (detected.type === 'youtube' && detected.videoId) {
    const videoId = detected.videoId;
    const cacheKey = `tr:${videoId}`;

    // 1. KV cache hit
    const cached = await env.CACHE.get(cacheKey, 'json') as object | null;
    if (cached) return json({ ok: true, ...cached, cached: true });

    // 2. Fetch metadata from YouTube Data API
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
      } catch { /* fall through with default metadata */ }
    }

    // 3. Try to fetch captions via YouTube's timedtext API (no auth needed for auto-captions)
    let segments: ParsedSegment[] = [];
    try {
      // Attempt to get the VTT caption track directly
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
        // Extract captionTracks JSON from YouTube page
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
    } catch { /* no captions available */ }

    if (segments.length > 0) {
      const fullText = segments.map(s => s.text).join(' ');
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
      // Cache for 1 hour
      await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
      return json({ ok: true, ...result });
    }

    // 4. No captions — return metadata + guidance
    return json({
      ok: false,
      error:
        'YouTube captions could not be automatically extracted. ' +
        'Use "Paste Text", "Upload Audio/Video", or provide your YouTube API Key in Settings.',
      requiresManualOrKey: true,
      metadata,
    }, 404);
  }

  // ---------- Direct subtitle URL ----------
  if (detected.type === 'direct_subtitle') {
    try {
      const res = await fetch(rawInput, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const segments = parseSubtitleText(text);
      if (!segments.length) {
        return json({ error: 'Could not parse subtitles from this URL.' }, 400);
      }
      const fullText = segments.map(s => s.text).join(' ');
      const totalWords = fullText.split(/\s+/).filter(Boolean).length;
      return json({
        ok: true,
        metadata: {
          videoId: '', url: rawInput,
          title: customTitle || new URL(rawInput).pathname.split('/').pop() || 'Subtitle Document',
          sourceType: 'direct_subtitle',
          totalSegments: segments.length, totalWords,
          estimatedTokens: Math.round(totalWords * 1.33),
        },
        segments, fullText,
      });
    } catch (e: any) {
      return json({ error: `Could not fetch subtitle file: ${e.message}` }, 400);
    }
  }

  // ---------- Direct pasted text ----------
  if (detected.type === 'direct_text' && rawInput.length > 25) {
    const segments = parseSubtitleText(rawInput);
    const fullText = segments.length
      ? segments.map(s => s.text).join(' ')
      : rawInput;
    const totalWords = fullText.split(/\s+/).filter(Boolean).length;
    return json({
      ok: true,
      metadata: {
        videoId: '', url: '',
        title: customTitle || 'Pasted Transcript',
        sourceType: 'direct_text',
        totalSegments: segments.length || 1, totalWords,
        estimatedTokens: Math.round(totalWords * 1.33),
      },
      segments: segments.length ? segments : [{ start: 0, duration: 0, text: rawInput, formattedTime: '0:00' }],
      fullText,
    });
  }

  return json({ error: 'Unrecognized input. Provide a YouTube URL, subtitle file, or transcript text.' }, 400);
}

// --- /api/summarize ---
async function handleSummarize(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => ({})) as any;
  const { transcript, summaryType = 'massive', provider = 'gemini', openRouterKey, openRouterModel, geminiKey } = body;

  if (!transcript || typeof transcript !== 'string') {
    return json({ error: 'Provide a transcript string in the request body.' }, 400);
  }

  // Resolve API key and provider
  const resolvedGeminiKey = (geminiKey || env.GEMINI_API_KEY || '').trim();
  const resolvedOrKey = (openRouterKey || req.headers.get('x-openrouter-key') || env.OPENROUTER_API_KEY || '').trim();

  const useGemini = provider === 'gemini' && resolvedGeminiKey;
  const useOpenRouter = provider === 'openrouter' && resolvedOrKey;

  if (!useGemini && !useOpenRouter) {
    return json({
      error: 'No AI provider API key configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY as a Cloudflare secret.',
    }, 400);
  }

  const truncated = transcript.slice(0, 90_000);
  const systemPrompt = `You are an expert video summarizer. Create a ${summaryType} summary of the following transcript. Use markdown headings, bullet points, and bold key terms. Include timestamps when referenced.`;

  try {
    if (useGemini) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${resolvedGeminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n---\n\n${truncated}` }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );
      if (!res.ok) {
        const err = await res.text();
        return json({ error: `Gemini API error: ${res.status} — ${err.slice(0, 300)}` }, 502);
      }
      const data = await res.json() as any;
      const markdown = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return json({ ok: true, markdown, modelUsed: 'gemini-2.0-flash-lite', providerUsed: 'gemini' });
    }

    if (useOpenRouter) {
      const model = openRouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resolvedOrKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': env.APP_URL ?? 'https://opentranscript-ai.pages.dev',
          'X-Title': 'OpenTranscript AI',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: truncated },
          ],
          max_tokens: 8192,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const err = await res.text();
        return json({ error: `OpenRouter API error: ${res.status} — ${err.slice(0, 300)}` }, 502);
      }
      const data = await res.json() as any;
      const markdown = data?.choices?.[0]?.message?.content ?? '';
      return json({ ok: true, markdown, modelUsed: model, providerUsed: 'openrouter' });
    }
  } catch (e: any) {
    return json({ error: `AI provider error: ${e.message}` }, 500);
  }

  return json({ error: 'Could not process the request.' }, 500);
}

// --- /api/lists ---
async function handleLists(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const ownerId = url.searchParams.get('userId') || 'local_user';
    const rows = await env.DB.prepare(
      'SELECT * FROM saved_lists WHERE owner_id = ? ORDER BY updated_at DESC'
    ).bind(ownerId).all();
    return json({ ok: true, lists: rows.results });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as any;
    const id = `list_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await env.DB.prepare(
      `INSERT INTO saved_lists (id, owner_id, name, description, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, body.ownerId || 'local_user', body.name || 'New List', body.description || '', body.category || 'general').run();
    return json({ ok: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}

// --- /api/lists/:id/items ---
async function handleListItems(req: Request, env: Env, listId: string): Promise<Response> {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const ownerId = url.searchParams.get('userId') || 'local_user';
    const rows = await env.DB.prepare(
      'SELECT * FROM list_items WHERE list_id = ? AND owner_id = ? ORDER BY created_at DESC'
    ).bind(listId, ownerId).all();
    return json({ ok: true, items: rows.results });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as any;
    const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await env.DB.prepare(
      `INSERT INTO list_items (id, list_id, owner_id, item_type, title, url, subtitle, content, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, listId, body.ownerId || 'local_user', body.itemType || 'note', body.title || 'Item',
      body.url || '', body.subtitle || '', body.content || '', body.notes || '').run();
    return json({ ok: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}

// --- /api/summaries ---
async function handleSummaries(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const ownerId = url.searchParams.get('userId') || 'local_user';
    const rows = await env.DB.prepare(
      'SELECT id, owner_id, video_id, video_title, author_name, summary_type, created_at, updated_at FROM saved_summaries WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 50'
    ).bind(ownerId).all();
    return json({ ok: true, summaries: rows.results });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as any;
    const id = `sum_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await env.DB.prepare(
      `INSERT INTO saved_summaries (id, owner_id, video_id, video_url, video_title, author_name, summary_type, markdown, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, body.ownerId || 'local_user', body.videoId || '', body.videoUrl || '',
      body.videoTitle || 'Summary', body.authorName || 'YouTube',
      body.summaryType || 'massive', body.markdown || '').run();
    return json({ ok: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}

// --- /api/activity ---
async function handleActivity(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const ownerId = url.searchParams.get('userId') || 'local_user';
    const rows = await env.DB.prepare(
      'SELECT * FROM activity_history WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(ownerId).all();
    return json({ ok: true, items: rows.results });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as any;
    const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const dateKey = body.dateKey || new Date().toISOString().split('T')[0];
    await env.DB.prepare(
      `INSERT INTO activity_history (id, owner_id, action_type, query_or_title, detail, url, video_id, date_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, body.ownerId || 'local_user', body.actionType || 'video',
      body.queryOrTitle || '', body.detail || '', body.url || '',
      body.videoId || '', dateKey).run();
    return json({ ok: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin, env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Rate limiting for all /api routes
    if (path.startsWith('/api/')) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const isLlm = ['/api/summarize', '/api/chat', '/api/tts', '/api/transcribe-audio'].includes(path);
      const rl = await rateLimit(ip, env.CACHE, isLlm ? 'llm' : 'general');
      if (!rl.allowed) {
        const retryAfter = String(Math.ceil(rl.resetIn / 1000));
        return new Response(
          JSON.stringify({ ok: false, error: 'Rate limit exceeded. Please wait before retrying.', retryAfter }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': retryAfter, ...cors } }
        );
      }
    }

    // Route dispatch
    let response: Response;

    if (path === '/api/health') {
      response = await handleHealth(env);
    } else if (path === '/api/transcript') {
      response = await handleTranscript(request, env);
    } else if (path === '/api/summarize') {
      response = await handleSummarize(request, env);
    } else if (path === '/api/lists') {
      response = await handleLists(request, env);
    } else if (/^\/api\/lists\/[^/]+\/items$/.test(path)) {
      const listId = path.split('/')[3];
      response = await handleListItems(request, env, listId);
    } else if (path === '/api/summaries') {
      response = await handleSummaries(request, env);
    } else if (path === '/api/activity') {
      response = await handleActivity(request, env);
    } else if (path.startsWith('/api/')) {
      response = json({ error: 'Not found', path }, 404);
    } else {
      // Non-API paths — Cloudflare Pages serves static files
      return fetch(request);
    }

    // Attach CORS headers to every API response
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
