# Space Tribes - Basic Version

This is a basic implementation of "Space Tribes," a multiplayer browser game inspired by M.U.L.E. with a sci-fi theme. It's designed for 1-6 players who colonize an alien planet, mine minerals, and sell them in a shared market with fluctuating prices based on supply and demand.

## Key Features in This Basic Version
- Players: 1-6 (no AI bots yet; if fewer than 6 join, the game still works but with fewer participants).
- Login: Enter a unique name on first visit; it registers you and your tribe (tribe name is same as player name for simplicity).
- Mechanics:
  - Each "day," allocate 10 effort points across 4 minerals (Crystium, Adamantite, Xerium, Nourite) for mining.
  - Choose how much of your stockpiled minerals to sell at current prices.
  - Shared market: Prices adjust based on total supply mined (high supply lowers prices).
- UI: Mobile-friendly. Login page, then a single dashboard screen showing current prices, your resources, leaderboard, and forms to submit mining/selling decisions.
- Day Processing: Manual for now—no auto-midnight cron. Any player can trigger "Process Day" via a button on the dashboard (simulates midnight: aggregates decisions, updates prices/resources/credits, advances day). In a real game, coordinate via text to submit before processing.
- Winning: After 28 days, highest Galactic Credits wins (but game doesn't auto-end; just check leaderboard).
- No raids, upgrades, events, or bots yet—focus on core mining/selling loop.
- Social: Decisions private until process; bluff/negotiate via external texts.

## Tech Stack
- Backend: Node.js with Express.js.
- Database: SQLite (file-based, `spacetribes.db`).
- Frontend: Vanilla HTML/CSS/JS (mobile-responsive).
- No frameworks; lightweight.

## Setup Instructions
1. Clone this repo into a folder like `spacetribes` on your GitHub (e.g., add to ministrybag.com repo).
2. Install dependencies:
   ```
   npm init -y
   npm install express sqlite3 body-parser
   ```
3. Run the server:
   ```
   node app.js
   ```
   - Server runs on http://localhost:3000.
4. Access in browser (phone-friendly).
5. Hosting: For free deployment (since needs backend):
   - Use Render.com, Heroku, or Vercel (serverless Node support).
   - Push to GitHub, connect to Render (new web service, Node, `node app.js` as start command).
   - SQLite works on Render (persistent disk).
6. Reset Game: Delete `spacetribes.db` and restart server to start over.
7. Edge Cases: If not all submit, unsubmitted players get 0 mining/selling (lose turn). Game continues indefinitely past 28 days.

## Database Schema
- `players`: id (INTEGER PRIMARY KEY), name (TEXT UNIQUE).
- `game_state`: id (INTEGER PRIMARY KEY), current_day (INTEGER), prices (TEXT as JSON: {crystium:10, adamantite:15, ...}).
- `player_resources`: player_id (INTEGER), stockpiles (TEXT as JSON: {crystium:0, ...}), credits (INTEGER).
- `player_decisions`: player_id (INTEGER), day (INTEGER), efforts (TEXT as JSON: {crystium:3, ...}), sales (TEXT as JSON: {crystium:2, ...}).

## Future Additions
- Add raids/upgrades/events.
- AI bots for empty slots (basic random decisions).
- Auto-processing with node-cron.
- Better security (sessions), random events.

Enjoy building on this base! It's balanced for strategy: Overmine crashes prices, underm ine misses opportunities—bluff to coordinate.