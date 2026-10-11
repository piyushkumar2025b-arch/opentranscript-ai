/**
 * OpenTranscript AI - Cloudflare Workers Entry Point
 * 
 * This worker replaces the Express server.ts for deployment on Cloudflare's edge network.
 * It handles API routes, D1 database operations, and integrates with AI providers.
 */

import { extractVideoId, formatTime, parseSubtitlePayload } from './server/transcriptHelper';
import { detectMediaSourceType } from './server/mediaExtractor';

// Type definitions
interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ENVIRONMENT: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  APP_URL?: string;
  ALLOWED_ORIGINS?: string;
}

interface RequestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
}

// CORS headers
function getCorsHeaders(origin: string, env: Env): HeadersInit {
  const allowedOrigins = new Set(
    [
      env.APP_URL,
      env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [],
    ].flat().filter(Boolean)
  );

  const normalizedOrigin = origin?.toLowerCase() || '';
  const isAllowed = allowedOrigins.has(normalizedOrigin) || 
                    normalizedOrigin.includes('.pages.dev') ||
                    normalizedOrigin.includes('localhost');

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : (env.APP_URL || '*'),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-YouTube-API-Key, X-OpenRouter-Key',
    'Access-Control-Max-Age': '86400',
  };
}

// Rate limiting using KV namespace
async function checkRateLimit(
  ip: string, 
  cache: KVNamespace, 
  route: 'general' | 'llm'
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const key = `ratelimit:${ip}:${route}`;
  const windowMs = 60000; // 1 minute
  const maxRequests = route === 'llm' ? 25 : 120;

  try {
    const data = await cache.get(key, 'json') as { count: number; expires: number } | null;
    const now = Date.now();

    if (!data || now > data.expires) {
      await cache.put(key, JSON.stringify({ count: 1, expires: now + windowMs }), {
        expirationTtl: 60,
      });
      return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
    }

    if (data.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetIn: data.expires - now };
    }

    await cache.put(key, JSON.stringify({ count: data.count + 1, expires: data.expires }), {
      expirationTtl: 60,
    });
    return { allowed: true, remaining: maxRequests - data.count - 1, resetIn: data.expires - now };
  } catch {
    // If KV fails, allow the request
    return { allowed: true, remaining: maxRequests, resetIn: windowMs };
  }
}

// Health check endpoint
async function handleHealth(): Promise<Response> {
  return new Response(JSON.stringify({ 
    ok: true, 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    runtime: 'cloudflare-workers'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Transcript endpoint
async function handleTranscript(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const method = request.method;

    let body: any = {};
    if (method === 'POST') {
      const text = await request.text();
      try {
        body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const rawInput = body?.url || body?.rawText || url.searchParams.get('url') || url.searchParams.get('videoId') || '';
    const customTitle = body?.title || url.searchParams.get('title') || '';

    if (!rawInput) {
      return new Response(JSON.stringify({ 
        error: 'Please provide a YouTube video URL, video ID, subtitle URL, or transcript text.' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const detected = detectMediaSourceType(rawInput);

    // Handle YouTube videos
    if (detected.type === 'youtube' || detected.type === 'youtube_short') {
      const videoId = detected.id || extractVideoId(rawInput);
      if (!videoId) {
        return new Response(JSON.stringify({ 
          error: 'Could not extract video ID from the provided URL.' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check cache first
      const cacheKey = `transcript:${videoId}`;
      const cached = await env.CACHE.get(cacheKey, 'json');
      if (cached) {
        return new Response(JSON.stringify({ ok: true, ...cached, cached: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Fetch from YouTube Data API
      const apiKey = env.GOOGLE_API_KEY || env.YOUTUBE_API_KEY;
      if (apiKey) {
        try {
          const ytUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${apiKey}`;
          const ytRes = await fetch(ytUrl, { 
            signal: AbortSignal.timeout(5000) 
          });
          
          if (ytRes.ok) {
            const ytData = await ytRes.json() as any;
            const item = ytData.items?.[0];
            
            if (item) {
              const metadata = {
                videoId,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                title: item.snippet?.title || `YouTube Video (${videoId})`,
                authorName: item.snippet?.channelTitle || 'YouTube Creator',
                thumbnailUrl: item.snippet?.thumbnails?.maxres?.url || 
                              item.snippet?.thumbnails?.high?.url ||
                              `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                description: item.snippet?.description || '',
                publishedAt: item.snippet?.publishedAt || '',
                viewCount: item.statistics?.viewCount ? parseInt(item.statistics.viewCount) : undefined,
              };

              // Try to fetch transcript
              // Note: In production, you'd integrate with youtube-transcript or similar
              // For now, return metadata only
              
              return new Response(JSON.stringify({
                ok: false,
                error: 'Transcript extraction requires server-side processing. This is a demo endpoint.',
                metadata,
                requiresManualOrKey: true,
              }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
        } catch (err) {
          console.error('YouTube API error:', err);
        }
      }

      // Fallback when no API key
      return new Response(JSON.stringify({
        ok: false,
        error: 'YouTube API key required. Set YOUTUBE_API_KEY or GOOGLE_API_KEY environment variable.',
        metadata: {
          videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title: `YouTube Video (${videoId})`,
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle direct subtitle URLs
    if (detected.type === 'direct_subtitle') {
      try {
        const subRes = await fetch(rawInput, { 
          signal: AbortSignal.timeout(8000) 
        });
        const text = await subRes.text();
        const segments = parseSubtitlePayload(text, true);
        
        if (segments && segments.length > 0) {
          const fullText = segments.map(s => s.text).join(' ');
          const result = {
            metadata: {
              videoId: '',
              url: rawInput,
              title: customTitle || 'Subtitle Document',
              sourceType: 'direct_subtitle',
              totalSegments: segments.length,
              totalWords: fullText.split(/\s+/).filter(Boolean).length,
            },
            segments,
            fullText,
          };

          return new Response(JSON.stringify({ ok: true, ...result }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (err: any) {
        return new Response(JSON.stringify({ 
          error: `Failed to fetch subtitle: ${err.message}` 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Handle direct text input
    if (detected.type === 'direct_text' && rawInput.length > 25) {
      const segments = parseSubtitlePayload(rawInput, true);
      if (segments && segments.length > 0) {
        const fullText = segments.map(s => s.text).join(' ');
        const result = {
          metadata: {
            videoId: '',
            url: '',
            title: customTitle || 'Pasted Transcript',
            sourceType: 'direct_text',
            totalSegments: segments.length,
            totalWords: fullText.split(/\s+/).filter(Boolean).length,
          },
          segments,
          fullText,
        };

        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ 
      error: 'Unrecognized media URL or transcript format.' 
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Transcript error:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Failed to retrieve transcript.' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Summarize endpoint (placeholder - integrate with AI providers)
async function handleSummarize(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json() as any;
    
    if (!env.GEMINI_API_KEY && !env.OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ 
        error: 'No AI provider API key configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY.' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Placeholder - integrate with actual AI provider
    return new Response(JSON.stringify({
      ok: true,
      message: 'AI integration endpoint ready. Configure API keys and integrate with AI providers.',
      providers: {
        gemini: !!env.GEMINI_API_KEY,
        openrouter: !!env.OPENROUTER_API_KEY,
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// D1 Database operations for user lists
async function handleLists(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  // GET /api/lists - Fetch user lists
  if (method === 'GET') {
    try {
      const userId = url.searchParams.get('userId') || 'local_user';
      
      const result = await env.DB.prepare(
        'SELECT * FROM saved_lists WHERE owner_id = ? ORDER BY updated_at DESC'
      ).bind(userId).all();

      return new Response(JSON.stringify({ 
        ok: true, 
        lists: result.results 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ 
        error: 'Failed to fetch lists',
        details: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // POST /api/lists - Create new list
  if (method === 'POST') {
    try {
      const body = await request.json() as any;
      const listId = `list_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      
      await env.DB.prepare(`
        INSERT INTO saved_lists (id, owner_id, name, description, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(
        listId,
        body.ownerId || 'local_user',
        body.name || 'New List',
        body.description || '',
        body.category || 'general'
      ).run();

      return new Response(JSON.stringify({ 
        ok: true, 
        id: listId,
        message: 'List created successfully'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ 
        error: 'Failed to create list',
        details: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Main worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const origin = request.headers.get('origin') || '';
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(origin, env)
      });
    }

    // Health check
    if (pathname === '/api/health') {
      return handleHealth();
    }

    // Rate limiting for API routes
    if (pathname.startsWith('/api/')) {
      const route = ['/summarize', '/chat', '/tts', '/transcribe'].includes(pathname) 
        ? 'llm' 
        : 'general';
      const rateCheck = await checkRateLimit(ip, env.CACHE, route);
      
      if (!rateCheck.allowed) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'Rate limit exceeded. Please wait a moment before trying again.',
          retryAfter: Math.ceil(rateCheck.resetIn / 1000)
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000)),
            ...getCorsHeaders(origin, env)
          }
        });
      }
    }

    // API routes
    const corsHeaders = getCorsHeaders(origin, env);

    // Transcript endpoints
    if (pathname === '/api/transcript') {
      const response = await handleTranscript(request, env);
      // Add CORS headers to response
      const newResponse = new Response(response.body, response);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newResponse.headers.set(key, value);
      });
      return newResponse;
    }

    // Summarize endpoint
    if (pathname === '/api/summarize') {
      const response = await handleSummarize(request, env);
      const newResponse = new Response(response.body, response);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newResponse.headers.set(key, value);
      });
      return newResponse;
    }

    // Lists endpoint (D1 database)
    if (pathname === '/api/lists') {
      const response = await handleLists(request, env);
      const newResponse = new Response(response.body, response);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newResponse.headers.set(key, value);
      });
      return newResponse;
    }

    // Static file serving (handled by Pages)
    // This worker primarily handles API routes
    // Static assets are served by Cloudflare Pages

    // 404 for unmatched API routes
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ 
        error: 'API endpoint not found',
        path: pathname
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // For non-API routes, serve the React app (handled by Pages)
    // Return a placeholder for now
    return new Response('OpenTranscript AI - Cloudflare Workers', {
      headers: { 'Content-Type': 'text/plain' }
    });
  },
};
