const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const path = require('path');
const app = express();
const db = new sqlite3.Database('./db/spacetribes.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS Players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        tribe_name TEXT UNIQUE,
        is_ai BOOLEAN DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS game_state (
        id INTEGER PRIMARY KEY,
        current_day INTEGER,
        prices TEXT,
        last_prices TEXT,
        event_log TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS PlayerDecisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER,
        day INTEGER,
        decisions TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS PlayerResources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER,
        resources TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS PlayerUpgrades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER,
        miner_level INTEGER DEFAULT 0,
        defense_level INTEGER DEFAULT 0
    )`);
});

app.get('/api/players', (req, res) => {
    db.all('SELECT name, tribe_name FROM players WHERE is_ai = 0', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
    });
});

app.post('/api/login', (req, res) => {
    const { name, tribeName } = req.body;
    db.get('SELECT * FROM players WHERE name = ?', [name], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (row) {
            // Name exists, treat as login
            return res.json({ success: true });
        }
        // Name does not exist, check player count
        db.get('SELECT COUNT(*) as count FROM players WHERE is_ai = 0', (err, row2) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (row2.count >= 6) return res.status(400).json({ error: 'Maximum 6 players allowed' });
            db.run('INSERT INTO players (name, tribe_name, is_ai) VALUES (?, ?, 0)', [name, tribeName], function(err) {
                if (err) return res.status(500).json({ error: 'Database error' });
                db.run('INSERT INTO player_resources (player_id, stockpile, credits, upgrades) VALUES (?, ?, ?, ?)', 
                    [this.lastID, JSON.stringify({ bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 }), 1000, JSON.stringify({ miner: 0, defense: 0 })], 
                    err => {
                        if (err) return res.status(500).json({ error: 'Database error' });
                        addBotPlayers();
                        res.json({ success: true });
                    });
            });
        });
    });
});

function addBotPlayers() {
    db.get('SELECT COUNT(*) as count FROM players', (err, row) => {
        if (err) return;
        const botsNeeded = 6 - row.count;
        for (let i = 1; i <= botsNeeded; i++) {
            const botName = `Bot${i}`;
            const botTribe = `Bot Tribe ${i}`;
            db.get('SELECT * FROM players WHERE name = ?', [botName], (err, row) => {
                if (!row) {
                    db.run('INSERT INTO players (name, tribe_name, is_ai) VALUES (?, ?, 1)', [botName, botTribe], function(err) {
                        if (err) return;
                        db.run('INSERT INTO player_resources (player_id, stockpile, credits, upgrades) VALUES (?, ?, ?, ?)', 
                            [this.lastID, JSON.stringify({ bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 }), 1000, JSON.stringify({ miner: 0, defense: 0 })]);
                    });
                }
            });
        }
    });
}

app.get('/api/game-state/:playerName', (req, res) => {
    const playerName = req.params.playerName;
    db.get('SELECT * FROM players WHERE name = ?', [playerName], (err, player) => {
        if (err || !player) return res.status(400).json({ error: 'Player not found' });

        db.get('SELECT * FROM game_state WHERE id = 1', (err, gameState) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (!gameState) return res.status(404).json({ error: 'Game state not found' });

            db.get('SELECT stockpile, credits FROM player_resources WHERE player_id = ?', [player.id], (err, resourcesRow) => {
                if (err) return res.status(500).json({ error: 'Database error' });

                db.all('SELECT p.tribe_name, r.stockpile, r.credits FROM players p JOIN player_resources r ON p.id = r.player_id', 
                    (err, leaderboard) => {
                        if (err) return res.status(500).json({ error: 'Database error' });

                        const resources = JSON.parse(resourcesRow.stockpile);
                        resources.credits = resourcesRow.credits;

                        res.json({
                            currentDay: gameState.current_day,
                            prices: JSON.parse(gameState.prices),
                            lastPrices: gameState.last_prices ? JSON.parse(gameState.last_prices) : null,
                            resources: resources,
                            leaderboard: leaderboard.map(row => ({
                                tribe_name: row.tribe_name,
                                credits: row.credits
                            })).sort((a, b) => b.credits - a.credits),
                            eventLog: JSON.parse(gameState.events_log || '[]')
                        });
                    });
            });
        });
    });
});

app.get('/api/decisions/:playerName', (req, res) => {
    const playerName = req.params.playerName;
    db.get('SELECT id FROM players WHERE name = ?', [playerName], (err, player) => {
        if (err || !player) return res.status(400).json({ error: 'Player not found' });

        db.get('SELECT current_day FROM game_state WHERE id = 1', (err, gameState) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            db.get('SELECT decisions FROM player_decisions WHERE player_id = ? AND day = ?', 
                [player.id, gameState.current_day], (err, row) => {
                    if (err) return res.status(500).json({ error: 'Database error' });
                    res.json(row ? JSON.parse(row.decisions) : {});
                });
        });
    });
});

app.post('/api/submit-decisions', (req, res) => {
    const { playerName, decisions } = req.body;
    db.get('SELECT id FROM players WHERE name = ?', [playerName], (err, player) => {
        if (err || !player) return res.status(400).json({ error: 'Player not found' });

        db.get('SELECT current_day FROM game_state WHERE id = 1', (err, gameState) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            const totalEffort = Object.values(decisions.mining).reduce((sum, val) => sum + val, 0);
            if (totalEffort > 10) return res.status(400).json({ error: 'Total effort exceeds 10 points' });

            db.run('INSERT OR REPLACE INTO player_decisions (player_id, day, decisions) VALUES (?, ?, ?)', 
                [player.id, gameState.current_day, JSON.stringify(decisions)], 
                err => {
                    if (err) return res.status(500).json({ error: 'Database error' });
                    res.json({ success: true });
                });
        });
    });
});

async function processDay() {
    console.log('=== processDay function called ===');
    
    // Get current game state
    const gameState = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM game_state WHERE id = 1', (err, row) => {
            if (err || !row) {
                console.log('Error getting game state:', err);
                return resolve(null);
            }
            console.log('Game state retrieved:', row);
            resolve(row);
        });
    });
    if (!gameState) {
        console.log('No game state found, exiting processDay');
        return;
    }

    let { current_day, prices, last_prices, events_log } = gameState;
    prices = JSON.parse(prices);
    last_prices = last_prices ? JSON.parse(last_prices) : { bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 };
    events_log = JSON.parse(events_log || '[]');
    
    console.log('Processing day:', current_day);
    console.log('Current prices:', prices);

    // Get all players and their resources/decisions/upgrades
    const players = await new Promise((resolve, reject) => {
        db.all('SELECT p.id, p.name, p.is_ai, d.decisions, r.stockpile, r.credits, u.miner_level, u.defense_level FROM players p LEFT JOIN player_decisions d ON p.id = d.player_id AND d.day = ? LEFT JOIN player_resources r ON p.id = r.player_id LEFT JOIN player_upgrades u ON p.id = u.player_id', [current_day], (err, rows) => {
            if (err) {
                console.log('Error getting players:', err);
                return resolve([]);
            }
            console.log('Players retrieved:', rows.length);
            resolve(rows);
        });
    });

    const totalMined = { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 };
    const events = [];

    // Market dynamics parameters
    const basePrices = { bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 };
    const elasticities = { bluegems: 1.0, redrubies: 1.2, whitediamonds: 0.7, greenpoison: 1.5 };
    const yesterdayPrices = { ...prices };

    // 1. Collect sell decisions and compute total supply
    const totalSold = { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 };
    for (const player of players) {
        let decisions = player.decisions ? JSON.parse(player.decisions) : {
            mining: { bluegems: 2, redrubies: 2, whitediamonds: 2, greenpoison: 2 },
            sell: { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 },
            raidTarget: '',
            raidMineral: 'bluegems',
            upgrade: ''
        };
        for (const mineral of Object.keys(totalSold)) {
            totalSold[mineral] += (decisions.sell && decisions.sell[mineral]) ? decisions.sell[mineral] : 0;
        }
    }

    // 2. Price calculation (before payouts)
    Object.keys(prices).forEach(mineral => {
        const base = basePrices[mineral];
        const elasticity = elasticities[mineral];
        let rawTarget = base - (totalSold[mineral] / 10) * elasticity;
        rawTarget = Math.max(rawTarget, base * 0.2); // Floor at 20% of base
        let finalPrice = 0.3 * rawTarget + 0.7 * yesterdayPrices[mineral]; // Smoothing
        // 10% chance of random surge (up to +15%)
        if (Math.random() < 0.1) {
            const surge = 1 + Math.random() * 0.15;
            finalPrice *= surge;
            events.push(`Market surge! ${mineral} price jumps by ${(Math.round((surge-1)*1000)/10)}%!`);
        }
        finalPrice = Math.round(finalPrice * 10) / 10;
        prices[mineral] = finalPrice;
    });

    // 3. Apply payouts and update inventory
    for (const player of players) {
        let decisions = player.decisions ? JSON.parse(player.decisions) : {
            mining: { bluegems: 2, redrubies: 2, whitediamonds: 2, greenpoison: 2 },
            sell: { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 },
            raidTarget: '',
            raidMineral: 'bluegems',
            upgrade: ''
        };
        let resources = JSON.parse(player.stockpile || '{}');
        // Initialize any null mineral values to 0 (for old database data)
        const minerals = ['bluegems', 'redrubies', 'whitediamonds', 'greenpoison'];
        minerals.forEach(mineral => {
            if (resources[mineral] === null || resources[mineral] === undefined) {
                resources[mineral] = 0;
            }
        });
        let credits = player.credits || 1000;
        for (const mineral of minerals) {
            const soldAmount = (decisions.sell && decisions.sell[mineral]) ? decisions.sell[mineral] : 0;
            credits += soldAmount * prices[mineral];
            resources[mineral] -= soldAmount;
            resources[mineral] = Math.round(resources[mineral] * 10) / 10;
        }
        credits = Math.round(credits * 10) / 10;
        await new Promise(res => db.run('UPDATE player_resources SET stockpile = ?, credits = ? WHERE player_id = ?', [JSON.stringify(resources), credits, player.id], res));
    }

    // Process each player
    for (const player of players) {
        let decisions = player.decisions ? JSON.parse(player.decisions) : {
            mining: { bluegems: 2, redrubies: 2, whitediamonds: 2, greenpoison: 2 },
            sell: { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 },
            raidTarget: '',
            raidMineral: 'bluegems',
            upgrade: ''
        };
        // If no decisions were made, calculate default selling based on current resources
        if (!player.decisions) {
            let resources = JSON.parse(player.stockpile || '{}');
            // Initialize any null mineral values to 0 (for old database data)
            const minerals = ['bluegems', 'redrubies', 'whitediamonds', 'greenpoison'];
            minerals.forEach(mineral => {
                if (resources[mineral] === null || resources[mineral] === undefined) {
                    resources[mineral] = 0;
                }
            });
            decisions.sell = {
                bluegems: Math.floor((resources.bluegems || 0) * 0.5),
                redrubies: Math.floor((resources.redrubies || 0) * 0.5),
                whitediamonds: Math.floor((resources.whitediamonds || 0) * 0.5),
                greenpoison: Math.floor((resources.greenpoison || 0) * 0.5)
            };
        }
        if (player.is_ai) {
            let botResources = JSON.parse(player.stockpile || '{}');
            // Initialize any null mineral values to 0 (for old database data)
            const minerals = ['bluegems', 'redrubies', 'whitediamonds', 'greenpoison'];
            minerals.forEach(mineral => {
                if (botResources[mineral] === null || botResources[mineral] === undefined) {
                    botResources[mineral] = 0;
                }
            });
            decisions = {
                mining: { bluegems: 2, redrubies: 2, whitediamonds: 2, greenpoison: 2 },
                sell: {
                    bluegems: Math.floor((botResources.bluegems || 0) * 0.5),
                    redrubies: Math.floor((botResources.redrubies || 0) * 0.5),
                    whitediamonds: Math.floor((botResources.whitediamonds || 0) * 0.5),
                    greenpoison: Math.floor((botResources.greenpoison || 0) * 0.5)
                },
                raidTarget: Math.random() < 0.2 ? players[Math.floor(Math.random() * players.length)].name : '',
                raidMineral: ['bluegems', 'redrubies', 'whitediamonds', 'greenpoison'][Math.floor(Math.random() * 4)],
                upgrade: Math.random() < 0.1 ? (Math.random() < 0.5 ? 'miner' : 'defense') : ''
            };
            await new Promise(res => db.run('INSERT OR REPLACE INTO player_decisions (player_id, day, decisions) VALUES (?, ?, ?)', [player.id, current_day, JSON.stringify(decisions)], res));
        }
        let resources = JSON.parse(player.stockpile || '{}');
        // Initialize any null mineral values to 0 (for old database data)
        const minerals = ['bluegems', 'redrubies', 'whitediamonds', 'greenpoison'];
        minerals.forEach(mineral => {
            if (resources[mineral] === null || resources[mineral] === undefined) {
                resources[mineral] = 0;
            }
        });
        let credits = player.credits || 1000;
        const minerLevel = player.miner_level || 0;
        const defenseLevel = player.defense_level || 0;
        // Mining and selling
        for (const mineral of Object.keys(totalMined)) {
            // Hybrid mining yield per robot
            let perRobotYield = 1;
            if (mineral === 'redrubies') perRobotYield = 0.8;
            else if (mineral === 'whitediamonds') perRobotYield = 0.6;
            // bluegems and greenpoison default to 1
            const yieldBoost = 1 + (minerLevel * 0.1);
            const miningAssignment = (decisions.mining && decisions.mining[mineral]) ? decisions.mining[mineral] : 0;
            const soldAmount = (decisions.sell && decisions.sell[mineral]) ? decisions.sell[mineral] : 0;
            const minedAmount = miningAssignment * perRobotYield * yieldBoost;
            const earnedCredits = soldAmount * prices[mineral];
            
            console.log(`Player ${player.name} - ${mineral}:`);
            console.log(`  Initial stockpile: ${resources[mineral]}`);
            console.log(`  Mining assignment: ${miningAssignment}`);
            console.log(`  Per-robot yield: ${perRobotYield}`);
            console.log(`  Yield boost: ${yieldBoost}`);
            console.log(`  Mined amount: ${minedAmount}`);
            console.log(`  Sold amount: ${soldAmount}`);
            
            totalMined[mineral] += minedAmount;
            resources[mineral] += minedAmount;
            resources[mineral] -= soldAmount;
            resources[mineral] = Math.round(resources[mineral] * 10) / 10;
            credits += earnedCredits;
            
            console.log(`  Final stockpile: ${resources[mineral]}`);
            console.log(`  Credits earned: ${earnedCredits}`);
            console.log(`  Total credits: ${credits}`);
        }
        credits = Math.round(credits * 10) / 10;
        // Raid
        if (decisions.raidTarget && decisions.raidMineral) {
            const target = players.find(p => p.name === decisions.raidTarget);
            if (target) {
                let targetResources = JSON.parse(target.stockpile || '{}');
                const raidSuccessChance = 0.5 - (target.defense_level || 0) * 0.05;
                if (Math.random() < raidSuccessChance) {
                    const stolen = Math.min(targetResources[decisions.raidMineral] || 0, 5);
                    resources[decisions.raidMineral] += stolen;
                    targetResources[decisions.raidMineral] -= stolen;
                    resources[decisions.raidMineral] = Math.round(resources[decisions.raidMineral] * 10) / 10;
                    targetResources[decisions.raidMineral] = Math.round(targetResources[decisions.raidMineral] * 10) / 10;
                    await new Promise(res => db.run('UPDATE player_resources SET stockpile = ? WHERE player_id = ?', [JSON.stringify(targetResources), target.id], res));
                    events.push(`${player.name} successfully raided ${decisions.raidTarget} for ${stolen} ${decisions.raidMineral}!`);
                } else {
                    events.push(`${player.name}'s raid on ${decisions.raidTarget} failed!`);
                }
            }
        }
        // Upgrades
        if (decisions.upgrade) {
            const cost = 500 * ((decisions.upgrade === 'miner' ? minerLevel : defenseLevel) + 1);
            if (credits >= cost) {
                credits -= cost;
                credits = Math.round(credits * 10) / 10;
                const field = decisions.upgrade === 'miner' ? 'miner_level' : 'defense_level';
                await new Promise(res => db.run(`UPDATE player_upgrades SET ${field} = ${field} + 1 WHERE player_id = ?`, [player.id], res));
                events.push(`${player.name} upgraded ${decisions.upgrade} to level ${decisions.upgrade === 'miner' ? minerLevel + 1 : defenseLevel + 1}`);
            } else {
                events.push(`${player.name} could not afford ${decisions.upgrade} upgrade!`);
            }
        }
        // Save updated resources and credits
        await new Promise(res => db.run('UPDATE player_resources SET stockpile = ?, credits = ? WHERE player_id = ?', [JSON.stringify(resources), credits, player.id], res));
    }
    // Price and event logic (unchanged, but can be made async if needed)
    // Calculate new prices with balanced economy
    const totalValue = Object.keys(prices).reduce((sum, mineral) => sum + prices[mineral], 0);
    const targetTotalValue = 50;
    const supplyPressure = {};
    Object.keys(totalMined).forEach(mineral => {
        const normalizedSupply = Math.min(totalMined[mineral] / 30, 1);
        supplyPressure[mineral] = normalizedSupply;
    });
    Object.keys(prices).forEach(mineral => {
        const supplyRatio = supplyPressure[mineral] || 0;
        const demandRatio = 1 - supplyRatio;
        let newPrice = prices[mineral] * (0.85 + demandRatio * 0.3);
        newPrice = Math.max(4, Math.min(25, newPrice));
        prices[mineral] = Math.round(newPrice * 10) / 10;
    });
    const currentTotal = Object.keys(prices).reduce((sum, mineral) => sum + prices[mineral], 0);
    const adjustmentFactor = targetTotalValue / currentTotal;
    Object.keys(prices).forEach(mineral => {
        prices[mineral] = Math.round(prices[mineral] * adjustmentFactor * 10) / 10;
    });
    if (Math.random() < 0.3) {
        const eventType = Math.random();
        if (eventType < 0.25) {
            const minerals = ['bluegems', 'redrubies', 'whitediamonds', 'greenpoison'];
            const randomMineral = minerals[Math.floor(Math.random() * minerals.length)];
            prices[randomMineral] *= 1.4;
            prices[randomMineral] = Math.round(prices[randomMineral] * 10) / 10;
            events.push(`Market surge boosts ${randomMineral} prices!`);
        } else if (eventType < 0.5) {
            const minerals = ['bluegems', 'redrubies', 'whitediamonds', 'greenpoison'];
            const randomMineral = minerals[Math.floor(Math.random() * minerals.length)];
            for (const player of players) {
                let res = JSON.parse(player.stockpile || '{}');
                res[randomMineral] = Math.max(0, (res[randomMineral] || 0) - 3);
                res[randomMineral] = Math.round(res[randomMineral] * 10) / 10;
                await new Promise(res2 => db.run('UPDATE player_resources SET stockpile = ? WHERE player_id = ?', [JSON.stringify(res), player.id], res2));
            }
            events.push(`Pirate attack steals 3 ${randomMineral} from everyone!`);
        } else if (eventType < 0.75) {
            for (const player of players) {
                let res = JSON.parse(player.stockpile || '{}');
                Object.keys(res).forEach(mineral => {
                    if (mineral !== 'credits') {
                        res[mineral] = (res[mineral] || 0) + 1;
                        res[mineral] = Math.round(res[mineral] * 10) / 10;
                    }
                });
                await new Promise(res2 => db.run('UPDATE player_resources SET stockpile = ? WHERE player_id = ?', [JSON.stringify(res), player.id], res2));
            }
            events.push('Lucky strike! Everyone finds 1 of each mineral!');
        } else {
            Object.keys(prices).forEach(mineral => {
                const change = (Math.random() - 0.5) * 0.4;
                prices[mineral] *= (1 + change);
                prices[mineral] = Math.round(prices[mineral] * 10) / 10;
            });
            events.push('Market volatility shakes up all prices!');
        }
    }
    current_day++;
    if (current_day > 28) {
        current_day = 1;
        prices = { bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 };
        events.push('Game reset for a new cycle!');
    }
    await new Promise(res => db.run('UPDATE game_state SET current_day = ?, prices = ?, last_prices = ?, events_log = ?', [current_day, JSON.stringify(prices), JSON.stringify(yesterdayPrices), JSON.stringify(events)], res));
}

// Expose a manual "advance day" endpoint for testing
app.post('/api/process-day', (req, res) => {
  processDay();
  res.json({ success: true });
});

// Test endpoint to check database status
app.get('/api/test-db', (req, res) => {
  console.log('Test endpoint called');
  db.get('SELECT name FROM sqlite_master WHERE type="table"', (err, row) => {
    if (err) {
      console.error('Database test error:', err);
      return res.status(500).json({ error: 'Database connection failed', details: err.message });
    }
    
    db.all('SELECT name FROM sqlite_master WHERE type="table"', (err, tables) => {
      if (err) {
        return res.status(500).json({ error: 'Database query failed', details: err.message });
      }
      
      res.json({ 
        success: true, 
        message: 'Database connected successfully',
        tables: tables.map(t => t.name)
      });
    });
  });
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
  console.log('Simple test endpoint called');
  res.json({ message: 'Server is working!' });
});

// Logout endpoint
app.get('/logout', (req, res) => {
  res.redirect('/index.html');
});

// Reset game to day 1
app.post('/api/reset-game', (req, res) => {
  console.log('Reset game request received');
  
  // First, check if GameState exists
  db.get('SELECT * FROM game_state WHERE id = 1', (err, row) => {
    if (err) {
      console.error('Error checking GameState:', err);
      return res.status(500).json({ error: 'Database error checking game state' });
    }
    
    if (!row) {
      // Create GameState if it doesn't exist
      db.run('INSERT INTO game_state (id, current_day, prices, last_prices, events_log) VALUES (?, ?, ?, ?, ?)', 
        [1, 1, JSON.stringify({ bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 }), JSON.stringify({ bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 }), '[]'], 
        (err) => {
          if (err) {
            console.error('Error creating GameState:', err);
            return res.status(500).json({ error: 'Database error creating game state' });
          }
          console.log('GameState created successfully');
        });
    } else {
      // Update existing GameState
      db.run('UPDATE game_state SET current_day = 1, prices = ?, last_prices = ?, events_log = ?', 
        [JSON.stringify({ bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 }), JSON.stringify({ bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 }), '[]'], 
        (err) => {
          if (err) {
            console.error('Error resetting game state:', err);
            return res.status(500).json({ error: 'Database error resetting game state' });
          }
          console.log('GameState reset successfully');
        });
    }
    
    // Clear all player decisions for the new cycle
    db.run('DELETE FROM player_decisions', (err) => {
      if (err) {
        console.error('Error clearing player decisions:', err);
        return res.status(500).json({ error: 'Database error clearing decisions' });
      }
      console.log('Player decisions cleared successfully');
      
      // Reset all player resources to initial state
      db.all('SELECT id FROM players', (err, players) => {
        if (err) {
          console.error('Error getting players:', err);
          return res.status(500).json({ error: 'Database error getting players' });
        }
        
        if (!players || players.length === 0) {
          console.log('No players found, reset complete');
          return res.json({ success: true });
        }
        
        let completed = 0;
        players.forEach(player => {
          db.run('UPDATE player_resources SET stockpile = ? WHERE player_id = ?', 
            [JSON.stringify({ bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0, credits: 1000.0 }), player.id], 
            (err) => {
              if (err) {
                console.error('Error resetting player resources for player', player.id, ':', err);
              } else {
                console.log('Player resources reset for player', player.id);
              }
              completed++;
              if (completed === players.length) {
                console.log('All player resources reset successfully');
                
                // Reset player upgrades
                db.run('UPDATE player_upgrades SET miner_level = 0, defense_level = 0', (err) => {
                  if (err) {
                    console.error('Error resetting player upgrades:', err);
                    return res.status(500).json({ error: 'Database error resetting upgrades' });
                  }
                  console.log('Player upgrades reset successfully');
                  res.json({ success: true });
                });
              }
            });
        });
      });
    });
  });
});

cron.schedule('0 0 * * *', processDay);

app.listen(3000, () => {
    db.get('SELECT * FROM game_state WHERE id = 1', (err, row) => {
        if (!row) {
            db.run('INSERT INTO game_state (id, current_day, prices, last_prices, events_log) VALUES (?, ?, ?, ?, ?)', 
                [1, 1, JSON.stringify({ bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 }), JSON.stringify({ bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 }), '[]']);
        }
        console.log('Server running on port 3000');
    });
});