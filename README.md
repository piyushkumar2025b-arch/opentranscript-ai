<div align="center">

# 🎬 OpenTranscript AI

### Turn any video, podcast, or lecture into structured knowledge — instantly.

**YouTube · Vimeo · TED Talks · Podcasts · Direct Audio · Web Articles**

[![Deploy to Cloudflare Pages](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white&style=flat-square)](https://opentranscript-ai.pages.dev)
[![Built with React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white&style=flat-square)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white&style=flat-square)](https://tailwindcss.com)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare%20D1-F38020?logo=cloudflare&logoColor=white&style=flat-square)](https://developers.cloudflare.com/d1)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

<br/>

<img src="https://i.ytimg.com/vi/UF8uR6Z6KLc/hqdefault.jpg" width="640" alt="OpenTranscript AI Preview" style="border-radius:12px"/>

<br/>

**[🚀 Live Demo](https://opentranscript-ai.pages.dev)** · **[📖 Docs](#-getting-started)** · **[🐛 Report a Bug](../../issues)** · **[✨ Request a Feature](../../issues)**

</div>

---

## What is this?

I built OpenTranscript AI because I was tired of watching hour-long lectures just to extract 10 minutes of actual insight. You paste a YouTube link — or a Vimeo, TED Talk, podcast RSS feed, or even a raw audio file — and within seconds you get a full transcript, a structured breakdown written in plain English, an interactive Q&A you can actually have a conversation with, and a 12-source research panel that surfaces the books, papers, tools, and people mentioned.

It works across **every major video and audio platform**, supports **5 AI providers with 18 models** (including completely free tiers), and stores everything in a **Cloudflare D1 edge database** that lives close to your users anywhere on Earth.

No server to babysit. No monthly infrastructure bill to sweat. Just deploy and it works.

---

## ✨ Features at a Glance

### 📝 Transcript Extraction

| Source | How it works |
|---|---|
| **YouTube** | Auto-captions via timedtext API, YouTube Data API v3, yt-dlp fallback |
| **Vimeo** | oEmbed metadata + subtitle track detection |
| **TED Talks** | Scrapes official ted.com transcript endpoints |
| **Loom** | Transcript API from share links |
| **Twitch** | VOD transcript extraction |
| **Podcast RSS** | Parses episode audio for transcription |
| **Direct Audio/Video** | `.mp3`, `.mp4`, `.wav`, `.m4a`, `.webm` — upload or link |
| **Direct Subtitle File** | `.vtt`, `.srt`, `.ttml`, `.xml` — paste URL or file |
| **Web Articles** | Extracts readable text from any public URL |
| **Pasted Text** | Paste SRT/VTT/plain text directly into the box |

### 🤖 AI Providers & Models

Five providers, one interface. Switch with a single click.

| Provider | Models | Free Tier |
|---|---|---|
| **Google Gemini** | Gemini 2.0 Flash Lite, 2.0 Flash, 1.5 Pro | ✅ Yes |
| **OpenRouter** | Llama 3.3 70B, DeepSeek R1, DeepSeek V3, Gemini 2.0 Flash Exp, Qwen 2.5 72B, Mistral Small 3.1, Gemma 3 27B + more | ✅ All free |
| **Groq** | Llama 3.3 70B Versatile | ✅ Free tier |
| **OpenAI** | GPT-4o, GPT-4o-mini | 💳 Paid |
| **Anthropic** | Claude 3.5 Sonnet | 💳 Paid |

### 📚 Summary Modes

- **Complete Story & Full Breakdown** — the whole video in natural everyday English
- **Moment-by-Moment Timeline** — every story, example, and topic with `[MM:SS]` timestamps
- **Ideas & Examples Explained Simply** — core concepts broken down with real-world analogies
- **Practical Steps & How-To Guide** — actionable checklists, habits, mistakes to avoid
- **Easy Study Notes & Q&A** — definitions, review cards, common questions answered

### 🧠 Knowledge Features

- **Interactive AI Q&A** — ask anything about the video, backed by the full transcript context via RAG
- **Deep Dive Expansion** — take any section of a summary and expand it 5x deeper
- **Key Ideas Extraction** — the 10 most important takeaways, actionable lessons, and mental models
- **Tech Dictionary Lookup** — explains every technical term in plain English with real-world examples
- **Crucial Knowledge Panel** — acronyms, core concepts, entities, and rules of thumb extracted from the video

### 🔬 12-Source Research Panel

Each video generates a live knowledge graph across:

Wikipedia · Google Scholar · arXiv · PubMed · Semantic Scholar · GitHub · npm Registry · PyPI · Stack Overflow · Unsplash · Pexels · Google Books

### 🎨 15 Hand-Crafted Themes

Seven daylight themes and eight dark themes, all designed to be actually pleasant to read in:

`Warm Sepia` · `Archival Ivory` · `Solarized Parchment` · `E-Ink Matte Pearl` · `Botanical Sage` · `Warm Limestone Clay` · `Nordic Snow Slate` · `Graphite Studio` · `Gruvbox Warm Dark` · `Nordic Polar Dark` · `Everforest Dark` · `Oxford Maritime Slate` · `Obsidian Warm Quartz` · `Tokyo Night Studio` · `Dimmed Carbon Matte`

### 💾 Saved Lists & Cloud Sync

- Create named lists and save videos, summaries, books, and notes
- Activity history grouped by date
- Synced to Cloudflare D1 when logged in, localStorage fallback when not

### 🔊 Audio Narration

- Neural TTS via ElevenLabs or Edge TTS (no API key needed)
- 60fps word-level highlight synchronisation while reading along

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   Cloudflare Edge Network                    │
│                                                              │
│  ┌─────────────────────┐    ┌───────────────────────────┐  │
│  │  Cloudflare Pages   │    │    Cloudflare Workers     │  │
│  │  (React Frontend)   │───▶│    (API — src/worker.ts)  │  │
│  └─────────────────────┘    └────────────┬──────────────┘  │
│                                           │                  │
│                           ┌──────────────▼──────────────┐  │
│                           │      Cloudflare D1          │  │
│                           │  (SQLite at the Edge)       │  │
│                           │  lists · summaries · history│  │
│                           └──────────────┬──────────────┘  │
│                                           │                  │
│                           ┌──────────────▼──────────────┐  │
│                           │      Cloudflare KV          │  │
│                           │  transcript cache · rate    │  │
│                           │  limiting counters          │  │
│                           └─────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Why Cloudflare?**
- Your API runs from 300+ edge locations — typically under 50ms anywhere on Earth
- D1 is globally replicated SQLite with zero cold-start latency
- KV handles rate limiting and transcript caching at the edge
- Pages serves your frontend from CDN with unlimited bandwidth on the free tier
- The whole stack costs **$0/month** under 100,000 requests/day

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18+
- npm v9+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- At minimum one AI API key (Gemini free tier is enough to start)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/opentranscript-ai.git
cd opentranscript-ai
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and add your keys. The only required key to get AI summaries working is `GEMINI_API_KEY`. Everything else is optional.

```env
# Minimum required
GEMINI_API_KEY="your-gemini-api-key"
GOOGLE_API_KEY="your-google-api-key"   # for YouTube Data API

# Optional AI providers
OPENROUTER_API_KEY="your-openrouter-key"
OPENAI_API_KEY="your-openai-key"
ANTHROPIC_API_KEY="your-anthropic-key"
GROQ_API_KEY="your-groq-key"
```

### 3. Run locally (Node.js / Express)

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Or run locally with the Cloudflare Workers runtime

```bash
npm run cf:dev
```

Open [http://localhost:8787](http://localhost:8787). This mimics the production runtime exactly.

---

## ☁️ Deploy to Cloudflare

### Option A — Automated (recommended)

```powershell
# Windows
.\scripts\setup-cloudflare.ps1

# macOS / Linux
chmod +x scripts/setup-cloudflare.sh
./scripts/setup-cloudflare.sh
```

The script walks you through every step interactively.

### Option B — Manual step-by-step

#### Step 1: Authenticate

```bash
npx wrangler login
```

#### Step 2: Create your D1 database

```bash
npx wrangler d1 create opentranscript-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "opentranscript-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

#### Step 3: Apply the database schema

```bash
npx wrangler d1 execute opentranscript-db --file=./cloudflare.d1.schema.sql --remote
```

#### Step 4: Create a KV namespace for caching

```bash
npx wrangler kv:namespace create CACHE
```

Copy the `id` and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_KV_NAMESPACE_ID"
```

#### Step 5: Set your API keys as encrypted secrets

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GOOGLE_API_KEY
# add others as needed
```

#### Step 6: Build and deploy

```bash
npm run build
npx wrangler pages deploy dist
```

Your app is live at `https://opentranscript-ai.pages.dev` 🎉

---

## 🔄 Auto-Deploy from GitHub

Set up continuous deployment so every push to `main` deploys automatically.

### Step 1: Push to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/opentranscript-ai.git
git push -u origin master
```

### Step 2: Connect to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. Click your **opentranscript-ai** project → **Settings** → **Builds & deployments**
3. Click **Connect to Git**
4. Authorize Cloudflare on GitHub and select your repository
5. Set the build configuration:

| Setting | Value |
|---|---|
| Production branch | `master` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |

6. Click **Save and deploy**

### Step 3: Add secrets in the Cloudflare Dashboard

Go to your project → **Settings** → **Environment variables** → **Add variable**

Set each API key as a **Secret** (encrypted). Add at minimum:

- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`

### That's it

From now on, every `git push` to `master` triggers a new deployment automatically. Preview deployments are created for pull requests. You can roll back to any previous deployment with one click.

---

## 🔑 Environment Variables Reference

| Variable | What it does | Required |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini AI for summaries and Q&A | Recommended |
| `GOOGLE_API_KEY` | YouTube Data API v3, Google Books, Custom Search | Recommended |
| `YOUTUBE_API_KEY` | Alternative to `GOOGLE_API_KEY` for YouTube only | Optional |
| `OPENROUTER_API_KEY` | Access to 10+ free models via OpenRouter | Optional |
| `OPENAI_API_KEY` | GPT-4o / GPT-4o-mini summaries | Optional |
| `ANTHROPIC_API_KEY` | Claude 3.5 Sonnet | Optional |
| `GROQ_API_KEY` | Ultra-fast Llama 3.3 70B via Groq | Optional |
| `GOOGLE_CSE_ID` | Google Custom Search Engine ID | Optional |
| `TAVILY_API_KEY` | Tavily AI web search | Optional |
| `BRAVE_API_KEY` | Brave Search API | Optional |
| `EXA_API_KEY` | Exa neural search | Optional |
| `NEWSAPI_KEY` | NewsAPI global news | Optional |
| `GNEWS_API_KEY` | GNews real-time news | Optional |
| `UNSPLASH_ACCESS_KEY` | Unsplash photos for research visuals | Optional |
| `PEXELS_API_KEY` | Pexels stock photos | Optional |
| `ELEVENLABS_API_KEY` | ElevenLabs neural TTS narration | Optional |
| `DEEPL_API_KEY` | DeepL translation | Optional |
| `SEMANTIC_SCHOLAR_API_KEY` | Academic paper search | Optional |
| `GITHUB_TOKEN` | GitHub repository search (higher rate limit) | Optional |
| `APP_URL` | Your public app URL for CORS | Optional |
| `ALLOWED_ORIGINS` | Extra allowed CORS origins (comma-separated) | Optional |

---

## 📁 Project Structure

```
opentranscript-ai/
│
├── src/
│   ├── components/           # All React UI components
│   │   ├── ActivityHistoryPanel.tsx
│   │   ├── AskVideoAI.tsx       # Interactive Q&A panel
│   │   ├── AudioNarrationBar.tsx
│   │   ├── CrucialKnowledgePanel.tsx
│   │   ├── Header.tsx
│   │   ├── ResearchVisualsPanel.tsx  # 12-source knowledge graph
│   │   ├── SavedListsPanel.tsx
│   │   ├── SummaryViewer.tsx
│   │   ├── TechWordsSearcherPanel.tsx
│   │   ├── TranscriptViewer.tsx
│   │   ├── VideoPlayerPanel.tsx
│   │   └── ...
│   │
│   ├── server/               # Server-side logic (Node.js + Workers)
│   │   ├── authMiddleware.ts     # Firebase Auth token verification
│   │   ├── cacheHelper.ts        # SHA-256 hashing + LRU cache
│   │   ├── mediaExtractor.ts     # Multi-platform media extraction
│   │   ├── ragEngine.ts          # RAG retrieval engine for Q&A
│   │   ├── rateLimiter.ts        # In-memory rate limiting
│   │   ├── safeFetch.ts          # SSRF-protected fetch wrapper
│   │   ├── transcriptHelper.ts   # Transcript pipeline
│   │   └── ytDlpService.ts       # yt-dlp integration
│   │
│   ├── services/             # Frontend service layer
│   │   ├── cloudflareDbService.ts  # Cloudflare D1 operations
│   │   ├── knowledgeExtractionService.ts
│   │   ├── listsService.ts         # Saved lists (Firebase + local)
│   │   ├── speechService.ts        # TTS service
│   │   └── techDictionaryService.ts
│   │
│   ├── utils/
│   │   └── subtitleParser.ts    # VTT/SRT/TTML/JSON parser
│   │
│   ├── worker.ts             # Cloudflare Workers entry point
│   ├── App.tsx               # Root React component
│   ├── types.ts              # Shared TypeScript types
│   ├── constants.ts          # App constants, themes, models
│   └── firebase.ts           # Firebase client config
│
├── scripts/
│   ├── setup-cloudflare.ps1  # Windows automated setup
│   └── setup-cloudflare.sh   # macOS/Linux automated setup
│
├── wrangler.toml             # Cloudflare Workers configuration
├── cloudflare.d1.schema.sql  # D1 database schema
├── vite.config.ts            # Vite build configuration
├── tsconfig.json             # TypeScript configuration
├── server.ts                 # Express dev server entry point
└── package.json
```

---

## 🧪 Running Tests

```bash
npm test
```

Tests cover:
- Subtitle parser (VTT, SRT, TTML, timestamped lines)
- YouTube video ID extraction
- In-memory rate limiter logic
- Theme configuration consistency
- Sample report integrity

---

## 🔒 Security

- **API keys** are stored as encrypted secrets in Cloudflare — never in source code
- **SSRF protection** on all outbound fetch calls via `safeFetch.ts`
- **Rate limiting** at the edge via Cloudflare KV (120 req/min general, 25 req/min for AI routes)
- **CORS** locked to your configured origins only
- **Content Security Policy** and security headers on every response
- **Input sanitisation** with strict length limits before every database write
- **SQL injection** impossible via D1's parameterised query binding

---

## 💸 Cost

Running entirely on Cloudflare's free tier:

| Resource | Free Allowance | Typical Usage |
|---|---|---|
| Pages requests | Unlimited | All static assets |
| Workers requests | 100,000/day | All API calls |
| D1 reads | 5 million/day | Database queries |
| D1 writes | 100,000/day | Saves and updates |
| KV reads | 100,000/day | Cache lookups |
| Bandwidth | Unlimited | — |
| **Monthly cost** | **$0** | |

If you exceed the free tier: Workers Paid is **$5/month** for 10 million requests.

---

## 🤝 Contributing

Contributions are welcome and genuinely appreciated. Here's how to get started:

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-feature-name`
3. Make your changes and add tests if applicable
4. Run `npm test` and `npm run lint` to verify
5. Push and open a Pull Request

Please keep PRs focused on a single concern. If you're planning something large, open an issue first to discuss the approach.

---

## 📜 License

MIT — do whatever you want, just don't hold me liable. See [LICENSE](LICENSE) for the legal version.

---

## 🙏 Acknowledgements

This project stands on the shoulders of some genuinely excellent open source work:

- [Vite](https://vitejs.dev) — the fastest frontend tooling I've used
- [React](https://react.dev) — still the best way to build complex UIs
- [Tailwind CSS](https://tailwindcss.com) — utility-first CSS done right
- [Lucide React](https://lucide.dev) — beautiful, consistent icons
- [react-markdown](https://github.com/remarkjs/react-markdown) — clean Markdown rendering
- [youtube-transcript](https://www.npmjs.com/package/youtube-transcript) — transcript extraction made easy
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) — subtitle parsing backbone
- [Cloudflare Workers](https://workers.cloudflare.com) — edge computing that actually works
- Every AI provider who made a free tier generous enough to build something real with

---

<div align="center">

Made with focus and too much coffee ☕

**[⭐ Star this repo](../../stargazers)** if it saved you some time

</div>
