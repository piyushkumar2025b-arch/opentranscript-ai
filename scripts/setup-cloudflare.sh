#!/bin/bash

# Cloudflare Setup Script for Linux/macOS
# This script helps you set up Cloudflare resources for deployment

echo "=================================="
echo "OpenTranscript AI - Cloudflare Setup"
echo "=================================="
echo ""

# Check if Wrangler is installed
echo "Checking for Wrangler CLI..."
if command -v wrangler &> /dev/null; then
    echo "✓ Wrangler is installed: $(wrangler --version)"
else
    echo "✗ Wrangler is not installed"
    echo "Installing Wrangler..."
    npm install -g wrangler
    echo "✓ Wrangler installed successfully"
fi

echo ""

# Authenticate with Cloudflare
echo "Step 1: Authenticate with Cloudflare"
echo "This will open your browser to log in to Cloudflare"
read -p "Have you already authenticated? (y/n) " auth
if [ "$auth" != "y" ]; then
    wrangler login
    echo "✓ Authentication complete"
fi

echo ""

# Create D1 Database
echo "Step 2: Create D1 Database"
read -p "Create D1 database? (y/n) " dbChoice
if [ "$dbChoice" = "y" ]; then
    echo "Creating D1 database..."
    dbOutput=$(wrangler d1 create opentranscript-db 2>&1)
    
    # Extract database ID
    databaseId=$(echo "$dbOutput" | grep -oP 'database_id\s*=\s*"\K[^"]+')
    if [ ! -z "$databaseId" ]; then
        echo "✓ D1 database created with ID: $databaseId"
        echo ""
        echo "IMPORTANT: Update wrangler.toml with this database ID:"
        echo "  database_id = \"$databaseId\""
        echo ""
    else
        echo "! Could not extract database ID from output"
        echo "Please check the output above and update wrangler.toml manually"
    fi
fi

echo ""

# Initialize Database Schema
echo "Step 3: Initialize Database Schema"
read -p "Apply database schema to remote D1? (y/n) " schemaChoice
if [ "$schemaChoice" = "y" ]; then
    echo "Applying database schema to remote D1..."
    wrangler d1 execute opentranscript-db --file=./cloudflare.d1.schema.sql --remote
    if [ $? -ne 0 ]; then
        echo "✗ Failed to apply schema to remote D1 database."
        exit 1
    fi
    echo "Verifying remote D1 tables..."
    verifyOutput=$(wrangler d1 execute opentranscript-db --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'saved_lists');" --remote 2>&1)
    if echo "$verifyOutput" | grep -q "users" && echo "$verifyOutput" | grep -q "saved_lists"; then
        echo "✓ Database schema applied and verified on remote D1"
    else
        echo "✗ Remote table verification failed."
        exit 1
    fi
fi

echo ""

# Create KV Namespace
echo "Step 4: Create KV Namespace"
read -p "Create KV namespace? (y/n) " kvChoice
if [ "$kvChoice" = "y" ]; then
    echo "Creating KV namespace..."
    kvOutput=$(wrangler kv:namespace create CACHE 2>&1)
    
    # Extract KV namespace ID
    kvId=$(echo "$kvOutput" | grep -oP 'id\s*=\s*"\K[^"]+')
    if [ ! -z "$kvId" ]; then
        echo "✓ KV namespace created with ID: $kvId"
        echo ""
        echo "IMPORTANT: Update wrangler.toml with this KV namespace ID:"
        echo "  id = \"$kvId\""
        echo ""
    else
        echo "! Could not extract KV ID from output"
        echo "Please check the output above and update wrangler.toml manually"
    fi
fi

echo ""

# Create Cloudflare Pages Project
echo "Step 5: Create Cloudflare Pages Project"
read -p "Create Pages project? (y/n) " pagesChoice
if [ "$pagesChoice" = "y" ]; then
    echo "Creating Pages project..."
    wrangler pages project create opentranscript-ai
    echo "✓ Pages project created"
fi

echo ""

# Set Environment Variables
echo "Step 6: Set Environment Variables (Secrets)"
echo "You'll need to set API keys as secrets for the worker to function."
echo ""
echo "Required keys for basic functionality:"
echo "  - GEMINI_API_KEY (or OPENROUTER_API_KEY)"
echo "  - GOOGLE_API_KEY or YOUTUBE_API_KEY"
echo ""
echo "To set secrets, run:"
echo "  npx wrangler secret put GEMINI_API_KEY"
echo "  npx wrangler secret put GOOGLE_API_KEY"
echo ""

read -p "Do you want to set secrets now? (y/n) " secretsChoice
if [ "$secretsChoice" = "y" ]; then
    keys=(
        "GEMINI_API_KEY"
        "GOOGLE_API_KEY"
        "YOUTUBE_API_KEY"
        "OPENROUTER_API_KEY"
        "OPENAI_API_KEY"
        "ANTHROPIC_API_KEY"
        "GROQ_API_KEY"
        "TAVILY_API_KEY"
        "BRAVE_API_KEY"
        "NEWSAPI_KEY"
        "UNSPLASH_ACCESS_KEY"
        "GITHUB_TOKEN"
        "ELEVENLABS_API_KEY"
    )
    
    for key in "${keys[@]}"; do
        read -p "Set $key ? (y/n/skip) " setKey
        if [ "$setKey" = "y" ]; then
            wrangler secret put "$key"
        elif [ "$setKey" = "skip" ]; then
            break
        fi
    done
fi

echo ""

# Build and Deploy
echo "Step 7: Build and Deploy"
echo "Ready to build and deploy your application."
read -p "Build and deploy now? (y/n) " deployChoice
if [ "$deployChoice" = "y" ]; then
    echo "Building application..."
    npm run build
    
    echo "Deploying to Cloudflare Pages..."
    npm run deploy
    
    echo "✓ Deployment complete!"
fi

echo ""
echo "=================================="
echo "Setup Complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Update wrangler.toml with your database and KV IDs (if not done)"
echo "2. Set remaining API keys as secrets: npx wrangler secret put <KEY_NAME>"
echo "3. Visit your app at: https://opentranscript-ai.pages.dev"
echo "4. View logs: wrangler pages deployment tail"
echo ""
echo "Documentation: ./CLOUDFLARE_DEPLOYMENT.md"
echo ""
