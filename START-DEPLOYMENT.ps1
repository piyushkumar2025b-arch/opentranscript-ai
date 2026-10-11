# Quick Deployment Script - OpenTranscript AI to Cloudflare
# Run this script to start the deployment process

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  OpenTranscript AI - Cloudflare Deploy" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "This script will help you deploy to Cloudflare." -ForegroundColor Yellow
Write-Host ""

# Check Node.js
Write-Host "Checking prerequisites..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    $major = [int]($nodeVersion -replace '^v(\d+)\..*', '$1')
    if ($major -lt 20) {
        Write-Host "✗ Node.js $nodeVersion is not supported. Vite 8 requires Node.js v20.19+ or v22 LTS." -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Node.js installed: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js is not installed. Please install Node.js v22 LTS (or v20.19+)" -ForegroundColor Red
    exit 1
}

# Check npm
try {
    $npmVersion = npm --version
    Write-Host "✓ npm installed: v$npmVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ npm is not installed" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Choose deployment method
Write-Host "Choose deployment method:" -ForegroundColor Yellow
Write-Host "  1. Automated (Recommended) - Runs the full setup script" -ForegroundColor Gray
Write-Host "  2. Quick Deploy - For when resources already exist" -ForegroundColor Gray
Write-Host "  3. Manual - Shows you the commands to run" -ForegroundColor Gray
Write-Host ""

$choice = Read-Host "Enter choice (1/2/3)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Starting automated deployment..." -ForegroundColor Green
        Write-Host ""
        
        # Run the setup script
        & ".\scripts\setup-cloudflare.ps1"
    }
    
    "2" {
        Write-Host ""
        Write-Host "Quick deploy - Building and deploying..." -ForegroundColor Green
        Write-Host ""
        
        # Build
        Write-Host "Building application..." -ForegroundColor Gray
        npm run build
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ Build failed" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "✓ Build successful" -ForegroundColor Green
        Write-Host ""
        
        # Deploy
        Write-Host "Deploying to Cloudflare Pages..." -ForegroundColor Gray
        npm run deploy
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ Deployment failed" -ForegroundColor Red
            exit 1
        }
        
        Write-Host ""
        Write-Host "✓ Deployment successful!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Your app is live at: https://opentranscript-ai.pages.dev" -ForegroundColor Cyan
    }
    
    "3" {
        Write-Host ""
        Write-Host "Manual deployment steps:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "1. Install dependencies:" -ForegroundColor Cyan
        Write-Host "   npm install" -ForegroundColor Gray
        Write-Host ""
        Write-Host "2. Authenticate with Cloudflare:" -ForegroundColor Cyan
        Write-Host "   npx wrangler login" -ForegroundColor Gray
        Write-Host ""
        Write-Host "3. Create D1 database:" -ForegroundColor Cyan
        Write-Host "   npx wrangler d1 create opentranscript-db" -ForegroundColor Gray
        Write-Host "   → Copy the database_id and update wrangler.toml" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "4. Initialize database schema:" -ForegroundColor Cyan
        Write-Host "   npx wrangler d1 execute opentranscript-db --file=./cloudflare.d1.schema.sql" -ForegroundColor Gray
        Write-Host ""
        Write-Host "5. Create KV namespace:" -ForegroundColor Cyan
        Write-Host "   npx wrangler kv:namespace create CACHE" -ForegroundColor Gray
        Write-Host "   → Copy the id and update wrangler.toml" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "6. Create Pages project:" -ForegroundColor Cyan
        Write-Host "   npx wrangler pages project create opentranscript-ai" -ForegroundColor Gray
        Write-Host ""
        Write-Host "7. Set API keys as secrets:" -ForegroundColor Cyan
        Write-Host "   npx wrangler secret put GEMINI_API_KEY" -ForegroundColor Gray
        Write-Host "   npx wrangler secret put GOOGLE_API_KEY" -ForegroundColor Gray
        Write-Host ""
        Write-Host "8. Build:" -ForegroundColor Cyan
        Write-Host "   npm run build" -ForegroundColor Gray
        Write-Host ""
        Write-Host "9. Deploy:" -ForegroundColor Cyan
        Write-Host "   npm run deploy" -ForegroundColor Gray
        Write-Host ""
        Write-Host "For detailed instructions, see DEPLOYMENT_CHECKLIST.md" -ForegroundColor Yellow
    }
    
    default {
        Write-Host "Invalid choice. Please run the script again and enter 1, 2, or 3." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Documentation:" -ForegroundColor Yellow
Write-Host "  • DEPLOYMENT_SUMMARY.md - Overview and next steps" -ForegroundColor Gray
Write-Host "  • DEPLOYMENT_CHECKLIST.md - Step-by-step instructions" -ForegroundColor Gray
Write-Host "  • VISUAL_GUIDE.md - Diagrams and flows" -ForegroundColor Gray
Write-Host "  • CLOUDFLARE_DEPLOYMENT.md - Full documentation" -ForegroundColor Gray
Write-Host ""
