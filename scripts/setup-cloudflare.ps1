# Cloudflare Setup Script for Windows PowerShell
# This script helps you set up Cloudflare resources for deployment

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "OpenTranscript AI - Cloudflare Setup" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if Wrangler is installed
Write-Host "Checking for Wrangler CLI..." -ForegroundColor Yellow
try {
    $wranglerVersion = wrangler --version
    Write-Host "✓ Wrangler is installed: $wranglerVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Wrangler is not installed" -ForegroundColor Red
    Write-Host "Installing Wrangler..." -ForegroundColor Yellow
    npm install -g wrangler
    Write-Host "✓ Wrangler installed successfully" -ForegroundColor Green
}

Write-Host ""

# Authenticate with Cloudflare
Write-Host "Step 1: Authenticate with Cloudflare" -ForegroundColor Yellow
Write-Host "This will open your browser to log in to Cloudflare" -ForegroundColor Gray
$auth = Read-Host "Have you already authenticated? (y/n)"
if ($auth -ne "y") {
    wrangler login
    Write-Host "✓ Authentication complete" -ForegroundColor Green
}

Write-Host ""

# Create D1 Database
Write-Host "Step 2: Create D1 Database" -ForegroundColor Yellow
$dbChoice = Read-Host "Create D1 database? (y/n)"
if ($dbChoice -eq "y") {
    Write-Host "Creating D1 database..." -ForegroundColor Gray
    $dbOutput = wrangler d1 create opentranscript-db 2>&1 | Out-String
    
    # Extract database ID
    if ($dbOutput -match "database_id\s*=\s*`"([a-f0-9-]+)`"") {
        $databaseId = $matches[1]
        Write-Host "✓ D1 database created with ID: $databaseId" -ForegroundColor Green
        Write-Host ""
        Write-Host "IMPORTANT: Update wrangler.toml with this database ID:" -ForegroundColor Yellow
        Write-Host "  database_id = `"$databaseId`"" -ForegroundColor Cyan
        Write-Host ""
    } else {
        Write-Host "! Could not extract database ID from output" -ForegroundColor Yellow
        Write-Host "Please check the output above and update wrangler.toml manually" -ForegroundColor Yellow
    }
}

Write-Host ""

# Initialize Database Schema
Write-Host "Step 3: Initialize Database Schema" -ForegroundColor Yellow
$schemaChoice = Read-Host "Apply database schema to remote D1? (y/n)"
if ($schemaChoice -eq "y") {
    Write-Host "Applying database schema to remote D1..." -ForegroundColor Gray
    wrangler d1 execute opentranscript-db --file=./cloudflare.d1.schema.sql --remote
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Failed to apply schema to remote D1 database." -ForegroundColor Red
        exit 1
    }
    Write-Host "Verifying remote D1 tables..." -ForegroundColor Gray
    $verifyOutput = wrangler d1 execute opentranscript-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'saved_lists');" --remote 2>&1 | Out-String
    if ($verifyOutput -match "users" -and $verifyOutput -match "saved_lists") {
        Write-Host "✓ Database schema applied and verified on remote D1" -ForegroundColor Green
    } else {
        Write-Host "✗ Remote table verification failed." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Create KV Namespace
Write-Host "Step 4: Create KV Namespace" -ForegroundColor Yellow
$kvChoice = Read-Host "Create KV namespace? (y/n)"
if ($kvChoice -eq "y") {
    Write-Host "Creating KV namespace..." -ForegroundColor Gray
    $kvOutput = wrangler kv:namespace create CACHE 2>&1 | Out-String
    
    # Extract KV namespace ID
    if ($kvOutput -match "id\s*=\s*`"([a-f0-9]+)`"") {
        $kvId = $matches[1]
        Write-Host "✓ KV namespace created with ID: $kvId" -ForegroundColor Green
        Write-Host ""
        Write-Host "IMPORTANT: Update wrangler.toml with this KV namespace ID:" -ForegroundColor Yellow
        Write-Host "  id = `"$kvId`"" -ForegroundColor Cyan
        Write-Host ""
    } else {
        Write-Host "! Could not extract KV ID from output" -ForegroundColor Yellow
        Write-Host "Please check the output above and update wrangler.toml manually" -ForegroundColor Yellow
    }
}

Write-Host ""

# Create Cloudflare Pages Project
Write-Host "Step 5: Create Cloudflare Pages Project" -ForegroundColor Yellow
$pagesChoice = Read-Host "Create Pages project? (y/n)"
if ($pagesChoice -eq "y") {
    Write-Host "Creating Pages project..." -ForegroundColor Gray
    wrangler pages project create opentranscript-ai
    Write-Host "✓ Pages project created" -ForegroundColor Green
}

Write-Host ""

# Set Environment Variables
Write-Host "Step 6: Set Environment Variables (Secrets)" -ForegroundColor Yellow
Write-Host "You'll need to set API keys as secrets for the worker to function." -ForegroundColor Gray
Write-Host ""
Write-Host "Required keys for basic functionality:" -ForegroundColor Cyan
Write-Host "  - GEMINI_API_KEY (or OPENROUTER_API_KEY)" -ForegroundColor Gray
Write-Host "  - GOOGLE_API_KEY or YOUTUBE_API_KEY" -ForegroundColor Gray
Write-Host ""
Write-Host "To set secrets, run:" -ForegroundColor Yellow
Write-Host "  npx wrangler secret put GEMINI_API_KEY" -ForegroundColor Cyan
Write-Host "  npx wrangler secret put GOOGLE_API_KEY" -ForegroundColor Cyan
Write-Host ""
$secretsChoice = Read-Host "Do you want to set secrets now? (y/n)"
if ($secretsChoice -eq "y") {
    $keys = @(
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "YOUTUBE_API_KEY",
        "OPENROUTER_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GROQ_API_KEY",
        "TAVILY_API_KEY",
        "BRAVE_API_KEY",
        "NEWSAPI_KEY",
        "UNSPLASH_ACCESS_KEY",
        "GITHUB_TOKEN",
        "ELEVENLABS_API_KEY"
    )
    
    foreach ($key in $keys) {
        $setKey = Read-Host "Set $key ? (y/n/skip)"
        if ($setKey -eq "y") {
            wrangler secret put $key
        } elseif ($setKey -eq "skip") {
            break
        }
    }
}

Write-Host ""

# Build and Deploy
Write-Host "Step 7: Build and Deploy" -ForegroundColor Yellow
Write-Host "Ready to build and deploy your application." -ForegroundColor Gray
$deployChoice = Read-Host "Build and deploy now? (y/n)"
if ($deployChoice -eq "y") {
    Write-Host "Building application..." -ForegroundColor Gray
    npm run build
    
    Write-Host "Deploying to Cloudflare Pages..." -ForegroundColor Gray
    npm run deploy
    
    Write-Host "✓ Deployment complete!" -ForegroundColor Green
}

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Update wrangler.toml with your database and KV IDs (if not done)" -ForegroundColor Gray
Write-Host "2. Set remaining API keys as secrets: npx wrangler secret put <KEY_NAME>" -ForegroundColor Gray
Write-Host "3. Visit your app at: https://opentranscript-ai.pages.dev" -ForegroundColor Gray
Write-Host "4. View logs: wrangler pages deployment tail" -ForegroundColor Gray
Write-Host ""
Write-Host "Documentation: ./CLOUDFLARE_DEPLOYMENT.md" -ForegroundColor Cyan
Write-Host ""
