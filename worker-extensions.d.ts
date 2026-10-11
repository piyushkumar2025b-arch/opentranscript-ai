// Cloudflare Workers type extensions
import { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';

interface Env {
  // D1 Database
  DB: D1Database;
  
  // KV Namespace for caching
  CACHE: KVNamespace;
  
  // R2 Bucket for media storage (optional)
  MEDIA_BUCKET?: R2Bucket;
  
  // Environment
  ENVIRONMENT: string;
  
  // API Keys (set via wrangler secret)
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_CSE_ID?: string;
  YOUTUBE_API_KEY?: string;
  TAVILY_API_KEY?: string;
  SERPER_API_KEY?: string;
  BRAVE_API_KEY?: string;
  EXA_API_KEY?: string;
  NEWSAPI_KEY?: string;
  GNEWS_API_KEY?: string;
  GUARDIAN_API_KEY?: string;
  NYTIMES_API_KEY?: string;
  UNSPLASH_ACCESS_KEY?: string;
  PEXELS_API_KEY?: string;
  PIXABAY_API_KEY?: string;
  SEMANTIC_SCHOLAR_API_KEY?: string;
  CORE_API_KEY?: string;
  NCBI_API_KEY?: string;
  GITHUB_TOKEN?: string;
  HUGGINGFACE_API_KEY?: string;
  STACKEXCHANGE_KEY?: string;
  LISTENNOTES_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  DEEPL_API_KEY?: string;
  
  // App configuration
  APP_URL?: string;
  ALLOWED_ORIGINS?: string;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Env {}
  }
}

export {};
