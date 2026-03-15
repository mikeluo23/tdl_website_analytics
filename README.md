# TDL Advanced Stats

Next.js frontend for browsing TDL rec league basketball data. The app is currently a thin UI layer over an external stats API, with pages for players, teams, games, and a leaderboard view with basic charts.

## What This Project Does

- Lists players and links to per-player game logs
- Lists teams and links to team roster pages
- Lists games and links to box scores
- Supports a division dropdown so the same UI can switch between individual divisions or all divisions
- Shows a leaderboard with:
  - per-game vs total stat toggles
  - minimum games played filtering
  - player search
  - a top scorers bar chart
  - a TS% vs PPG scatter plot

The frontend does not currently scrape `tdlbasketball.com` directly. It expects a separate backend API to already expose normalized JSON.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Recharts

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` with the backend base URL:

```env
STATS_API_BASE=http://127.0.0.1:8000
```

3. Start the backend from [`TDLStats`](/C:/Users/luomi/d3-stats-frontend/TDLStats):

```bash
cd TDLStats
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

4. Start the frontend:

```bash
npm run dev
```

5. Open `http://localhost:3000`

Notes:

- The frontend now proxies browser requests through `/api/stats/*`, so the browser no longer depends on direct CORS access to the Python server.
- Server-rendered pages still default to `http://127.0.0.1:8000` if `STATS_API_BASE` is not set.
- The backend defaults to `DATA_SOURCE=csv` for local use, so freshly scraped CSV snapshots can be served even when the MySQL user is read-only.
- Check backend freshness at `http://127.0.0.1:8000/health`.

## Refresh Division Data

The repo now includes a config-driven scraper/import command for any active divisions listed in [`TDLStats/division_specs.yaml`](/C:/Users/luomi/d3-stats-frontend/TDLStats/division_specs.yaml):

```bash
cd TDLStats
python refresh_divisions.py --skip-db
```

What it does:

- Reads active divisions from `division_specs.yaml`
- Scrapes each configured TDL calendar page
- Follows each completed event page
- Rewrites the CSV snapshots in [`TDLStats`](/C:/Users/luomi/d3-stats-frontend/TDLStats)
- Preserves division metadata in the snapshots so the app can separate teams across divisions

For local development, this script is now the intended replacement for the older hand-run SQL chain in [`TDLStats`](/C:/Users/luomi/d3-stats-frontend/TDLStats). If your MySQL user is read-only, the refreshed CSV snapshots are still enough because the backend serves them by default in `DATA_SOURCE=csv` mode.

Useful commands:

```bash
cd TDLStats
python refresh_divisions.py --validate-config
python refresh_divisions.py --skip-db
python refresh_divisions.py --skip-db --division d3_mondays
python refresh_d3_mondays.py --skip-db
```

Notes:

- `refresh_d3_mondays.py` is now just a compatibility wrapper for the old single-division flow.
- Multi-division refresh currently targets CSV mode. The legacy MySQL schema is still single-division-oriented, so use `--skip-db` when scraping more than `d3_mondays`.

## Historical Backfill

Historical scraping is now isolated in a separate script so it can be tested locally without changing the live site data path:

```bash
cd TDLStats
python backfill_history.py --validate-config
python backfill_history.py --division d3_mondays --max-new-events 10
python backfill_history.py
```

What it does:

- Starts from each division's `leaders_url` page in [`division_specs.yaml`](/C:/Users/luomi/d3-stats-frontend/TDLStats/division_specs.yaml)
- Discovers player profile pages
- Reads each player's page and collects unique event URLs from game logs
- Skips player pages and event pages that have already been visited
- Writes separate historical files:
  - [`historical_games.csv`](/C:/Users/luomi/d3-stats-frontend/TDLStats/historical_games.csv)
  - [`historical_player_game_stats.csv`](/C:/Users/luomi/d3-stats-frontend/TDLStats/historical_player_game_stats.csv)
  - [`historical_team_game_totals.csv`](/C:/Users/luomi/d3-stats-frontend/TDLStats/historical_team_game_totals.csv)
  - [`historical_team_lineages.csv`](/C:/Users/luomi/d3-stats-frontend/TDLStats/historical_team_lineages.csv)
  - plus player/game discovery manifests for dedupe

Important rollback boundary:

- The current app/API does not read these historical files yet
- The existing live refresh flow still only uses [`refresh_divisions.py`](/C:/Users/luomi/d3-stats-frontend/TDLStats/refresh_divisions.py) and the current CSV snapshots
- If the historical crawler needs to be abandoned, stop running it or delete the `historical_*.csv` files; the live site remains unchanged

Historical team identity rule:

- Same normalized team name + same division id across seasons = same lineage
- Different team name = new lineage
- Different division id = new lineage
- Each season still gets its own team-season record in the historical totals output

## PostgreSQL Import

If the merged CSV store becomes too slow locally, you can import the current dataset into PostgreSQL without changing the live API mode yet.

1. Add PostgreSQL connection settings to [`TDLStats/.env`](/C:/Users/luomi/d3-stats-frontend/TDLStats/.env):

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tdl_stats
DB_USER=postgres
DB_PASSWORD=your_password_here
```

2. Install/update backend dependencies:

```bash
cd TDLStats
python -m pip install -r requirements.txt
```

3. Import the current merged CSV-backed store into PostgreSQL:

```bash
cd TDLStats
python sync_postgres.py --truncate
```

What it writes:

- `teams`
- `players`
- `games`
- `player_game_stats`
- `team_game_totals`
- `player_season_totals`
- `team_season_totals`

This is currently a safe staging step:

- it uses the same merged data that the CSV-backed API already sees
- it does not replace the current API mode yet
- if the import looks wrong, you can rerun it after fixing data issues without affecting the live CSV flow

To switch the heavy leaderboard metadata endpoints to PostgreSQL locally, add this to [`TDLStats/.env`](/C:/Users/luomi/d3-stats-frontend/TDLStats/.env):

```env
POSTGRES_ANALYTICS=1
```

That currently moves these endpoints to PostgreSQL while the rest of the site can stay on the CSV-backed path:

- `/divisions`
- `/season-options`
- `/leaderboard`

## Expected API Endpoints

The frontend currently assumes these endpoints exist:

- `GET /players`
- `GET /players/:id/games`
- `GET /teams`
- `GET /teams/:id/roster`
- `GET /games`
- `GET /games/:id/boxscore`
- `GET /leaderboard`
- `GET /divisions`

Notes:

- Most pages render generic tables from whatever fields the API returns.
- The leaderboard page normalizes common stat names on the frontend.
- True Shooting Percentage is computed client-side from `PTS`, `FGA`, and `FTA`.
- List endpoints now accept `?division=<division_id>` in CSV mode so the frontend can scope the site to one division while keeping an all-divisions view available.

## Current Route Map

- `/`
  - landing page
- `/players`
  - player directory with basic search
- `/players/[id]`
  - player game log table
- `/teams`
  - team directory
- `/teams/[id]`
  - team roster table
- `/games`
  - game list table
- `/games/[id]`
  - game box score table
- `/leaderboard`
  - sortable leaderboard and charts

## Project Structure

```text
app/
  components/Nav.tsx
  games/
  leaderboard/
  players/
  teams/
lib/
  api.ts
public/
```

Key implementation details:

- [`lib/api.ts`](/C:/Users/luomi/d3-stats-frontend/lib/api.ts) centralizes fetches and defaults local backend access to `http://127.0.0.1:8000`.
- [`app/api/stats/[...path]/route.ts`](/C:/Users/luomi/d3-stats-frontend/app/api/stats/[...path]/route.ts) proxies browser requests to the backend.
- [`app/leaderboard/page.tsx`](/C:/Users/luomi/d3-stats-frontend/app/leaderboard/page.tsx) contains the most custom logic in the project today.
- Most detail pages are generic table renderers over backend payloads rather than fully designed stat views.

## Current Limitations

- The frontend depends entirely on an external API and has no built-in data pipeline.
- Most pages are schema-loose, so UI quality depends on backend field consistency.
- There is little error handling beyond basic fetch failures.
- There is no caching, persistence, or incremental refresh strategy in the frontend.
- There are no tests yet.
- There appears to be a duplicate route file under [`app/games/games/[id]/page.tsx`](/C:/Users/luomi/d3-stats-frontend/app/games/games/[id]/page.tsx) that likely is not needed.

## How To Level This Up

### 1. Hosting Architecture

The cleanest next step is to host this as two pieces:

- Frontend:
  - Deploy this Next.js app on Vercel for the fastest path to production
- Data/API layer:
  - Host a scraper + API + database separately on Railway, Render, Fly.io, or Supabase + scheduled jobs

Recommended production shape:

1. Scraper job pulls fresh data from `tdlbasketball.com` on a schedule
2. Raw HTML / raw payloads are stored for traceability
3. Parsed stats are normalized into database tables
4. API exposes stable endpoints for the frontend
5. Frontend consumes cached, normalized data

Why this is better:

- scraping and website traffic are decoupled
- the UI stays fast even if the source site is slow
- you can re-parse older source pages when parser logic improves
- stats can be versioned by season, league, and refresh time

### 2. Hosting Recommendations

If you want the simplest launch:

- Frontend on Vercel
- Postgres on Supabase or Neon
- API on Railway or Render
- Cron job for scraping every few hours during the season

If you want more control:

- Frontend on Vercel
- API in a container on Fly.io or Railway
- Postgres + Redis
- Background worker for scraping and parser retries

Important production additions:

- rate limiting and polite scrape intervals
- parser failure alerts
- database-backed caching
- environment separation for dev / staging / prod
- error monitoring with Sentry
- analytics for page usage and search behavior

## What More Data To Scrape From `tdlbasketball.com`

The biggest upgrade is moving from box-score browsing to season context.

High-value data to capture:

- Season and league metadata
  - season year
  - division
  - conference or pool
  - regular season vs playoffs
- Game metadata
  - scheduled date/time
  - final status
  - location / gym
  - overtime count
  - forfeit / canceled flags
- Team context
  - standings
  - wins / losses
  - streaks
  - points for / against
  - point differential
  - team roster history over time
- Player context
  - jersey number
  - team history
  - games played / games missed
  - starter vs bench status if available
- Box score detail
  - minutes played
  - personal fouls
  - turnovers
  - steals
  - blocks
  - offensive vs defensive rebounds
- Derived join data
  - which players were teammates in each game
  - opponent faced in each row
  - home vs away flag
  - win / loss attached to each player game

If `tdlbasketball.com` exposes any play-by-play or shot detail, that becomes the biggest jump in analytical ceiling. Even if it does not, game logs plus clean box scores are enough to build a much stronger product.

## Metrics Worth Adding

### Team Metrics

- Offensive rating
- Defensive rating
- Net rating
- Pace estimate
- Effective FG%
- True Shooting %
- Turnover rate
- Offensive rebound rate
- Free throw rate
- Strength of schedule
- Record by last 5 / last 10
- Win probability proxies based on scoring margin and opponent quality

### Player Metrics

- Usage rate estimate
- Assist rate
- Rebound rate
- Steal rate
- Block rate
- Turnover rate
- Game score
- Efficiency / PIR-style composite rating
- Per-36 or per-40 stats if minutes exist
- On/off estimates if lineup or substitution data exists
- Consistency metrics
  - scoring volatility
  - rolling averages
  - hot/cold streak detection

### Schedule / Competition Metrics

- Opponent-adjusted scoring
- Team performance by rest days
- Performance against top-half vs bottom-half teams
- Clutch game performance
- Blowout frequency
- Close-game record

## Visualizations To Build

The current leaderboard charts are a good start, but there is room for much richer exploration.

Best next charts:

- Player trend lines
  - points, rebounds, assists, TS%, turnovers by game
- Team dashboards
  - scoring margin by game
  - cumulative record over time
  - offensive vs defensive rating trend
- Shot profile style charts
  - only if shot location or 2P/3P breakdown is available
- Distribution charts
  - histogram of player scoring
  - TS% distribution by qualifying players
- Comparison views
  - player vs player radar or grouped bars
  - team vs team matchup previews
- Scatter plots
  - usage vs efficiency
  - assists vs turnovers
  - rebounding vs minutes
- Standings visuals
  - win progression chart
  - point differential ladder
- Game detail views
  - scoring by quarter
  - player contribution share
  - top performers for each game
- Network / roster visuals
  - teammate graph
  - roster continuity across weeks or seasons

## Highest-Leverage Next Steps

If the goal is to make this feel like a real public stats site, the best sequence is:

1. Stabilize the backend schema so pages are not rendering arbitrary field names
2. Add season, team, and game metadata from the source site
3. Store everything in Postgres instead of treating the API as a flat passthrough
4. Build real player and team dashboards instead of generic tables
5. Deploy frontend and backend separately with scheduled scraping
6. Add richer metrics once data quality is reliable

## Suggested Product Direction

A strong version of this project is not just "all the tables from TDL on a nicer site." The better direction is:

- searchable league archive
- clean player cards
- team dashboards
- standings and schedule context
- trend-based analytics
- simple, explainable advanced stats

That would make it useful for players, captains, and anyone following the league, instead of just being a box score mirror.
