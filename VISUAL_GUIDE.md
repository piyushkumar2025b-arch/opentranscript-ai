# Visual Deployment Guide

## Complete Deployment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT WORKFLOW                           │
└─────────────────────────────────────────────────────────────────┘

START
  │
  ▼
┌─────────────────────────────┐
│ 1. Install Dependencies     │
│    npm install              │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 2. Authenticate             │
│    wrangler login           │
│    (Opens browser)          │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Create Cloudflare Resources                           │
│                                                          │
│  ┌────────────────┐    ┌────────────────┐              │
│  │ D1 Database    │    │ KV Namespace   │              │
│  │                │    │                │              │
│  │ wrangler d1    │    │ wrangler kv    │              │
│  │ create ...     │    │ namespace ...  │              │
│  │                │    │                │              │
│  │ Returns: ID    │    │ Returns: ID    │              │
│  └────────┬───────┘    └────────┬───────┘              │
│           │                     │                       │
│           └──────────┬──────────┘                       │
│                      │                                  │
│                      ▼                                  │
│         ┌────────────────────────┐                     │
│         │ Update wrangler.toml   │                     │
│         │ with both IDs          │                     │
│         └────────────────────────┘                     │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────┐
│ 4. Initialize Database      │
│    wrangler d1 execute      │
│    --file=schema.sql        │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 5. Set API Keys (Secrets)   │
│    wrangler secret put      │
│    GEMINI_API_KEY           │
│    GOOGLE_API_KEY           │
│    etc.                     │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 6. Build Application        │
│    npm run build            │
│    (Creates dist/ folder)   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 7. Deploy to Cloudflare     │
│    npm run deploy           │
│    or                       │
│    wrangler pages deploy    │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ 8. Verify Deployment        │
│    Visit your app URL:      │
│    https://opentranscript-  │
│    ai.pages.dev             │
│                             │
│    Test API:                │
│    /api/health              │
└─────────────┬───────────────┘
              │
              ▼
           SUCCESS!
              │
              ▼
        ┌──────────┐
        │ LIVE! 🚀 │
        └──────────┘
```

## Cloudflare Resources Created

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Cloudflare Account                   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Workers & Pages                                      │   │
│  │                                                        │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  opentranscript-ai (Pages Project)             │  │   │
│  │  │                                                  │  │   │
│  │  │  URL: https://opentranscript-ai.pages.dev      │  │   │
│  │  │                                                  │  │   │
│  │  │  ┌────────────────┐  ┌─────────────────────┐  │  │   │
│  │  │  │ Static Assets  │  │ Worker (API Routes) │  │  │   │
│  │  │  │ (React App)    │  │                     │  │  │   │
│  │  │  │                │  │ /api/transcript     │  │  │   │
│  │  │  │ index.html     │  │ /api/summarize      │  │  │   │
│  │  │  │ assets/*.js    │  │ /api/lists          │  │  │   │
│  │  │  │ assets/*.css   │  │ /api/health         │  │  │   │
│  │  │  └────────────────┘  └──────────┬──────────┘  │  │   │
│  │  │                                 │              │  │   │
│  │  └─────────────────────────────────┼──────────────┘  │   │
│  │                                    │                  │   │
│  │  ┌─────────────────────────────────▼──────────────┐  │   │
│  │  │  D1 Database                                    │  │   │
│  │  │  Name: opentranscript-db                       │  │   │
│  │  │                                                  │  │   │
│  │  │  Tables:                                        │  │   │
│  │  │  • users                                        │  │   │
│  │  │  • saved_lists                                  │  │   │
│  │  │  • list_items                                   │  │   │
│  │  │  • saved_summaries                              │  │   │
│  │  │  • activity_history                             │  │   │
│  │  │  • custom_resources                             │  │   │
│  │  │  • rate_limits                                  │  │   │
│  │  │  • user_sessions                                │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                        │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │  KV Namespace                                    │  │   │
│  │  │  Name: CACHE                                    │  │   │
│  │  │                                                  │  │   │
│  │  │  Used for:                                      │  │   │
│  │  │  • Transcript caching                           │  │   │
│  │  │  • Rate limiting counters                       │  │   │
│  │  │  • Temporary data                               │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                        │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │  Secrets (Encrypted)                             │  │   │
│  │  │                                                  │  │   │
│  │  │  • GEMINI_API_KEY                               │  │   │
│  │  │  • GOOGLE_API_KEY                               │  │   │
│  │  │  • OPENROUTER_API_KEY                           │  │   │
│  │  │  • YOUTUBE_API_KEY                              │  │   │
│  │  │  • ... (other API keys)                         │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                        │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Request Flow

```
┌─────────┐
│  User   │
└────┬────┘
     │
     │ 1. Request to https://opentranscript-ai.pages.dev
     │
     ▼
┌──────────────────────────────────────────────┐
│         Cloudflare Edge Network              │
│                                              │
│  ┌────────────────────────────────────┐     │
│  │  Nearest Edge Location             │     │
│  │  (Low latency, <50ms globally)     │     │
│  └────────────┬───────────────────────┘     │
│               │                              │
│               ▼                              │
│  ┌────────────────────────────────────┐     │
│  │  Route Request                     │     │
│  └────────────┬───────────────────────┘     │
│               │                              │
│        ┌──────┴──────┐                      │
│        │             │                      │
│   Static File    API Request                 │
│        │             │                      │
│        ▼             ▼                      │
│  ┌──────────┐  ┌─────────────────┐         │
│  │  Pages   │  │  Workers        │         │
│  │  (CDN)   │  │  (V8 Isolate)   │         │
│  │          │  │                 │         │
│  │ index.js │  │ Handle API:     │         │
│  │ styles   │  │ • Rate limit    │         │
│  │ assets   │  │ • Validate      │         │
│  │          │  │ • Query DB      │         │
│  └──────────┘  │ • Call APIs     │         │
│                └────────┬────────┘         │
│                         │                   │
│            ┌────────────┼────────────┐     │
│            │            │            │     │
│            ▼            ▼            ▼     │
│        ┌───────┐   ┌──────┐   ┌─────────┐ │
│        │  D1   │   │  KV  │   │ External│ │
│        │  DB   │   │Cache │   │   APIs  │ │
│        └───────┘   └──────┘   └─────────┘ │
│                                             │
└─────────────────────────────────────────────┘
```

## Data Flow Example

### Transcript Extraction Flow

```
User submits YouTube URL
         │
         ▼
┌────────────────────────┐
│ Worker receives POST   │
│ /api/transcript        │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Check KV Cache         │
│ Key: transcript:ID     │
└───────────┬────────────┘
            │
       ┌────┴────┐
       │         │
    Cached?   No Cache
       │         │
       │         ▼
       │    ┌──────────────────┐
       │    │ Call YouTube API │
       │    │ Extract metadata │
       │    └────────┬─────────┘
       │             │
       │             ▼
       │    ┌──────────────────┐
       │    │ Parse transcript │
       │    │ Format segments  │
       │    └────────┬─────────┘
       │             │
       │             ▼
       │    ┌──────────────────┐
       │    │ Store in KV      │
       │    │ (Cache 1 hour)   │
       │    └────────┬─────────┘
       │             │
       └─────┬───────┘
             │
             ▼
┌────────────────────────┐
│ Return JSON response   │
│ {metadata, segments}   │
└────────────────────────┘
```

## Cost Breakdown

```
┌─────────────────────────────────────────────────┐
│           Cloudflare Pricing (Monthly)          │
├─────────────────────────────────────────────────┤
│                                                 │
│  FREE TIER                                      │
│  ├─ 100,000 requests/day                        │
│  ├─ 10ms CPU time per request                   │
│  ├─ 1 GB D1 database storage                    │
│  ├─ 1 GB KV namespace storage                   │
│  ├─ Unlimited bandwidth                         │
│  └─ Cost: $0/month                              │
│                                                 │
│  PAID PLAN (Workers Paid)                       │
│  ├─ 10 million requests/month included          │
│  ├─ 30ms CPU time per request                   │
│  ├─ 5 GB D1 database storage                    │
│  ├─ 10 GB KV namespace storage                  │
│  ├─ Additional requests: $0.50/million          │
│  └─ Cost: $5/month                              │
│                                                 │
│  ESTIMATED FOR YOUR APP                         │
│  ├─ If <100K requests/day: FREE                 │
│  ├─ If 100K-1M requests/day: ~$5/month          │
│  └─ If 1M-10M requests/day: ~$5-10/month        │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Next Steps After Deployment

```
1. Test All Features
   ├─▶ Health check: /api/health
   ├─▶ Transcript extraction
   ├─▶ AI summarization
   └─▶ List management

2. Monitor Performance
   ├─▶ Cloudflare Dashboard
   ├─▶ View logs: wrangler pages deployment tail
   └─▶ Check analytics

3. Set Up Custom Domain (Optional)
   ├─▶ Add domain in Cloudflare
   ├─▶ Update DNS records
   └─▶ Set APP_URL secret

4. Scale as Needed
   ├─▶ Monitor resource usage
   ├─▶ Upgrade to paid plan if needed
   └─▶ Optimize worker code

5. Maintain & Update
   ├─▶ git pull (future updates)
   ├─▶ npm run build
   └─▶ npm run deploy
```

---

**You're ready to deploy! Follow the steps in `DEPLOYMENT_CHECKLIST.md` or run `.\scripts\setup-cloudflare.ps1` (Windows) to automate the process.**
