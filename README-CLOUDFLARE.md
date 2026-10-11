# OpenTranscript AI - Cloudflare Deployment

This is a YouTube transcript and AI summarization app deployed to Cloudflare Pages with Workers, D1 database, and KV namespace.

## Quick Start

### Option 1: Automated Setup (Recommended)

Run the setup script to automatically create Cloudflare resources:

**Windows (PowerShell):**
```powershell
.\scripts\setup-cloudflare.ps1
```

**Linux/macOS:**
```bash
chmod +x scripts/setup-cloudflare.sh
./scripts/setup-cloudflare.sh
```

### Option 2: Manual Setup

Follow the step-by-step instructions in [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md).

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                Cloudflare Edge Network               │
│                                                       │
│  ┌──────────────┐         ┌──────────────────────┐ │
│  │   Cloudflare │         │   Cloudflare Workers  │ │
│  │     Pages    │────────▶│   (API Routes)        │ │
│  │  (Frontend)  │         │                       │ │
│  └──────────────┘         └──────────┬───────────┘ │
│                                      │               │
│                           ┌──────────▼───────────┐  │
│                           │   D1 Database        │  │
│                           │   (SQLite at Edge)   │  │
│                           └──────────┬───────────┘  │
│                                      │               │
│                           ┌──────────▼───────────┐  │
│                           │   KV Namespace       │  │
│                           │   (Caching & Rate    │  │
│                           │    Limiting)         │  │
│                           └──────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## File Structure

```
.
├── src/
│   ├── worker.ts                    # Cloudflare Worker entry point
│   ├── services/
│   │   └── cloudflareDbService.ts   # D1 database operations
│   └── server/                      # Server-side utilities (adapted for Workers)
├── wrangler.toml                    # Worker configuration
├── cloudflare.d1.schema.sql         # Database schema
├── worker-extensions.d.ts           # TypeScript types for Workers
├── .env.cloudflare.example          # Environment variables template
├── CLOUDFLARE_DEPLOYMENT.md         # Detailed deployment guide
└── scripts/
    ├── setup-cloudflare.ps1         # Windows setup script
    └── setup-cloudflare.sh          # Linux/macOS setup script
```

## What's Changed from Firebase/Express

### Firebase → D1 Database

| Feature | Firebase | Cloudflare D1 |
|---------|----------|---------------|
| Database | Firestore (NoSQL) | D1 (SQLite) |
| Real-time | onSnapshot listeners | Polling |
| Auth | Firebase Auth | Custom JWT (optional) |
| Storage | Firebase Storage | R2 (optional) |

### Express → Workers

| Feature | Express | Cloudflare Workers |
|---------|---------|-------------------|
| Runtime | Node.js | V8 Isolates |
| Deployment | Traditional server | Edge network |
| Request Handler | Express app | Exported fetch handler |
| Middleware | Express middleware | Custom functions |

### Key Files

1. **`src/worker.ts`** - Main worker entry point (replaces `server.ts`)
2. **`src/services/cloudflareDbService.ts`** - D1 database service (replaces Firebase/Firestore)
3. **`wrangler.toml`** - Worker configuration
4. **`cloudflare.d1.schema.sql`** - Database schema

## Environment Variables

Set these via Wrangler CLI or Cloudflare Dashboard:

### Required for Basic Functionality

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GOOGLE_API_KEY
```

### Optional AI Providers

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GROQ_API_KEY
```

### Web Search & Research

```bash
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put BRAVE_API_KEY
```

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run locally with Cloudflare Workers runtime
npm run cf:dev

# Or run with traditional Node server
npm run dev
```

### Build

```bash
npm run build
```

### Deploy

```bash
# Deploy to Cloudflare Pages
npm run deploy

# Deploy worker only
npm run deploy:worker
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/transcript` | GET/POST | Extract video transcript |
| `/api/summarize` | POST | AI summarization |
| `/api/lists` | GET/POST | User saved lists (D1) |
| `/api/lists/{id}` | GET/PUT/DELETE | List operations |

## Costs

### Cloudflare Free Tier

- 100,000 requests/day
- 10ms CPU time per request
- 1 GB D1 storage
- 1 GB KV storage
- Unlimited bandwidth

### Cloudflare Paid ($5/month)

- 10 million requests/month
- 30ms CPU time per request
- 5 GB D1 storage
- 10 GB KV storage

## Monitoring

View logs and metrics:

```bash
# Real-time logs
wrangler pages deployment tail

# Or visit dashboard:
# https://dash.cloudflare.com → Workers & Pages → opentranscript-ai
```

## Troubleshooting

### Build Errors

```bash
# Check TypeScript errors
npm run lint

# Reinstall dependencies
rm -rf node_modules
npm install
```

### Runtime Errors

1. Check logs: `wrangler pages deployment tail`
2. Verify environment variables are set
3. Check D1 database ID in `wrangler.toml`
4. Verify KV namespace ID in `wrangler.toml`

### Database Errors

```bash
# Check database status
wrangler d1 info opentranscript-db

# Query database directly
wrangler d1 execute opentranscript-db --command "SELECT * FROM saved_lists LIMIT 5"
```

## Support

- **Cloudflare Docs**: https://developers.cloudflare.com/workers/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/
- **Community**: https://community.cloudflare.com/

## License

MIT
