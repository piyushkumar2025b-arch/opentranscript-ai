# Cloudflare Deployment Guide

This guide walks you through deploying OpenTranscript AI to Cloudflare Pages with Workers, D1 database, and KV namespace.

## Prerequisites

1. **Cloudflare Account**: Sign up at https://dash.cloudflare.com/sign-up
2. **Wrangler CLI**: Install globally or use npm scripts
   ```bash
   npm install -g wrangler
   ```
3. **Node.js**: v18 or later
4. **Git**: For version control

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Authenticate with Cloudflare

```bash
npx wrangler login
```

This will open your browser to authenticate with Cloudflare.

## Step 3: Create Cloudflare Resources

### 3.1 Create D1 Database

```bash
npm run d1:init
```

This will create a D1 database and output a database ID. **Copy this ID** and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "opentranscript-db"
database_id = "YOUR_DATABASE_ID_HERE"  # Replace with the ID from the command above
```

### 3.2 Initialize Database Schema

```bash
npm run d1:migrate
```

This applies the schema from `cloudflare.d1.schema.sql`.

### 3.3 Create KV Namespace

```bash
npm run kv:init
```

This will output a KV namespace ID. **Copy this ID** and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_KV_NAMESPACE_ID_HERE"  # Replace with the ID from the command above
```

### 3.4 Create Cloudflare Pages Project

```bash
npm run cf:init
```

## Step 4: Configure Environment Variables

### 4.1 Set Secrets via Wrangler

Set each API key as a secret (these are encrypted and not visible in the dashboard):

```bash
# AI Provider Keys
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GROQ_API_KEY

# YouTube & Search Keys
npx wrangler secret put GOOGLE_API_KEY
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler secret put GOOGLE_CSE_ID
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put BRAVE_API_KEY

# News & Media Keys
npx wrangler secret put NEWSAPI_KEY
npx wrangler secret put UNSPLASH_ACCESS_KEY

# Other Keys as needed
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ELEVENLABS_API_KEY
```

### 4.2 Or Set via Dashboard

1. Go to **Cloudflare Dashboard** → **Workers & Pages** → **opentranscript-ai**
2. Click **Settings** → **Variables and Secrets**
3. Click **Add variable** and choose **Secret** for sensitive keys
4. Add each key individually

### 4.3 Required Variables

At minimum, set these for basic functionality:

- `GEMINI_API_KEY` - For Gemini AI summaries
- `GOOGLE_API_KEY` - For YouTube Data API
- `YOUTUBE_API_KEY` - Alternative to GOOGLE_API_KEY

## Step 5: Build and Deploy

### 5.1 Build the Project

```bash
npm run build
```

This creates the `dist` folder with your static frontend.

### 5.2 Deploy to Cloudflare Pages

```bash
npm run deploy
```

Or for Workers only:

```bash
npm run deploy:worker
```

## Step 6: Verify Deployment

1. Visit your Pages URL: `https://opentranscript-ai.pages.dev`
2. Test the `/api/health` endpoint
3. Check logs in the Cloudflare Dashboard

## Step 7: Custom Domain (Optional)

### 7.1 Add Custom Domain

1. Go to **Cloudflare Dashboard** → **Workers & Pages** → **opentranscript-ai**
2. Click **Custom domains** → **Set up a custom domain**
3. Enter your domain (must be on Cloudflare DNS)

### 7.2 Update Environment Variables

Set `APP_URL` to your custom domain:

```bash
npx wrangler secret put APP_URL
# Enter: https://yourdomain.com
```

## Architecture Changes

### Firebase → Cloudflare D1 Migration

| Feature | Firebase | Cloudflare D1 |
|---------|----------|---------------|
| Authentication | Firebase Auth | Custom JWT / Cloudflare Access |
| Database | Firestore | D1 (SQLite) |
| Real-time | Firestore listeners | Polling / D1 queries |
| Storage | Firebase Storage | R2 (optional) |

### Express → Cloudflare Workers

| Feature | Express Server | Cloudflare Workers |
|---------|---------------|-------------------|
| Runtime | Node.js | V8 Isolates |
| Deployment | Traditional server | Edge network |
| Request handling | Express middleware | Workers fetch handler |
| Dependencies | Node modules | Workers-compatible packages |

### Key Files Modified/Created

1. **`src/worker.ts`** - Cloudflare Workers entry point (to be created)
2. **`wrangler.toml`** - Workers configuration
3. **`cloudflare.d1.schema.sql`** - Database schema
4. **`worker-extensions.d.ts`** - TypeScript types for Workers
5. **`package.json`** - Added deployment scripts

## Troubleshooting

### Build Errors

- Ensure all dependencies are installed: `npm install`
- Check TypeScript errors: `npm run lint`

### Deployment Errors

- Verify `wrangler.toml` has correct database IDs
- Check you're authenticated: `npx wrangler whoami`
- Review logs: `npx wrangler pages deployment tail`

### Runtime Errors

- Check Workers logs in dashboard
- Verify environment variables are set
- Test locally: `npm run cf:dev`

## Local Development with Cloudflare

```bash
# Run locally with Workers runtime
npm run cf:dev

# Or use traditional Node server
npm run dev
```

## Monitoring & Analytics

1. **Cloudflare Dashboard** → **Workers & Pages** → **opentranscript-ai**
2. View:
   - Request metrics
   - Error rates
   - CPU usage
   - Logs (real-time)

## Cost Estimate

Cloudflare Pages + Workers free tier includes:
- 100,000 requests/day
- 10ms CPU time per request
- 1 GB D1 storage
- 1 GB KV storage
- Unlimited bandwidth

For production use, consider Workers Paid plan ($5/month):
- 10 million requests/month included
- 30ms CPU time per request
- 5 GB D1 storage
- 10 GB KV storage

## Security Best Practices

1. **API Keys**: Always use `wrangler secret` for sensitive keys
2. **CORS**: Configure `ALLOWED_ORIGINS` for your domains
3. **Rate Limiting**: Built-in with KV namespace
4. **HTTPS**: Automatic with Cloudflare
5. **DDoS Protection**: Built-in with Cloudflare

## Support

- Cloudflare Docs: https://developers.cloudflare.com/workers/
- Wrangler CLI: https://developers.cloudflare.com/workers/wrangler/
- Community: https://community.cloudflare.com/
