const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./spacetribes.db');

app.use(bodyParser.json());
app.use(express.static('.'));

// ========================================
// GAME CONFIGURATION
// ========================================

const GAME_CONFIG = {
  MAX_EFFORT_POINTS: 12,
  MAX_SELL_PER_RESOURCE: 15,
  MAX_DUMP_PER_DAY: 15,
  RAID_COST: 2, // green poison cost
  GAME_DURATION_DAYS: 10,
  PRICE_MIN: 5,
  PRICE_MAX: 50,
  DUMP_PRICE: 10,
  BASE_PRICES: {
    whiteDiamonds: 20,
    redRubies: 15,
    blueGems: 12,
    greenPoison: 10
  }
};

const RESOURCES = ['whiteDiamonds', 'redRubies', 'blueGems', 'greenPoison'];

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

// Colony needs for each day (dramatic swings but 15 average per resource)
function getColonyNeeds(day) {
  const colonyNeeds = [
    {day: 1, whiteDiamonds: 15, redRubies: 15, blueGems: 15, greenPoison: 15},
    {day: 2, whiteDiamonds: 25, redRubies: 5, blueGems: 15, greenPoison: 15},
    {day: 3, whiteDiamonds: 5, redRubies: 25, blueGems: 15, greenPoison: 15},
    {day: 4, whiteDiamonds: 15, redRubies: 15, blueGems: 25, greenPoison: 5},
    {day: 5, whiteDiamonds: 15, redRubies: 15, blueGems: 5, greenPoison: 25},
    {day: 6, whiteDiamonds: 20, redRubies: 10, blueGems: 20, greenPoison: 10},
    {day: 7, whiteDiamonds: 10, redRubies: 20, blueGems: 10, greenPoison: 20},
    {day: 8, whiteDiamonds: 8, redRubies: 22, blueGems: 8, greenPoison: 22},
    {day: 9, whiteDiamonds: 22, redRubies: 8, blueGems: 22, greenPoison: 8},
    {day: 10, whiteDiamonds: 15, redRubies: 15, blueGems: 15, greenPoison: 15}
  ];
  
  const dayIndex = ((day - 1) % 10);
  return colonyNeeds[dayIndex];
}

// ========================================
// DATABASE INITIALIZATION
// ========================================

db.serialize(() => {
  // Clean, simple schema
  
  // Players table
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    race TEXT NOT NULL,
    pin TEXT,
    credits INTEGER DEFAULT 0,
    whiteDiamonds INTEGER DEFAULT 1,
    redRubies INTEGER DEFAULT 1,
    blueGems INTEGER DEFAULT 1,
    greenPoison INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Daily decisions (what players submit each day)
  db.run(`CREATE TABLE IF NOT EXISTS daily_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    day INTEGER,
    efforts TEXT DEFAULT '{}',
    sales TEXT DEFAULT '{}',
    raid_target TEXT DEFAULT 'none',
    raid_resource TEXT DEFAULT 'none',
    dump_resource TEXT DEFAULT 'none',
    dump_amount INTEGER DEFAULT 0,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id),
    UNIQUE(player_id, day)
  )`);

  // Daily transactions (record of all financial activity)
  db.run(`CREATE TABLE IF NOT EXISTS daily_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    day INTEGER,
    action_type TEXT, -- 'sell', 'dump', 'raid_gain', 'raid_loss'
    resource TEXT,
    amount INTEGER,
    price_per_unit INTEGER,
    total_credits INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id)
  )`);

  // Daily snapshots (state at end of each day)
  db.run(`CREATE TABLE IF NOT EXISTS daily_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    day INTEGER,
    credits_start INTEGER,
    credits_end INTEGER,
    credits_earned INTEGER,
    stockpiles_start TEXT, -- JSON of resource amounts
    stockpiles_end TEXT,   -- JSON of resource amounts
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id),
    UNIQUE(player_id, day)
  )`);

  // Game state
  db.run(`CREATE TABLE IF NOT EXISTS game_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    current_day INTEGER DEFAULT 1,
    current_prices TEXT DEFAULT '{"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}',
    colony_needs TEXT DEFAULT '{"whiteDiamonds":15,"redRubies":15,"blueGems":15,"greenPoison":15}',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Simple news (mining reports only)
  db.run(`CREATE TABLE IF NOT EXISTS simple_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day INTEGER,
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Chat messages
  db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    player_name TEXT,
    day INTEGER,
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id)
  )`);

  // Initialize game state
  db.run(`INSERT OR IGNORE INTO game_state (id, current_day, current_prices, colony_needs) 
          VALUES (1, 1, '{"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}', 
                  '{"whiteDiamonds":15,"redRubies":15,"blueGems":15,"greenPoison":15}')`);

  // Create initial players
  const initialPlayers = [
    { name: 'Dave', race: 'Tribe of Endor' },
    { name: 'Silas', race: 'Tribe of Siluria' },
    { name: 'Chris', race: 'Tribe of Elantris' },
    { name: 'Brian', race: 'Tribe of Psychlos' },
    { name: 'Joel', race: 'Tribe of Leojia' },
    { name: 'Curtis', race: 'Tribe of Momma Say' }
  ];

  initialPlayers.forEach(player => {
    db.run('INSERT OR IGNORE INTO players (name, race) VALUES (?, ?)', 
      [player.name, player.race], (err) => {
      if (err) {
        console.error(`Error creating player ${player.name}:`, err.message);
      } else {
        console.log(`✅ Player ${player.name} ready for simplified game`);
      }
    });
  });
});

// ========================================
// CORE GAME LOGIC
// ========================================

function processDay(currentDay, callback) {
  console.log(`🎮 Processing day ${currentDay}...`);
  
  // Get all players and their decisions
  db.all('SELECT * FROM players ORDER BY credits ASC', [], (err, players) => {
    if (err) return callback(err);
    
    db.all('SELECT * FROM daily_decisions WHERE day = ?', [currentDay], (err, decisions) => {
      if (err) return callback(err);
      
      const decisionMap = {};
      decisions.forEach(d => {
        decisionMap[d.player_id] = {
          efforts: JSON.parse(d.efforts || '{}'),
          sales: JSON.parse(d.sales || '{}'),
          raid_target: d.raid_target,
          raid_resource: d.raid_resource,
          dump_resource: d.dump_resource,
          dump_amount: d.dump_amount || 0
        };
      });

      // Get current prices
      db.get('SELECT current_prices FROM game_state WHERE id = 1', (err, state) => {
        if (err) return callback(err);
        
        const currentPrices = JSON.parse(state.current_prices);
        const colonyNeeds = getColonyNeeds(currentDay);
        
        // Process day in correct order
        processDayLogic(currentDay, players, decisionMap, currentPrices, colonyNeeds, callback);
      });
    });
  });
}

function processDayLogic(currentDay, players, decisionMap, currentPrices, colonyNeeds, callback) {
  const playerUpdates = {};
  const transactions = [];
  const newsItems = [];
  
  // Initialize player updates
  players.forEach(player => {
    playerUpdates[player.id] = {
      credits: player.credits,
      stockpiles: {
        whiteDiamonds: player.whiteDiamonds,
        redRubies: player.redRubies,
        blueGems: player.blueGems,
        greenPoison: player.greenPoison
      }
    };
  });

  // STEP 1: Process dumps at flat $10/unit (DUMP PHASE)
  players.forEach(player => {
      const decision = decisionMap[player.id];
    if (!decision || decision.dump_resource === 'none' || decision.dump_amount <= 0) return;
    
    const dumpResource = decision.dump_resource;
    const dumpAmount = Math.min(
      decision.dump_amount,
      playerUpdates[player.id].stockpiles[dumpResource]
    );
    
    if (dumpAmount > 0) {
      const earnings = dumpAmount * GAME_CONFIG.DUMP_PRICE;
      
      playerUpdates[player.id].stockpiles[dumpResource] -= dumpAmount;
      playerUpdates[player.id].credits += earnings;
      
      transactions.push({
        player_id: player.id,
        day: currentDay,
        action_type: 'dump',
        resource: dumpResource,
        amount: dumpAmount,
        price_per_unit: GAME_CONFIG.DUMP_PRICE,
        total_credits: earnings
      });
    }
  });

  // STEP 2: Process raids (lowest credits to highest) (RAIDING PHASE)
    players.forEach(player => {
      const decision = decisionMap[player.id];
    if (!decision || decision.raid_target === 'none') return;
    
    const targetPlayer = players.find(p => p.name === decision.raid_target);
    if (!targetPlayer || targetPlayer.id === player.id) return;
    
    const raidResource = decision.raid_resource;
    if (!raidResource || raidResource === 'none') return;
    
    // Check if raid is possible
    if (playerUpdates[targetPlayer.id].stockpiles[raidResource] >= 3 && 
        playerUpdates[player.id].stockpiles.greenPoison >= 2) {
      
      // Successful raid
      playerUpdates[targetPlayer.id].stockpiles[raidResource] -= 3;
      playerUpdates[player.id].stockpiles[raidResource] += 3;
      playerUpdates[player.id].stockpiles.greenPoison -= 2;
      
      // Record raid transactions
      transactions.push({
        player_id: player.id,
        day: currentDay,
        action_type: 'raid_gain',
        resource: raidResource,
        amount: 3,
        price_per_unit: 0,
        total_credits: 0
      });
      
      transactions.push({
        player_id: targetPlayer.id,
        day: currentDay,
        action_type: 'raid_loss',
        resource: raidResource,
        amount: 3,
        price_per_unit: 0,
        total_credits: 0
      });
      
      newsItems.push(`🚀 ${player.name} raided ${targetPlayer.name} and stole 3 ${getResourceIcon(raidResource)} ${raidResource}!`);
        } else {
      newsItems.push(`❌ ${player.name}'s raid on ${targetPlayer.name} failed!`);
    }
  });

  // STEP 3: Calculate total resources being sold
  const totalSales = { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
  
  players.forEach(player => {
    const decision = decisionMap[player.id];
    if (!decision) return;
    
    RESOURCES.forEach(resource => {
      const sellAmount = Math.min(
        decision.sales[resource] || 0,
        playerUpdates[player.id].stockpiles[resource]
      );
      totalSales[resource] += sellAmount;
    });
  });

  // STEP 4: Calculate new prices based on supply vs demand (SELLING PHASE)
  const newPrices = {};
  RESOURCES.forEach(resource => {
    const sold = totalSales[resource];
    const needed = colonyNeeds[resource];
    const difference = needed - sold;
    
    // ±10% per unit over/under, max ±90%
    let priceChangePercent = Math.max(-90, Math.min(90, difference * 10));
    const basePrice = GAME_CONFIG.BASE_PRICES[resource];
    let newPrice = Math.round(basePrice * (1 + priceChangePercent / 100));
    
    // Clamp to min $5, max $50
    newPrice = Math.max(GAME_CONFIG.PRICE_MIN, Math.min(GAME_CONFIG.PRICE_MAX, newPrice));
    newPrices[resource] = newPrice;
  });

  // STEP 5: Process sales at calculated prices
  players.forEach(player => {
    const decision = decisionMap[player.id];
    if (!decision) return;
    
    RESOURCES.forEach(resource => {
      const sellAmount = Math.min(
        decision.sales[resource] || 0,
        playerUpdates[player.id].stockpiles[resource]
      );
      
      if (sellAmount > 0) {
        const price = newPrices[resource];
        const earnings = sellAmount * price;
        
        playerUpdates[player.id].stockpiles[resource] -= sellAmount;
        playerUpdates[player.id].credits += earnings;
        
        transactions.push({
          player_id: player.id,
          day: currentDay,
          action_type: 'sell',
          resource: resource,
          amount: sellAmount,
          price_per_unit: price,
          total_credits: earnings
        });
      }
    });
  });

  // STEP 6: Add mined resources to stockpiles & create mining news (MINING PHASE)
  players.forEach(player => {
    const decision = decisionMap[player.id];
    const miningReport = [];
    
    if (decision) {
      RESOURCES.forEach(resource => {
        const mined = decision.efforts[resource] || 0;
        if (mined > 0) {
          playerUpdates[player.id].stockpiles[resource] += mined;
          miningReport.push(`${mined}${getResourceIcon(resource)}`);
        }
      });
    }
    
    if (miningReport.length > 0) {
      newsItems.push(`${player.name}: ${miningReport.join(' / ')}`);
    } else {
      newsItems.push(`${player.name}: 🌙 absent`);
    }
  });

  // Save everything to database
  saveProcessedDay(currentDay, players, playerUpdates, transactions, newPrices, colonyNeeds, newsItems, callback);
}

function saveProcessedDay(currentDay, players, playerUpdates, transactions, newPrices, colonyNeeds, newsItems, callback) {
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    let completed = 0;
    let errors = [];
    const totalOperations = players.length + transactions.length + newsItems.length + 1; // +1 for game state
    
    function checkComplete() {
      completed++;
      if (completed === totalOperations) {
        if (errors.length > 0) {
          db.run('ROLLBACK');
          callback(new Error(`Processing errors: ${errors.join(', ')}`));
        } else {
          db.run('COMMIT');
          callback(null);
        }
      }
    }
    
    // Update players
    players.forEach(player => {
      const update = playerUpdates[player.id];
      const stockpiles = update.stockpiles;
      
      db.run(`UPDATE players SET credits = ?, whiteDiamonds = ?, redRubies = ?, blueGems = ?, greenPoison = ? WHERE id = ?`,
        [update.credits, stockpiles.whiteDiamonds, stockpiles.redRubies, stockpiles.blueGems, stockpiles.greenPoison, player.id],
        (err) => {
          if (err) errors.push(`Player update ${player.name}: ${err.message}`);
          checkComplete();
        }
      );
    });
    
    // Save transactions
    transactions.forEach(transaction => {
      db.run(`INSERT INTO daily_transactions (player_id, day, action_type, resource, amount, price_per_unit, total_credits) 
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [transaction.player_id, transaction.day, transaction.action_type, transaction.resource, 
         transaction.amount, transaction.price_per_unit, transaction.total_credits],
        (err) => {
          if (err) errors.push(`Transaction: ${err.message}`);
          checkComplete();
        }
      );
    });
    
    // Save news
    newsItems.forEach(news => {
      db.run('INSERT INTO simple_news (day, message) VALUES (?, ?)',
        [currentDay, news],
        (err) => {
          if (err) errors.push(`News: ${err.message}`);
          checkComplete();
        }
      );
    });
    
    // Update game state
    const nextDay = currentDay + 1;
    const nextColonyNeeds = getColonyNeeds(nextDay);
    
    db.run(`UPDATE game_state SET current_day = ?, current_prices = ?, colony_needs = ?, last_updated = CURRENT_TIMESTAMP WHERE id = 1`,
      [nextDay, JSON.stringify(newPrices), JSON.stringify(nextColonyNeeds)],
      (err) => {
        if (err) errors.push(`Game state: ${err.message}`);
        checkComplete();
      }
    );
    
    // Clear today's decisions
    db.run('DELETE FROM daily_decisions WHERE day = ?', [currentDay], (err) => {
      // This doesn't count toward completion, just cleanup
      if (err) console.error('Error clearing decisions:', err.message);
      });
    });
  }

// ========================================
// API ENDPOINTS
// ========================================

// Login
app.post('/login', (req, res) => {
  const { name, pin } = req.body;
  
  if (!name) {
    return res.json({ error: 'Please select a commander' });
  }

  db.get('SELECT * FROM players WHERE name = ?', [name], (err, row) => {
    if (err) {
      return res.json({ error: 'Database error' });
    }

    if (row) {
      if (!row.pin) {
        // First time login - set PIN
        db.run('UPDATE players SET pin = ? WHERE name = ?', [pin, name], (err) => {
          if (err) return res.json({ error: 'Failed to set PIN' });
          res.json({ playerId: row.id, race: row.race, firstTime: true });
        });
      } else if (row.pin === pin) {
        res.json({ playerId: row.id, race: row.race, firstTime: false });
      } else {
        res.json({ error: 'Incorrect PIN' });
      }
    } else {
      res.json({ error: 'Player not found' });
    }
  });
});

// Get game data
app.get('/game-data/:playerId', (req, res) => {
  const playerId = req.params.playerId;
  
  db.get('SELECT * FROM game_state WHERE id = 1', (err, gameState) => {
    if (err || !gameState) {
      return res.json({ error: 'Game state error' });
    }

    db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, player) => {
      if (err || !player) {
        return res.json({ error: 'Player not found' });
      }

      const currentDay = gameState.current_day;
      const currentPrices = JSON.parse(gameState.current_prices);
      const colonyNeeds = JSON.parse(gameState.colony_needs);
      const tomorrowNeeds = getColonyNeeds(currentDay + 1);

      res.json({
        player: {
          id: player.id,
          name: player.name,
          race: player.race,
          credits: player.credits,
          stockpiles: {
            whiteDiamonds: player.whiteDiamonds,
            redRubies: player.redRubies,
            blueGems: player.blueGems,
            greenPoison: player.greenPoison
          }
        },
        gameState: {
          currentDay: currentDay,
          prices: currentPrices,
          colonyNeeds: colonyNeeds,
          tomorrowColonyNeeds: tomorrowNeeds
        }
                  });
                });
              });
});

// Submit decisions
app.post('/submit-decisions', (req, res) => {
  const { playerId, day, efforts, sales, raidTarget, raidMaterial, dumpResource, dumpAmount } = req.body;
  
  if (!playerId || !day) {
    return res.json({ error: 'Missing required fields' });
  }
  
  // Validate effort points (max 12 total)
  const totalEffort = Object.values(efforts || {}).reduce((sum, val) => sum + (val || 0), 0);
  if (totalEffort > GAME_CONFIG.MAX_EFFORT_POINTS) {
    return res.json({ error: `Total effort cannot exceed ${GAME_CONFIG.MAX_EFFORT_POINTS} points` });
  }
  
  db.run(`INSERT OR REPLACE INTO daily_decisions 
          (player_id, day, efforts, sales, raid_target, raid_resource, dump_resource, dump_amount) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [playerId, day, JSON.stringify(efforts || {}), JSON.stringify(sales || {}),
     raidTarget || 'none', raidMaterial || 'none', dumpResource || 'none', dumpAmount || 0],
    function(err) {
                    if (err) {
        return res.json({ error: 'Failed to save decisions' });
      }
      
      console.log(`✅ Decisions submitted for player ${playerId} on day ${day}`);
      res.json({ success: true, message: 'Decisions submitted successfully!' });
    }
  );
});

// Process day
app.post('/process-day', (req, res) => {
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, state) => {
    if (err || !state) {
      return res.json({ error: 'Game state error' });
    }

    const currentDay = state.current_day;
    
    if (currentDay > GAME_CONFIG.GAME_DURATION_DAYS) {
      return res.json({ error: 'Game has ended' });
    }

    processDay(currentDay, (err) => {
    if (err) {
        console.error('Error processing day:', err);
        return res.json({ error: 'Failed to process day' });
      }

      console.log(`✅ Day ${currentDay} processed successfully!`);
      
      // Check if game ended
      if (currentDay >= GAME_CONFIG.GAME_DURATION_DAYS) {
        res.json({ success: true, message: 'Game completed!', gameEnded: true });
      } else {
        res.json({ success: true, message: `Day ${currentDay} processed!`, gameEnded: false });
      }
    });
  });
});

// Personal summary
app.get('/personal-summary/:playerId', (req, res) => {
  const playerId = parseInt(req.params.playerId);
  
  if (!playerId || isNaN(playerId)) {
    return res.status(400).json({ error: 'Invalid player ID' });
  }
  
  db.get('SELECT name FROM players WHERE id = ?', [playerId], (err, player) => {
    if (err || !player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Get all transactions for this player, ordered by day
    db.all(`SELECT day, action_type, resource, amount, price_per_unit, total_credits 
            FROM daily_transactions 
            WHERE player_id = ? 
            ORDER BY day ASC, id ASC`, [playerId], (err, transactions) => {
    if (err) {
        return res.status(500).json({ error: 'Failed to fetch transactions' });
      }
      
      // Group transactions by day
      const dailySummaries = {};
      let runningTotal = 0;
      
      transactions.forEach(tx => {
        if (!dailySummaries[tx.day]) {
          dailySummaries[tx.day] = {
            day: tx.day,
            resources: {
              whiteDiamonds: { sold: 0, price: 0, earnings: 0 },
              redRubies: { sold: 0, price: 0, earnings: 0 },
              blueGems: { sold: 0, price: 0, earnings: 0 },
              greenPoison: { sold: 0, price: 0, earnings: 0 }
            },
            dumpEarnings: 0,
            totalEarnings: 0,
            runningTotal: 0
          };
        }
        
        const daySummary = dailySummaries[tx.day];
        
        if (tx.action_type === 'sell') {
          daySummary.resources[tx.resource].sold = tx.amount;
          daySummary.resources[tx.resource].price = tx.price_per_unit;
          daySummary.resources[tx.resource].earnings = tx.total_credits;
        } else if (tx.action_type === 'dump') {
          daySummary.dumpEarnings += tx.total_credits;
        }
        
        daySummary.totalEarnings += tx.total_credits;
      });
      
      // Calculate running totals and convert to array
      const summaries = Object.values(dailySummaries).map(summary => {
        runningTotal += summary.totalEarnings;
        summary.runningTotal = runningTotal;
        return summary;
      });

          res.json({
        playerName: player.name,
        summaries: summaries,
        totalEarnings: runningTotal
      });
    });
  });
});

// Get players status
app.get('/players-status', (req, res) => {
  db.all('SELECT * FROM players ORDER BY name', [], (err, players) => {
    if (err) {
      return res.json({ error: 'Failed to get players status' });
    }

    db.get('SELECT current_day FROM game_state WHERE id = 1', [], (err, gameState) => {
      if (err || !gameState) {
        return res.json({ error: 'Failed to get game state' });
      }

      const currentDay = gameState.current_day;
      
      db.all('SELECT player_id FROM daily_decisions WHERE day = ?', [currentDay], (err, decisions) => {
        if (err) decisions = [];

        const submittedPlayerIds = decisions.map(d => d.player_id);

        const playersStatus = players.map(player => {
          const hasSubmitted = submittedPlayerIds.includes(player.id);
          const hasLoggedIn = player.pin && player.pin !== '';
          
          let status, details, statusClass;
          
          if (!hasLoggedIn) {
            status = '🔴 Not Logged In';
            details = 'Has not created PIN yet';
            statusClass = 'not-logged-in';
          } else if (hasSubmitted) {
            status = '🟢 Submitted';
            details = 'Decisions submitted';
            statusClass = 'submitted';
          } else {
            status = '🟡 Waiting';
            details = 'No decisions submitted';
            statusClass = 'waiting';
          }

          return {
            id: player.id,
            name: player.name,
            race: player.race,
            credits: player.credits,
            stockpiles: {
              whiteDiamonds: player.whiteDiamonds,
              redRubies: player.redRubies,
              blueGems: player.blueGems,
              greenPoison: player.greenPoison
            },
            status: status,
            details: details,
            hasSubmitted: hasSubmitted,
            hasLoggedIn: hasLoggedIn,
            statusClass: statusClass
          };
        });

        res.json({
          currentDay: currentDay,
          totalPlayers: players.length,
          submittedCount: decisions.length,
          players: playersStatus
        });
      });
    });
  });
});

// Get simple news
app.get('/news/:days?', (req, res) => {
  const daysToShow = parseInt(req.params.days) || 3;
  
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, state) => {
    if (err) {
      return res.json({ error: 'Database error' });
    }
    
    const currentDay = state.current_day;
    const startDay = Math.max(1, currentDay - daysToShow);
    
    db.all(`SELECT day, message FROM simple_news 
       WHERE day >= ? AND day < ?
            ORDER BY day DESC, id ASC`,
      [startDay, currentDay], (err, newsRows) => {
        if (err) {
          return res.json({ error: 'Failed to get news' });
        }
        
        // Group by day
        const newsByDay = {};
        newsRows.forEach(item => {
          if (!newsByDay[item.day]) {
            newsByDay[item.day] = [];
          }
          newsByDay[item.day].push(item.message);
        });
        
        res.json({
          newsByDay: newsByDay,
          currentDay: currentDay,
          daysShown: daysToShow
        });
      }
    );
  });
});

// Get colony stockpiles
app.get('/colony-stockpiles', (req, res) => {
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, state) => {
    if (err) {
      return res.json({ error: 'Database error' });
    }
    
    const currentDay = state.current_day;
    
    db.all('SELECT * FROM players ORDER BY name', (err, players) => {
      if (err) {
        return res.json({ error: 'Database error' });
      }
      
      const stockpiles = players.map(player => ({
        name: player.name,
        whiteDiamonds: player.whiteDiamonds,
        redRubies: player.redRubies,
        blueGems: player.blueGems,
        greenPoison: player.greenPoison,
        credits: player.credits
      }));
      
          res.json({
        currentDay: currentDay,
        colonyStockpiles: stockpiles
      });
    });
  });
});

// Get leaderboard
app.get('/leaderboard', (req, res) => {
  db.all('SELECT name, credits FROM players ORDER BY credits DESC', (err, players) => {
    if (err) {
      return res.json({ error: 'Database error' });
    }
    
    if (players.length === 0) {
      return res.json({ winning: [], losing: [] });
    }
    
    // Split into top 3 and bottom 3
    const totalPlayers = players.length;
    const topCount = Math.min(3, Math.ceil(totalPlayers / 2));
    const bottomCount = Math.min(3, totalPlayers - topCount);
    
    const winning = players.slice(0, topCount);
    const losing = players.slice(-bottomCount);
    
    // Randomize order within each group (as per requirements)
    const shuffleArray = (array) => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };
    
    res.json({
      winning: shuffleArray(winning),
      losing: shuffleArray(losing)
    });
  });
});

// Reset game
app.post('/reset-game', (req, res) => {
  console.log('🔄 Resetting simplified game...');
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Clear all data
    db.run('DELETE FROM daily_decisions');
    db.run('DELETE FROM daily_transactions');
    db.run('DELETE FROM daily_snapshots');
    db.run('DELETE FROM simple_news');
    
    // Reset players to starting state
    db.run(`UPDATE players SET 
            credits = 0, 
            whiteDiamonds = 1, 
            redRubies = 1, 
            blueGems = 1, 
            greenPoison = 1`);
    
    // Reset game state
    db.run(`UPDATE game_state SET 
      current_day = 1,
            current_prices = '{"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}',
              colony_needs = '{"whiteDiamonds":15,"redRubies":15,"blueGems":15,"greenPoison":15}',
      last_updated = CURRENT_TIMESTAMP
            WHERE id = 1`);
    
    // Add welcome news
    db.run('INSERT INTO simple_news (day, message) VALUES (?, ?)', 
      [1, '🚀 New simplified 10-day galactic conquest begins!'], (err) => {
        if (err) {
        db.run('ROLLBACK');
        return res.json({ error: 'Failed to reset game' });
      }
      
      db.run('COMMIT');
      console.log('✅ Simplified game reset complete!');
        res.json({ 
          success: true, 
        message: 'New simplified galactic conquest started!',
          resetToDay: 1
      });
    });
  });
});

// ========================================
// CHAT ENDPOINTS
// ========================================

// Get chat messages
app.get('/chat/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const day = parseInt(req.query.day) || 1;
  
  // Get messages from current day and recent days
  const dayFilter = Math.max(1, day - 2); // Show current day + 2 previous days
  
  db.all(`SELECT cm.*, 
            datetime(cm.created_at, 'localtime') as formatted_time,
            CASE 
              WHEN datetime('now', '-1 hour') < cm.created_at THEN 'just now'
              WHEN datetime('now', '-1 day') < cm.created_at THEN 
                CAST((julianday('now') - julianday(cm.created_at)) * 24 AS INTEGER) || 'h ago'
              ELSE 
                CAST((julianday('now') - julianday(cm.created_at)) AS INTEGER) || 'd ago'
            END as timeAgo
          FROM chat_messages cm 
          WHERE cm.day >= ? 
          ORDER BY cm.created_at DESC 
          LIMIT ?`, [dayFilter, limit], (err, messages) => {
    if (err) {
      console.error('Chat query error:', err);
      return res.json({ error: 'Failed to load messages' });
    }
    
    // Reverse to show oldest first
    const formattedMessages = messages.reverse().map(msg => ({
      id: msg.id,
      playerName: msg.player_name,
      message: msg.message,
      day: msg.day,
      timeAgo: msg.timeAgo,
      timestamp: msg.formatted_time
    }));
    
    res.json({ messages: formattedMessages });
  });
});

// Send chat message
app.post('/chat/send', (req, res) => {
  const { playerId, message } = req.body;
  
  if (!playerId || !message) {
    return res.json({ error: 'Missing player ID or message' });
  }
  
  if (message.length > 160) {
    return res.json({ error: 'Message too long (max 160 characters)' });
  }
  
  // Get current day and player info
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, gameState) => {
    if (err) {
      return res.json({ error: 'Failed to get game state' });
    }
    
    db.get('SELECT name FROM players WHERE id = ?', [playerId], (err, player) => {
      if (err || !player) {
        return res.json({ error: 'Player not found' });
      }
      
      // Insert message
      db.run(`INSERT INTO chat_messages (player_id, player_name, day, message) 
              VALUES (?, ?, ?, ?)`, 
              [playerId, player.name, gameState.current_day, message], (err) => {
        if (err) {
          console.error('Failed to save chat message:', err);
          return res.json({ error: 'Failed to send message' });
        }
        
        console.log(`💬 ${player.name}: ${message}`);
        res.json({ success: true, message: 'Message sent!' });
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Simplified Space Tribes server running on port ${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} to play!`);
  console.log(`⚙️ Simplified game: ${GAME_CONFIG.GAME_DURATION_DAYS} days, max ${GAME_CONFIG.MAX_EFFORT_POINTS} effort points`);
  console.log(`💰 Dump safety net: $${GAME_CONFIG.DUMP_PRICE}/unit`);
});
