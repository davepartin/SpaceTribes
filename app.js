const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');

const app = express();
const db = new sqlite3.Database('spacetribes.db');

// Middleware
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Initialize DB with consistent resource names
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS game_state (id INTEGER PRIMARY KEY, current_day INTEGER, prices TEXT, needs TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS player_resources (player_id INTEGER, stockpiles TEXT, credits INTEGER, lastRaidDay INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS player_decisions (player_id INTEGER, day INTEGER, efforts TEXT, sales TEXT, raidTarget TEXT, raidMaterial TEXT, raidAmount INTEGER)`);

  db.get('SELECT * FROM game_state WHERE id = 1', (err, row) => {
    if (!row) {
      const initialPrices = JSON.stringify({ whiteDiamonds: 20, redRubies: 15, blueGems: 12, greenPoison: 10 });
      const initialNeeds = JSON.stringify({ whiteDiamonds: 20, redRubies: 20, blueGems: 20, greenPoison: 20 });
      db.run('INSERT INTO game_state (id, current_day, prices, needs) VALUES (1, 1, ?, ?)', [initialPrices, initialNeeds]);
    } else {
      const prices = JSON.parse(row.prices);
      if (!prices.whiteDiamonds) {
        prices.whiteDiamonds = 20;
        prices.redRubies = 15;
        prices.blueGems = 12;
        prices.greenPoison = 10;
        delete prices.crystium;
        delete prices.adamantite;
        delete prices.xerium;
        delete prices.nourite;
        db.run('UPDATE game_state SET prices = ? WHERE id = 1', [JSON.stringify(prices)]);
      }
      let needs = JSON.parse(row.needs || '{}');
      if (!needs.whiteDiamonds) {
        needs.whiteDiamonds = 20;
        needs.redRubies = 20;
        needs.blueGems = 20;
        needs.greenPoison = 20;
        db.run('UPDATE game_state SET needs = ? WHERE id = 1', [JSON.stringify(needs)]);
      }
    }
  });

  db.all('SELECT * FROM player_resources', (err, rows) => {
    if (rows) {
      rows.forEach(row => {
        const stockpiles = JSON.parse(row.stockpiles);
        if (stockpiles.crystium !== undefined) {
          stockpiles.whiteDiamonds = stockpiles.crystium || 0;
          stockpiles.redRubies = stockpiles.adamantite || 0;
          stockpiles.blueGems = stockpiles.xerium || 0;
          stockpiles.greenPoison = stockpiles.nourite || 0;
          delete stockpiles.crystium;
          delete stockpiles.adamantite;
          delete stockpiles.xerium;
          delete stockpiles.nourite;
          db.run('UPDATE player_resources SET stockpiles = ? WHERE player_id = ?', [JSON.stringify(stockpiles), row.player_id]);
        }
      });
    }
  });
});

// Serve index.html at root with error handling
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  console.log('Root route hit, serving:', filePath);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error serving index.html:', err.message);
      res.status(err.status || 500).send('Error loading page. Check server logs.');
    }
  });
});

// Login/Register
app.post('/login', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  db.get('SELECT * FROM players WHERE name = ?', [name.toLowerCase()], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row) return res.json({ playerId: row.id, name: row.name, playerName: row.name });

    db.all('SELECT COUNT(*) as count FROM players', (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (rows[0].count >= 6) return res.status(400).json({ error: 'Max 6 players' });
      db.run('INSERT INTO players (name) VALUES (?)', [name.toLowerCase()], function(err) {
        if (err) return res.status(500).json({ error: 'Error registering' });
        const playerId = this.lastID;
        const initialStock = JSON.stringify({ whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 });
        db.run('INSERT INTO player_resources (player_id, stockpiles, credits, lastRaidDay) VALUES (?, ?, 0, 0)', [playerId, initialStock]);
        res.json({ playerId, name, playerName: name });
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
    const needs = JSON.parse(game.needs);

    db.get('SELECT p.name FROM players p WHERE p.id = ?', [playerId], (err, player) => {
      if (err || !player) return res.status(500).json({ error: 'Player error' });
      const playerName = player.name;

      db.get('SELECT * FROM player_resources WHERE player_id = ?', [playerId], (err, resources) => {
        if (err || !resources) return res.status(500).json({ error: 'Resources error' });
        const stockpiles = JSON.parse(resources.stockpiles);
        const lastRaidDay = resources.lastRaidDay || 0;

        db.all('SELECT p.id, p.name, r.credits, r.lastRaidDay, r.stockpiles FROM players p JOIN player_resources r ON p.id = r.player_id ORDER BY r.credits DESC', (err, leaderboard) => {
          if (err) return res.status(500).json({ error: 'Leaderboard error' });

          db.get('SELECT * FROM player_decisions WHERE player_id = ? AND day = ?', [playerId, game.current_day - 1], (err, lastDecision) => {
            const lastEfforts = lastDecision ? JSON.parse(lastDecision.efforts) : { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
            const efforts = lastDecision ? JSON.parse(lastDecision.efforts) : { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
            const sales = lastDecision ? JSON.parse(lastDecision.sales) : { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
            const raidTarget = lastDecision ? lastDecision.raidTarget : null;
            const raidMaterial = lastDecision ? lastDecision.raidMaterial : null;
            const raidAmount = lastDecision ? lastDecision.raidAmount : 0;

            const raidSummaries = {};
            db.all('SELECT p.name as attacker, d.raidTarget, d.raidMaterial, d.raidAmount FROM player_decisions d JOIN players p ON d.player_id = p.id WHERE d.day = ?', 
              [game.current_day - 1], (err, raids) => {
              raids.forEach(raid => {
                if (raid.raidTarget && raid.raidTarget !== 'none') {
                  db.get('SELECT stockpiles FROM player_resources WHERE player_id = (SELECT id FROM players WHERE name = ?)', [raid.raidTarget], (err, targetRes) => {
                    const targetStockpiles = JSON.parse(targetRes.stockpiles);
                    const success = Math.random() < 0.66 && targetStockpiles[raid.raidMaterial] >= raid.raidAmount;
                    raidSummaries[raid.attacker] = `${raid.attacker} attempted to steal ${raid.raidAmount} ${raid.raidMaterial} from ${raid.raidTarget} - ${success ? 'Success' : 'Failed'}`;
                  });
                }
              });

              res.json({ 
                currentDay: game.current_day, 
                prices, 
                needs, 
                stockpiles, 
                credits: resources.credits || 0, 
                leaderboard: leaderboard.map(p => ({ ...p, stockpiles: JSON.parse(p.stockpiles) })), 
                efforts, 
                sales, 
                playerName, 
                lastEfforts, 
                lastRaidDay, 
                raidSummaries 
              });
            });
          });
        });
      });
    });
  });
});

// Submit Decisions with raid cost and limit
app.post('/submit-decisions', (req, res) => {
  const { playerId, efforts, sales, raidTarget, raidMaterial } = req.body;
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, game) => {
    if (err || !game) return res.status(500).json({ error: 'Game state error' });
    const day = game.current_day;
    const effortsJson = JSON.stringify(efforts);
    const salesJson = JSON.stringify(sales);

    const totalEffort = Object.values(efforts).reduce((a, b) => a + b, 0);
    if (totalEffort > 10) return res.status(400).json({ error: 'Effort exceeds 10' });

    db.get('SELECT stockpiles, lastRaidDay FROM player_resources WHERE player_id = ?', [playerId], (err, row) => {
      if (err || !row) return res.status(500).json({ error: 'Resources error' });
      const stockpiles = JSON.parse(row.stockpiles);
      const lastRaidDay = row.lastRaidDay || 0;
      for (let min in sales) {
        if (sales[min] > stockpiles[min]) return res.status(400).json({ error: `Can't sell more ${min} than you have` });
      }

      // Check and deduct 2 Green Poison for raid, limit to once per day
      if (raidTarget && raidTarget !== 'none' && raidMaterial) {
        if (lastRaidDay === day) return res.status(400).json({ error: 'Only one raid per day allowed' });
        if (stockpiles.greenPoison < 2) return res.status(400).json({ error: 'Need 2 Green Poison to raid' });
        stockpiles.greenPoison -= 2;
      }

      db.run('REPLACE INTO player_decisions (player_id, day, efforts, sales, raidTarget, raidMaterial, raidAmount) VALUES (?, ?, ?, ?, ?, ?, ?)', 
        [playerId, day, effortsJson, salesJson, raidTarget, raidMaterial, 4], (err) => {
        if (err) return res.status(500).json({ error: 'Submit error' });
        if (raidTarget && raidTarget !== 'none' && raidMaterial) {
          db.run('UPDATE player_resources SET stockpiles = ?, lastRaidDay = ? WHERE player_id = ?', [JSON.stringify(stockpiles), day, playerId]);
        }
        res.json({ success: true });
      });
    });
  });
});

// Process Day with Mining, Raids, then Trades
app.post('/process-day', (req, res) => {
  db.get('SELECT * FROM game_state WHERE id = 1', (err, game) => {
    if (err || !game) return res.status(500).json({ error: 'Game state error' });
    let day = game.current_day;
    let prices = JSON.parse(game.prices);
    let needs = JSON.parse(game.needs);

    db.all('SELECT p.id, d.efforts, d.sales, d.raidTarget, d.raidMaterial, d.raidAmount FROM players p LEFT JOIN player_decisions d ON p.id = d.player_id AND d.day = ?', [day], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      let totalSupply = { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };

      // Step 1: Process Mining
      rows.forEach(row => {
        let efforts = row.efforts ? JSON.parse(row.efforts) : { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
        // Default action for no decisions
        if (Object.values(efforts).reduce((a, b) => a + b, 0) === 0) {
          efforts = { whiteDiamonds: 1, redRubies: 1, blueGems: 1, greenPoison: 2 };
        }
        let mined = {};
        for (let min in efforts) {
          mined[min] = efforts[min];
          totalSupply[min] += mined[min];
        }
        db.get('SELECT * FROM player_resources WHERE player_id = ?', [row.id], (err, resRow) => {
          if (err || !resRow) return;
          let stockpiles = JSON.parse(resRow.stockpiles);
          for (let min in mined) stockpiles[min] += mined[min];
          db.run('UPDATE player_resources SET stockpiles = ? WHERE player_id = ?', [JSON.stringify(stockpiles), row.id]);
        });
      });

      // Step 2: Process Raids
      rows.forEach(row => {
        const raidTarget = row.raidTarget;
        const raidMaterial = row.raidMaterial;
        const raidAmount = row.raidAmount || 0;
        if (raidTarget && raidTarget !== 'none' && raidMaterial) {
          db.get('SELECT id FROM players WHERE name = ?', [raidTarget], (err, targetRow) => {
            if (err || !targetRow) return;
            const targetId = targetRow.id;
            db.get('SELECT stockpiles FROM player_resources WHERE player_id = ?', [targetId], (err, targetRes) => {
              if (err || !targetRes) return;
              const targetStockpiles = JSON.parse(targetRes.stockpiles);
              db.get('SELECT stockpiles FROM player_resources WHERE player_id = ?', [row.id], (err, attackerRes) => {
                if (err || !attackerRes) return;
                let attackerStockpiles = JSON.parse(attackerRes.stockpiles);
                if (Math.random() < 0.66 && targetStockpiles[raidMaterial] >= 4) {
                  targetStockpiles[raidMaterial] -= 4;
                  attackerStockpiles[raidMaterial] += 4;
                  db.run('UPDATE player_resources SET stockpiles = ? WHERE player_id = ?', [JSON.stringify(targetStockpiles), targetId]);
                  db.run('UPDATE player_resources SET stockpiles = ? WHERE player_id = ?', [JSON.stringify(attackerStockpiles), row.id]);
                }
              });
            });
          });
        }
      });

      // Step 3: Process Trades
      rows.forEach(row => {
        let sales = row.sales ? JSON.parse(row.sales) : { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
        db.get('SELECT * FROM player_resources WHERE player_id = ?', [row.id], (err, resRow) => {
          if (err || !resRow) return;
          let stockpiles = JSON.parse(resRow.stockpiles);
          let credits = resRow.credits || 0;
          for (let min in sales) {
            if (sales[min] <= stockpiles[min]) {
              stockpiles[min] -= sales[min];
              credits += sales[min] * prices[min];
            }
          }
          db.run('UPDATE player_resources SET stockpiles = ?, credits = ? WHERE player_id = ?', [JSON.stringify(stockpiles), credits, row.id]);
        });
      });

      // Reset prices to initial locked order, then adjust based on needs
      let newPrices = { whiteDiamonds: 20, redRubies: 15, blueGems: 12, greenPoison: 10 };
      for (let min in newPrices) {
        const supply = totalSupply[min];
        const need = needs[min];
        if (min === 'whiteDiamonds' && supply > need * 1.5) {
          newPrices[min] = Math.max(5, newPrices[min] * 0.4); // -60% for White Diamonds
        } else if (supply >= need) {
          newPrices[min] = Math.min(30, newPrices[min] * 1.1); // +10% bonus if need met
        } else if (supply < need * 0.5) {
          newPrices[min] = Math.min(50, newPrices[min] * 1.5); // +50% for severe shortage
        } else if (supply > need * 1.5) {
          newPrices[min] = Math.max(5, newPrices[min] * 0.5); // -50% for oversupply
        }
      }

      // Generate new random needs for the next day (15-25 range)
      const newNeeds = {};
      for (let min in needs) {
        newNeeds[min] = 15 + Math.floor(Math.random() * 11); // Random between 15 and 25
      }

      db.run('UPDATE game_state SET current_day = ?, prices = ?, needs = ? WHERE id = 1', [day + 1, JSON.stringify(newPrices), JSON.stringify(newNeeds)]);
      res.json({ success: true });
    });
  });
});

// Test route to verify server
app.get('/test', (req, res) => {
  res.send('Test OK - Server is running!');
});

// Schedule processing at midnight UTC
cron.schedule('0 0 * * *', () => {
  fetch('http://localhost:3000/process-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }).catch(err => console.error('Cron job error:', err));
}, {
  timezone: 'UTC'
});

app.listen(3000, () => console.log('Server on port 3000'));