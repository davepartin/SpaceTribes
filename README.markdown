Space Tribes
A web-based multiplayer game inspired by M.U.L.E., set in a sci-fi space theme for 1-6 players. Players manage tribes on an alien planet, making daily decisions about mining, trading, and raiding. The game runs for 28 days, with a new day processed at midnight UTC.
Requirements

Node.js
SQLite3
npm

Setup Instructions

Clone the repository to your local machine.
Navigate to the spacetribes folder:cd spacetribes


Install dependencies:npm install express sqlite3 body-parser node-cron


Run the server:node app.js


Open http://localhost:3000 in your browser to play.

Hosting
To host online (e.g., for ministrybag.com/spacetribes):

Use a service like Render.com, Heroku, or Vercel.
Push the repository to GitHub under your account (e.g., ministrybag.com/spacetribes).
Configure the hosting service to run node app.js and serve static files from the root directory.
Ensure the SQLite database (spacetribes.db) is writable by the server.

File Structure

app.js: Backend server with Express and SQLite.
client.js: Frontend JavaScript for dynamic content.
index.html: Login page.
dashboard.html: Main game dashboard.
decisions.html: Daily decisions page.
styles.css: CSS styling.
spacetribes.db: SQLite database (auto-created on first run).

Game Features

1-6 players, each choosing a unique tribe name on first login.
Daily decisions: Allocate 10 effort points to mine White Diamonds, Red Rubies, Blue Gems, or Green Poison; sell resources; raid others (costs 2 Green Poison, 66% success to steal 4 resources).
Midnight UTC processing: Mining, Raids, then Trades, with dynamic price adjustments based on supply/demand.
Dashboard shows stockpile, last mining, prices, needs, players' stockpiles, news board (raid results), and leaderboard.
Mobile-friendly interface with a space-themed design.

Notes

No authentication tokens; security assumes trusted players.
Game resets after 28 days (manual reset required).
Non-human players (if <6 players) use default actions (1 Diamond, 1 Ruby, 1 Gem, 2 Poison).
Use the "Process Day" button for testing to advance days manually.
