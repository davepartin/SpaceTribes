const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const db = new sqlite3.Database('spacetribes.db');

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS game_state (id INTEGER PRIMARY KEY, current_day INTEGER, prices TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS player_resources (player_id INTEGER, stockpiles TEXT, credits INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS player_decisions (player_id INTEGER, day INTEGER, efforts TEXT, sales TEXT)`);

  // Init game state if not exists
  db.get('SELECT * FROM game_state WHERE id = 1', (err, row) => {
    if (!row) {
      const initialPrices = JSON.stringify({ crystium: 10, adamantite: 15, xerium: 20, nourite: 12 });
      db.run('INSERT INTO game_state (id, current_day, prices) VALUES (1, 1, ?)', [initialPrices]);
    }
  });
});

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login/Register
app.post('/login', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  db.get('SELECT * FROM players WHERE name = ?', [name.toLowerCase()], (err, row) => {
    if (row) {
      return res.json({ playerId: row.id, name: row.name });
    }
    // Register new if <6 players
    db.all('SELECT COUNT(*) as count FROM players', (err, rows) => {
      if (rows[0].count >= 6) return res.status(400).json({ error: 'Max 6 players' });
      db.run('INSERT INTO players (name) VALUES (?)', [name.toLowerCase()], function(err) {
        if (err) return res.status(500).json({ error: 'Error registering' });
        const playerId = this.lastID;
        const initialStock = JSON.stringify({ crystium: 0, adamantite: 0, xerium: 0, nourite: 0 });
        db.run('INSERT INTO player_resources (player_id, stockpiles, credits) VALUES (?, ?, 0)', [playerId, initialStock]);
        res.json({ playerId, name });
      });
    });
  });
});

// Get Game Data for Dashboard
app.get('/game-data/:playerId', (req, res) => {
  const playerId = req.params.playerId;
  db.get('SELECT * FROM game_state WHERE id = 1', (err, game) => {
    if (err || !game) return res.status(500).json({ error: 'Game state error' });
    const prices = JSON.parse(game.prices);

    db.get('SELECT * FROM player_resources WHERE player_id = ?', [playerId], (err, resources) => {
      const stockpiles = JSON.parse(resources.stockpiles);

      // Leaderboard: all players' credits
      db.all('SELECT p.name, r.credits FROM players p JOIN player_resources r ON p.id = r.player_id ORDER BY r.credits DESC', (err, leaderboard) => {

        // Current decisions if any
        db.get('SELECT * FROM player_decisions WHERE player_id = ? AND day = ?', [playerId, game.current_day], (err, decisions) => {
          const efforts = decisions ? JSON.parse(decisions.efforts) : { crystium: 0, adamantite: 0, xerium: 0, nourite: 0 };
          const sales = decisions ? JSON.parse(decisions.sales) : { crystium: 0, adamantite: 0, xerium: 0, nourite: 0 };
          res.json({ currentDay: game.current_day, prices, stockpiles, credits: resources.credits, leaderboard, efforts, sales });
        });
      });
    });
  });
});

// Submit Decisions
app.post('/submit-decisions', (req, res) => {
  const { playerId, efforts, sales } = req.body;
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, game) => {
    const day = game.current_day;
    const effortsJson = JSON.stringify(efforts);
    const salesJson = JSON.stringify(sales);

    // Check total efforts <=10
    const totalEffort = Object.values(efforts).reduce((a, b) => a + b, 0);
    if (totalEffort > 10) return res.status(400).json({ error: 'Effort exceeds 10' });

    // Check sales <= stockpiles
    db.get('SELECT stockpiles FROM player_resources WHERE player_id = ?', [playerId], (err, row) => {
      const stockpiles = JSON.parse(row.stockpiles);
      for (let min in sales) {
        if (sales[min] > stockpiles[min]) return res.status(400).json({ error: `Can't sell more ${min} than you have` });
      }

      // Upsert decision
      db.run('REPLACE INTO player_decisions (player_id, day, efforts, sales) VALUES (?, ?, ?, ?)', [playerId, day, effortsJson, salesJson], (err) => {
        if (err) return res.status(500).json({ error: 'Submit error' });
        res.json({ success: true });
      });
    });
  });
});

// Process Day (manual trigger)
app.post('/process-day', (req, res) => {
  db.get('SELECT * FROM game_state WHERE id = 1', (err, game) => {
    const day = game.current_day;
    const prices = JSON.parse(game.prices);

    // Get all decisions (if no decision, assume 0)
    db.all('SELECT p.id, d.efforts, d.sales FROM players p LEFT JOIN player_decisions d ON p.id = d.player_id AND d.day = ?', [day], (err, rows) => {
      let totalSupply = { crystium: 0, adamantite: 0, xerium: 0, nourite: 0 };

      // Process each player
      rows.forEach(row => {
        const efforts = row.efforts ? JSON.parse(row.efforts) : { crystium: 0, adamantite: 0, xerium: 0, nourite: 0 };
        const sales = row.sales ? JSON.parse(row.sales) : { crystium: 0, adamantite: 0, xerium: 0, nourite: 0 };

        // Mine: yield = effort * 1 (simple)
        let mined = {};
        for (let min in efforts) {
          mined[min] = efforts[min];
          totalSupply[min] += mined[min];
        }

        db.get('SELECT * FROM player_resources WHERE player_id = ?', [row.id], (err, resRow) => {
          let stockpiles = JSON.parse(resRow.stockpiles);
          let credits = resRow.credits;

          // Add mined
          for (let min in mined) stockpiles[min] += mined[min];

          // Sell
          for (let min in sales) {
            if (sales[min] <= stockpiles[min]) {
              stockpiles[min] -= sales[min];
              credits += sales[min] * prices[min];
            }
          }

          // Update resources
          db.run('UPDATE player_resources SET stockpiles = ?, credits = ? WHERE player_id = ?', [JSON.stringify(stockpiles), credits, row.id]);
        });
      });

      // Update prices: simple supply/demand - price -= (supply / 6) if supply > demand threshold (assume demand=10 per mineral)
      let newPrices = {};
      for (let min in prices) {
        const supply = totalSupply[min];
        newPrices[min] = Math.max(5, prices[min] - Math.floor(supply / 6)); // Basic formula, min 5
      }

      // Advance day
      db.run('UPDATE game_state SET current_day = ?, prices = ? WHERE id = 1', [day + 1, JSON.stringify(newPrices)]);
      res.json({ success: true });
    });
  });
});

app.listen(3000, () => console.log('Server on port 3000'));