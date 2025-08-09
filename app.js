const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./spacetribes.db');

app.use(bodyParser.json());
app.use(express.static('.'));

// Helper to get resource icon
function getResourceIcon(resource) {
  switch(resource) {
    case 'whiteDiamonds': return '💎';
    case 'redRubies': return '🔻';
    case 'blueGems': return '🔷';
    case 'greenPoison': return '🌱';
    default: return '';
  }
}

// Initialize database tables
db.serialize(() => {
  // Run the schema creation only if tables don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      race TEXT NOT NULL,
      pin TEXT NOT NULL,
      credits INTEGER DEFAULT 100,
      stockpiles TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      protected_resources TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      lastEfforts TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playerId INTEGER,
      day INTEGER,
      efforts TEXT,
      sales TEXT,
      raidTarget TEXT,
      raidMaterial TEXT,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (playerId) REFERENCES players(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS game_state (
      id INTEGER PRIMARY KEY,
      current_day INTEGER DEFAULT 1,
      market_prices TEXT DEFAULT '{"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}',
      colony_needs TEXT DEFAULT '{"whiteDiamonds":15,"redRubies":15,"blueGems":15,"greenPoison":15}',
      last_supply TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      active_players INTEGER DEFAULT 0,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS raid_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day INTEGER,
      attacker_id INTEGER,
      attacker_name TEXT,
      target_id INTEGER,
      target_name TEXT,
      resource TEXT,
      amount INTEGER,
      success BOOLEAN,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day INTEGER,
      message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS player_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playerId INTEGER,
      day INTEGER,
      resource TEXT,
      quantity INTEGER,
      price_per_unit INTEGER,
      total_earned INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (playerId) REFERENCES players(id)
    )
  `);

  // Initialize game state if not exists
  db.run(`INSERT OR IGNORE INTO game_state (id, current_day) VALUES (1, 1)`);

  db.run(`ALTER TABLE players ADD COLUMN protected_resources TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding protected_resources column:', err);
    }
  });

  db.run(`UPDATE players SET protected_resources = '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}' WHERE protected_resources IS NULL OR protected_resources = ''`);

  db.run(`ALTER TABLE players ADD COLUMN last_night_earnings INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding last_night_earnings column:', err);
    }
  });
});

// Login endpoint - fixed to accept name instead of race
app.post('/login', (req, res) => {
  const { name, pin } = req.body;
  console.log('Login attempt:', { name });
  
  if (!name) {
    return res.json({ error: 'Please select a commander' });
  }

  db.get('SELECT * FROM players WHERE name = ?', [name], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.json({ error: 'Database error' });
    }

    if (row) {
      // Player exists - check PIN
      if (row.pin === pin) {
        res.json({ playerId: row.id, race: row.race });
      } else {
        res.json({ error: 'Incorrect PIN' });
      }
    } else {
      // Create new player
      const tribeMap = {
        'Dave': 'Tribe of Endor',
        'Silas': 'Tribe of Siluria', 
        'Chris': 'Tribe of Elantris',
        'Brian': 'Tribe of Psychlos',
        'Joel': 'Tribe of Leojia',
        'Curtis': 'Tribe of Momma Say'
      };
      const race = tribeMap[name] || name;
      db.run(
        'INSERT INTO players (name, race, pin) VALUES (?, ?, ?)',
        [name, race, pin],
        function(err) {
          if (err) {
            console.error('Insert error:', err);
            return res.json({ error: 'Registration failed' });
          }
          res.json({ playerId: this.lastID, race: race });
        }
      );
    }
  });
});

// Get game data with proper calculations
app.get('/game-data/:playerId', (req, res) => {
  const playerId = req.params.playerId;
  
  // Get game state first
  db.get('SELECT * FROM game_state WHERE id = 1', (err, gameState) => {
    if (err || !gameState) {
      return res.json({ error: 'Game state error' });
    }

    const currentDay = gameState.current_day;
    const prices = JSON.parse(gameState.market_prices);
    const needs = JSON.parse(gameState.colony_needs);

    // Get player data
    db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, player) => {
      if (err || !player) {
        console.error('Player query error:', err);
        return res.json({ error: 'Player not found' });
      }
      console.log('Player data loaded:', player.name);

      // Get last night's sales data
      db.all(
        'SELECT * FROM player_sales WHERE playerId = ? AND day = ?',
        [playerId, Math.max(1, currentDay - 1)],
        (err, lastNightSales) => {
          if (err) {
            console.error('Sales query error:', err);
            lastNightSales = [];
          }
          console.log('Sales data loaded:', lastNightSales.length, 'records');

          // Get all players for leaderboard
          db.all('SELECT * FROM players ORDER BY credits DESC', [], (err, allPlayers) => {
            if (err) allPlayers = [];

            // Get today's raid logs
            db.all(
              'SELECT * FROM raid_logs WHERE day = ?',
              [currentDay],
              (err, raids) => {
                if (err) raids = [];

                // Get recent news
                db.all(
                  'SELECT message FROM news ORDER BY day DESC, id DESC LIMIT 20',
                  [],
                  (err, newsRows) => {
                    if (err) newsRows = [];
                    const newsMessages = newsRows.map(row => row.message);

                    // Get player's pending decision
                    db.get(
                      'SELECT * FROM decisions WHERE playerId = ? AND day = ?',
                      [playerId, currentDay],
                      (err, decision) => {
                        // Get today's decisions for status checking
                        db.all('SELECT * FROM decisions WHERE day = ?', [currentDay], (err, todayDecisions) => {
                          if (err) todayDecisions = [];

                          const leaderboard = allPlayers.map(p => ({
                            id: p.id,
                            name: p.name,
                            race: p.race,
                            credits: p.credits,
                            stockpiles: JSON.parse(p.stockpiles || '{}'),
                            hasSubmitted: todayDecisions.some(d => d.playerId === p.id),
                            hasPlayed: p.credits > 100 || Object.values(JSON.parse(p.stockpiles || '{}')).some(v => v > 0)
                          }));

                          // Format leaderboard
                          const formattedLeaderboard = leaderboard.map(p => ({
                            id: p.id,
                            name: p.name,
                            race: p.race,
                            credits: p.credits,
                            stockpiles: p.stockpiles,
                            hasSubmitted: p.hasSubmitted,
                            hasPlayed: p.hasPlayed
                          }));

                          // Calculate available robots
                          const playerStockpiles = JSON.parse(player.stockpiles || '{}');
                          const protectedResources = JSON.parse(player.protected_resources || '{}');
                          const totalStockpiles = {};
                          const allResources = ['whiteDiamonds', 'redRubies', 'blueGems', 'greenPoison'];
                          allResources.forEach(resource => {
                            totalStockpiles[resource] = (playerStockpiles[resource] || 0) + (protectedResources[resource] || 0);
                          });

                          // Count active players for this day
                          db.all('SELECT * FROM decisions WHERE day = ?', [currentDay], (err, decisions) => {
                            const activePlayers = decisions ? decisions.length : 0;
                            const lastSupply = JSON.parse(gameState.last_supply || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}');
                            
                            // Prepare response
                            const response = {
                              currentDay,
                              playerId: player.id,
                              playerName: player.name,
                              playerRace: player.race,
                              credits: player.credits,
                              stockpiles: playerStockpiles,
                              protectedResources: protectedResources,
                              totalStockpiles: totalStockpiles,
                              lastEfforts: JSON.parse(player.lastEfforts || '{}'),
                              prices,
                              needs,
                              lastSupply: lastSupply,
                              activePlayers: activePlayers,
                              leaderboard: formattedLeaderboard,
                              news: newsMessages,
                              efforts: decision ? JSON.parse(decision.efforts || '{}') : {},
                              sales: decision ? JSON.parse(decision.sales || '{}') : {},
                              raidTarget: decision ? decision.raidTarget : 'none',
                              raidMaterial: decision ? decision.raidMaterial : null,
                              hasSubmitted: !!decision,
                              lastNightSales: lastNightSales || [],
                              lastNightEarnings: player.last_night_earnings || 0
                            };
                            res.json(response);
                          });
                        });
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    });
  });
});

// Submit decisions
app.post('/submit-decisions', (req, res) => {
  const { playerId, efforts, sales, raidTarget, raidMaterial } = req.body;
  
  // Validate effort points (max 10)
  const totalEffort = Object.values(efforts).reduce((sum, e) => sum + (e || 0), 0);
  if (totalEffort > 10) {
    return res.json({ error: 'Too many effort points! Maximum is 10.' });
  }
  // Validate sales limits (max 15 per resource)
  for (const [resource, amount] of Object.entries(sales)) {
    if ((amount || 0) > 15) {
      return res.json({ error: `Cannot sell more than 15 ${resource} per day. You tried to sell ${amount}.` });
    }
  }

  // Get current day
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, state) => {
    if (err || !state) {
      return res.json({ error: 'Game state error' });
    }

    const currentDay = state.current_day;

    // Check if already submitted
    db.get(
      'SELECT id FROM decisions WHERE playerId = ? AND day = ?',
      [playerId, currentDay],
      (err, existing) => {
        if (existing) {
          // Update existing decision
          db.run(
            `UPDATE decisions 
             SET efforts = ?, sales = ?, raidTarget = ?, raidMaterial = ?
             WHERE playerId = ? AND day = ?`,
            [
              JSON.stringify(efforts),
              JSON.stringify(sales),
              raidTarget || 'none',
              raidMaterial || null,
              playerId,
              currentDay
            ],
            (err) => {
              if (err) {
                return res.json({ error: 'Failed to update decision' });
              }
              res.json({ success: true, message: 'Decision updated!' });
            }
          );
        } else {
          // Insert new decision
          db.run(
            `INSERT INTO decisions (playerId, day, efforts, sales, raidTarget, raidMaterial)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              playerId,
              currentDay,
              JSON.stringify(efforts),
              JSON.stringify(sales),
              raidTarget || 'none',
              raidMaterial || null
            ],
            (err) => {
              if (err) {
                return res.json({ error: 'Failed to save decision' });
              }
              res.json({ success: true, message: 'Decision saved!' });
            }
          );
        }
      }
    );
  });
});

// Process day - complete game logic
app.post('/process-day', (req, res) => {
  const { playerId } = req.body;
  console.log('🚀 Processing day for player:', playerId);

  db.get('SELECT * FROM game_state WHERE id = 1', (err, state) => {
    if (err) {
      console.error('Game state error:', err);
      return res.json({ error: 'Game state error: ' + err.message });
    }
    if (!state) {
      console.error('No game state found');
      return res.json({ error: 'No game state found' });
    }
    try {
      const currentDay = state.current_day;
      const prices = JSON.parse(state.market_prices || '{}');

      // Get all players and their decisions
      db.all('SELECT * FROM players', [], (err, players) => {
        if (err) {
          return res.json({ error: 'Failed to get players' });
        }
        db.all('SELECT * FROM decisions WHERE day = ?', [currentDay], (err, decisions) => {
          if (err) decisions = [];

          // Map for quick lookup
          const decisionMap = {};
          decisions.forEach(d => {
            decisionMap[d.playerId] = {
              efforts: JSON.parse(d.efforts || '{}'),
              sales: JSON.parse(d.sales || '{}'),
              raidTarget: d.raidTarget,
              raidMaterial: d.raidMaterial
            };
          });

          // 1. Initialize player data with current state
          const playerData = {};
          const news = [];
          players.forEach(player => {
            const decision = decisionMap[player.id] || { efforts: {}, sales: {}, raidTarget: 'none' };
            playerData[player.id] = {
              ...player,
              stockpiles: JSON.parse(player.stockpiles || '{}'),
              protectedResources: JSON.parse(player.protected_resources || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'),
              credits: player.credits,
              lastEfforts: decision.efforts,
              sales: decision.sales,
              raidTarget: decision.raidTarget,
              raidMaterial: decision.raidMaterial
            };
          });

          // STEP 1: MINING - Add mined resources to stockpiles
          // console.log('Step 1: Mining');
          const totalSupply = { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };

          players.forEach(player => {
            const pdata = playerData[player.id];
            // Merge protected resources into main stockpile (from previous day)
            Object.keys(pdata.protectedResources).forEach(resource => {
              pdata.stockpiles[resource] = (pdata.stockpiles[resource] || 0) + (pdata.protectedResources[resource] || 0);
            });
            pdata.protectedResources = { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
            // Add mined resources
            Object.keys(pdata.lastEfforts).forEach(resource => {
              const mined = pdata.lastEfforts[resource] || 0;
              pdata.stockpiles[resource] = (pdata.stockpiles[resource] || 0) + mined;
              totalSupply[resource] += mined;
            });
          });
          console.log('Total supply:', totalSupply);

          // STEP 1.5: AUTO-ASSIGN RESOURCES FOR ABSENT PLAYERS
          console.log('Step 1.5: Auto-assigning resources for absent players');

          players.forEach(player => {
            const pdata = playerData[player.id];
            const hasSubmitted = decisionMap[player.id] && Object.keys(decisionMap[player.id].efforts).length > 0;
            
            if (!hasSubmitted) {
              // Player didn't submit decisions - give them default resources
              console.log(`Auto-assigning resources to ${player.name}`);
              
              // Add auto-assigned resources
              pdata.stockpiles.whiteDiamonds = (pdata.stockpiles.whiteDiamonds || 0) + 2;
              pdata.stockpiles.blueGems = (pdata.stockpiles.blueGems || 0) + 1;
              pdata.stockpiles.redRubies = (pdata.stockpiles.redRubies || 0) + 1;
              pdata.stockpiles.greenPoison = (pdata.stockpiles.greenPoison || 0) + 1;
              
              // Update their lastEfforts to show what they "mined"
              pdata.lastEfforts = {
                whiteDiamonds: 2,
                redRubies: 1,
                blueGems: 1,
                greenPoison: 1
              };
              
              // Add to total supply for market calculations
              totalSupply.whiteDiamonds += 2;
              totalSupply.redRubies += 1;
              totalSupply.blueGems += 1;
              totalSupply.greenPoison += 1;
              
              // Add news message
              news.push(`${player.name} was auto-assigned: 2💎 1🔻 1🔷 1🌱 (absent)`);
            }
          });

          // 2. Process raids BEFORE sales
          // For each target/resource, collect all raiders
          // console.log('Step 2: Raiding');
          const raidResults = [];

          // Group raids by target and resource
          // const raidGroups = {};
          const raidGroups = {};
          // console.log('All decisions:', decisions);
          decisions.forEach(d => {
            // console.log('Checking decision:', d.playerId, 'raidTarget:', d.raidTarget, 'raidMaterial:', d.raidMaterial);
            if (d.raidTarget && d.raidTarget !== 'none' && d.raidMaterial) {
              // console.log('Valid raid found!');
              const target = players.find(p => p.name === d.raidTarget);
              // console.log('Target player found:', target ? target.name : 'NOT FOUND');
              if (target && target.id !== d.playerId) {
                if (!raidGroups[target.id]) raidGroups[target.id] = {};
                if (!raidGroups[target.id][d.raidMaterial]) raidGroups[target.id][d.raidMaterial] = [];
                raidGroups[target.id][d.raidMaterial].push(d.playerId);
                // console.log('Raid added to groups');
              }
            }
          });

          // console.log('Raid groups found:', raidGroups);
          // console.log('Processing raid groups...');

          // Process each raid group
          Object.entries(raidGroups).forEach(([targetId, resources]) => {
            targetId = parseInt(targetId);
            const targetData = playerData[targetId];
            Object.entries(resources).forEach(([resource, attackerIds]) => {
              // Filter attackers who have enough Green Poison
              const validAttackers = attackerIds.filter(attackerId => {
                return (playerData[attackerId].stockpiles.greenPoison || 0) >= 2;
              });
              
              if (validAttackers.length === 0) {
                // Log failed raids
                attackerIds.forEach(attackerId => {
                  const attackerName = playerData[attackerId].name;
                  const targetName = targetData.name;
                  news.push(`${attackerName} failed raiding ${getResourceIcon(resource)} from ${targetName} - not enough ${getResourceIcon('greenPoison')}`);
                  raidResults.push({
                    day: currentDay,
                    attacker_id: attackerId,
                    attacker_name: attackerName,
                    target_id: targetId,
                    target_name: targetName,
                    resource,
                    amount: 0,
                    success: false
                  });
                });
                return;
              }
              
              // Remove 2 Green Poison from each valid attacker
              validAttackers.forEach(attackerId => {
                playerData[attackerId].stockpiles.greenPoison -= 2;
              });
              
              // Calculate loot
              const targetStock = targetData.stockpiles[resource] || 0;
              const totalLootDemanded = 4 * validAttackers.length;
              const actualLoot = Math.min(totalLootDemanded, targetStock);
              const lootPerRaider = Math.floor(actualLoot / validAttackers.length);
              const lootRemainder = actualLoot % validAttackers.length;
              
              // Remove loot from target
              targetData.stockpiles[resource] = Math.max(0, targetStock - actualLoot);
              
              // Distribute loot to raiders (goes to protected resources)
              validAttackers.forEach(attackerId => {
                const attackerName = playerData[attackerId].name;
                const targetName = targetData.name;
                if (lootPerRaider > 0) {
                  playerData[attackerId].protectedResources[resource] = (playerData[attackerId].protectedResources[resource] || 0) + lootPerRaider;
                  news.push(`${attackerName} raided ${lootPerRaider} ${getResourceIcon(resource)} from ${targetName}`);
                } else {
                  news.push(`${attackerName} failed raiding ${getResourceIcon(resource)} from ${targetName}`);
                }
                raidResults.push({
                  day: currentDay,
                  attacker_id: attackerId,
                  attacker_name: attackerName,
                  target_id: targetId,
                  target_name: targetName,
                  resource,
                  amount: lootPerRaider,
                  success: lootPerRaider > 0
                });
              });
              
              // Note lost remainder
              if (lootRemainder > 0) {
                news.push(`${lootRemainder} ${getResourceIcon(resource)} lost in raid chaos on ${targetData.name}`);
              }
            });
          });

          // STEP 3: Calculate new market prices based on tonight's mining
          console.log('Step 3: Market Calculation');

          // Reset to base prices first
          const newPrices = { whiteDiamonds: 20, redRubies: 15, blueGems: 12, greenPoison: 10 };

          // Fixed colony needs for 6-player game
          const colonyNeeds = { whiteDiamonds: 15, redRubies: 15, blueGems: 15, greenPoison: 15 };

          // Apply market adjustments based on supply vs demand
          Object.keys(newPrices).forEach(resource => {
            const supply = totalSupply[resource] || 0;
            const need = colonyNeeds[resource];
            let price = newPrices[resource];
            // Removed all market news
            if (supply >= need && supply <= need * 1.1) {
              price = Math.min(price * 1.1, 30);
            } else if (supply < need * 0.5) {
              price = Math.min(price * 1.5, 50);
            } else if (supply > need * 1.5) {
              if (resource === 'whiteDiamonds') {
                price = Math.max(price * 0.35, 5);
              } else {
                price = Math.max(price * 0.5, 5);
              }
            } else if (supply < need) {
              price = Math.min(price * 1.2, 40);
            } else {
              price = Math.max(price * 0.8, 8);
            }
            newPrices[resource] = Math.round(price);
          });

          console.log('New market prices:', newPrices);

          // STEP 4: Process sales at NEW market prices
          console.log('Step 4: Sales Processing');
          const playerSalesData = {}; // Track sales per player

          players.forEach(player => {
            const pdata = playerData[player.id];
            let totalEarnings = 0;
            playerSalesData[player.id] = [];

            Object.keys(pdata.sales).forEach(resource => {
              const sellAmount = Math.min(pdata.sales[resource] || 0, pdata.stockpiles[resource] || 0);
              if (sellAmount > 0) {
                const pricePerUnit = newPrices[resource] || 10; // Use NEW prices, not old prices
                const earnings = sellAmount * pricePerUnit;
                
                totalEarnings += earnings;
                pdata.credits += earnings;
                pdata.stockpiles[resource] -= sellAmount;
                
                // Record individual sale
                playerSalesData[player.id].push({
                  resource,
                  quantity: sellAmount,
                  pricePerUnit,
                  totalEarned: earnings
                });
                // Removed sales news
              } else if ((pdata.sales[resource] || 0) > 0 && (pdata.stockpiles[resource] || 0) === 0) {
                // Removed failed sales news
              }
            });
            pdata.last_night_earnings = totalEarnings;
          });

          // STEP 5: Update game state with new prices
          // 4. Update all players in database
          const updatePromises = Object.values(playerData).map(pdata => {
            return new Promise((resolve, reject) => {
              db.run(
                'UPDATE players SET stockpiles = ?, protected_resources = ?, credits = ?, lastEfforts = ?, last_night_earnings = ? WHERE id = ?',
                [
                  JSON.stringify(pdata.stockpiles), 
                  JSON.stringify(pdata.protectedResources), 
                  pdata.credits, 
                  JSON.stringify(pdata.lastEfforts),
                  pdata.last_night_earnings || 0,
                  pdata.id
                ],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          });

          // 5. Save raid logs
          const raidPromises = raidResults.map(raid => {
            return new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO raid_logs (day, attacker_id, attacker_name, target_id, target_name, resource, amount, success)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [raid.day, raid.attacker_id, raid.attacker_name, raid.target_id, raid.target_name, raid.resource, raid.amount, raid.success],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          });

          // Save individual sales data
          const salesPromises = Object.entries(playerSalesData).flatMap(([playerId, sales]) => {
            return sales.map(sale => {
              return new Promise((resolve, reject) => {
                db.run(
                  `INSERT INTO player_sales (playerId, day, resource, quantity, price_per_unit, total_earned)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [playerId, currentDay, sale.resource, sale.quantity, sale.pricePerUnit, sale.totalEarned],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });
            });
          });

          // Save news to database
          const newsPromises = news.map(newsItem => {
            return new Promise((resolve, reject) => {
              db.run(
                'INSERT INTO news (day, message) VALUES (?, ?)',
                [currentDay, newsItem],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          });

          Promise.all([...updatePromises, ...raidPromises, ...newsPromises, ...salesPromises])
            .then(() => {
              // Update market prices and game state
              // Use the calculated newPrices from the market calculation step
              const adjustedNeeds = state.colony_needs ? JSON.parse(state.colony_needs) : {};
              const activePlayers = players.length;
              db.run(
                `UPDATE game_state SET 
                 current_day = current_day + 1, 
                 market_prices = ?, 
                 last_supply = ?,
                 last_updated = CURRENT_TIMESTAMP 
                 WHERE id = 1`,
                [JSON.stringify(newPrices), JSON.stringify(totalSupply)],
                (err) => {
                  if (err) {
                    console.error('Error updating game state:', err);
                    return res.json({ error: 'Failed to update game state' });
                  }
                  // Clear today's decisions
                  db.run('DELETE FROM decisions WHERE day = ?', [currentDay], (err) => {
                    if (err) {
                      console.error('Error clearing decisions:', err);
                    }
                    console.log('Day processing complete! News items:', news.length);
                    res.json({ 
                      success: true, 
                      message: 'Day processed successfully!',
                      newDay: currentDay + 1,
                      news: news,
                      newPrices,
                      activePlayers,
                      adjustedNeeds,
                      totalSupply
                    });
                  });
                }
              );
            })
            .catch(err => {
              console.error('Error processing day:', err);
              res.json({ error: 'Failed to process day: ' + err.message });
            });
        });
      });
    } catch (error) {
      console.error('Processing error:', error);
      console.error('Error stack:', error.stack);
      res.json({ error: 'Processing failed: ' + error.message });
    }
  });
});

// Reset game endpoint
app.post('/reset-game', (req, res) => {
  console.log('🔄 Resetting game...');
  
  db.serialize(() => {
    // Clear all data
    db.run('DELETE FROM players', (err) => {
      if (err) console.error('Error clearing players:', err);
    });
    
    db.run('DELETE FROM decisions', (err) => {
      if (err) console.error('Error clearing decisions:', err);
    });
    
    db.run('DELETE FROM raid_logs', (err) => {
      if (err) console.error('Error clearing raid logs:', err);
    });
    
    db.run('DELETE FROM news', (err) => {
      if (err) console.error('Error clearing news:', err);
    });
    
    db.run('DELETE FROM player_sales', (err) => {
      if (err) console.error('Error clearing sales:', err);
    });
    
    // Reset game state
    db.run(`UPDATE game_state SET 
      current_day = 1,
      market_prices = '{"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}',
      last_supply = '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      active_players = 0,
      last_updated = CURRENT_TIMESTAMP
      WHERE id = 1`, (err) => {
      if (err) {
        console.error('Error resetting game state:', err);
        return res.json({ error: 'Failed to reset game state' });
      }
      
      console.log('✅ Game reset complete!');
      res.json({ success: true, message: 'Game reset successfully!' });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Space Tribes server running on port ${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} to play!`);
});