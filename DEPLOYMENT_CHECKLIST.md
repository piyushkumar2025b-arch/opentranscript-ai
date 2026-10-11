# Cloudflare Deployment Checklist

Complete this checklist to deploy your OpenTranscript AI app to Cloudflare.

## Pre-Deployment Requirements

- [ ] Cloudflare account created (https://dash.cloudflare.com/sign-up)
- [ ] Wrangler CLI installed (`npm install -g wrangler`)
- [ ] Node.js v18+ installed
- [ ] Git repository initialized

## Step 1: Install Dependencies

```powershell
npm install
```

## Step 2: Authenticate with Cloudflare

```powershell
npx wrangler login
```

This will open your browser to authenticate with Cloudflare. Click "Allow" to authorize Wrangler.

## Step 3: Create Cloudflare Resources

### 3.1 Create D1 Database

```powershell
npx wrangler d1 create opentranscript-db
```

**IMPORTANT**: Copy the `database_id` from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "opentranscript-db"
database_id = "YOUR_DATABASE_ID_HERE"  # <-- Replace this
```

### 3.2 Initialize Database Schema

```powershell
npx wrangler d1 execute opentranscript-db --file=./cloudflare.d1.schema.sql
```

### 3.3 Create KV Namespace

```powershell
npx wrangler kv:namespace create CACHE
```

**IMPORTANT**: Copy the `id` from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_KV_NAMESPACE_ID_HERE"  # <-- Replace this
```

### 3.4 Create Pages Project

```powershell
npx wrangler pages project create opentranscript-ai
```

When prompted:
- **Production branch**: `master` (or press Enter for default)
- **Build output directory**: `dist`

## Step 4: Set Environment Variables (Secrets)

Set API keys as encrypted secrets. Run this for each key you need:

```powershell
# Required for basic functionality
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GOOGLE_API_KEY

# Optional AI providers
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GROQ_API_KEY

# Web search
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put BRAVE_API_KEY

# Other services
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ELEVENLABS_API_KEY
```

When prompted, paste your API key value.

## Step 5: Build the Application

```powershell
npm run build
```

This creates the `dist` folder with your optimized frontend.

## Step 6: Deploy to Cloudflare Pages

```powershell
npx wrangler pages deploy dist
```

Or use the npm script:

```powershell
npm run deploy
```

## Step 7: Verify Deployment

1. Visit your app at: `https://opentranscript-ai.pages.dev`
2. Test the health endpoint: `https://opentranscript-ai.pages.dev/api/health`
3. Check logs:
   ```powershell
   npx wrangler pages deployment tail
   ```

## Step 8: Set Custom Domain (Optional)

1. Go to: https://dash.cloudflare.com → Workers & Pages → opentranscript-ai
2. Click "Custom domains"
3. Click "Set up a custom domain"
4. Enter your domain (must use Cloudflare DNS)

5. Update environment variable:
   ```powershell
   npx wrangler secret put APP_URL
   # Enter: https://yourdomain.com
   ```

## Troubleshooting

### Build Errors

```powershell
# Check for TypeScript errors
npm run lint

# Clean and rebuild
Remove-Item -Recurse -Force node_modules
npm install
npm run build
```

### Deployment Errors

```powershell
# Check authentication
npx wrangler whoami

# Verify wrangler.toml configuration
Get-Content wrangler.toml

# View deployment logs
npx wrangler pages deployment list
```

### Database Errors

```powershell
# Check database status
npx wrangler d1 info opentranscript-db

# Query database directly
npx wrangler d1 execute opentranscript-db --command "SELECT name FROM sqlite_master WHERE type='table'"
```

### Runtime Errors

```powershell
# View real-time logs
npx wrangler pages deployment tail

# Check environment variables
npx wrangler secret list
```

## Post-Deployment

### Monitor Your App

- **Dashboard**: https://dash.cloudflare.com → Workers & Pages → opentranscript-ai
- **Analytics**: View request counts, error rates, CPU usage
- **Logs**: Real-time log streaming

### Update Deployment

After making code changes:

```powershell
git add .
git commit -m "Your commit message"
npm run build
npm run deploy
```

### Rollback

If a deployment has issues:

```powershell
# List recent deployments
npx wrangler pages deployment list

# Rollback to a previous deployment
npx wrangler pages deployment rollback --deployment-id=<DEPLOYMENT_ID>
```

## Quick Reference Commands

```powershell
# Install dependencies
npm install

# Authenticate
npx wrangler login

# Create D1 database
npx wrangler d1 create opentranscript-db

# Initialize schema
npx wrangler d1 execute opentranscript-db --file=./cloudflare.d1.schema.sql

# Create KV namespace
npx wrangler kv:namespace create CACHE

# Create Pages project
npx wrangler pages project create opentranscript-ai

# Set secrets
npx wrangler secret put GEMINI_API_KEY

# Build
npm run build

# Deploy
npm run deploy

# View logs
npx wrangler pages deployment tail
```

## Support

- **Cloudflare Docs**: https://developers.cloudflare.com/workers/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/
- **Community**: https://community.cloudflare.com/
