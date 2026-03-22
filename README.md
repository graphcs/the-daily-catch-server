# The Daily Catch — Backend Server

Backend API server for [The Daily Catch](https://github.com/queenawzq/The-Daily-Catch) iOS app. Pre-generates and caches personalized news briefs so the app loads stories instantly instead of waiting for AI generation.

## How It Works

1. **Cron job** runs every 6 hours, generating 3 stories per topic (10 topics) using the OpenRouter API (Perplexity Sonar model)
2. Stories are stored in a local SQLite database
3. When the iOS app requests a brief, the server **assembles** 5 stories from the pre-generated cache based on the user's ranked topic preferences — no AI call needed, responds in milliseconds
4. The app falls back to direct API calls if the server is unavailable

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/brief?topics=techAI,politics,money&energy=quick` | Get assembled 5-story brief |
| `GET` | `/api/deep/:storyId` | Get deep dive content for a story |
| `GET` | `/api/health` | Health check (includes latest batch info) |
| `POST` | `/api/admin/refresh` | Force immediate story regeneration |
| `GET` | `/api/docs` | Swagger UI for interactive API testing |

### Topics

`money`, `techAI`, `politics`, `climate`, `healthScience`, `culture`, `globalAffairs`, `businessStartups`, `sports`, `housingRealEstate`

### Brief Assembly

The `topics` parameter accepts 1–3 comma-separated ranked topics. Slot allocation:
- 1 topic: all 5 stories from that topic
- 2 topics: #1 gets 3 stories, #2 gets 2
- 3 topics: #1 gets 3, #2 gets 1, #3 gets 1

## Tech Stack

- **Runtime:** Node.js + TypeScript + Express
- **Database:** SQLite (better-sqlite3)
- **AI API:** OpenRouter (Perplexity Sonar)
- **Hosting:** Railway
- **Docs:** Swagger UI

## Setup

```bash
# Install dependencies
npm install

# Create .env from example
cp .env.example .env
# Edit .env and add your OPENROUTER_API_KEY

# Build
npm run build

# Start server
npm start

# Or run in dev mode (auto-reload)
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key |
| `PORT` | Server port (default: 3000) |

## Deployment

Deployed on Railway at `https://the-daily-catch-server-production.up.railway.app`

```bash
railway login
railway init
railway variables set OPENROUTER_API_KEY=your_key
railway up
railway domain
```

After deploying, trigger the initial story generation:
```bash
curl -X POST https://your-domain.up.railway.app/api/admin/refresh
```
