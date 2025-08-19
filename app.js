const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./spacetribes.db');

app.use(bodyParser.json());
app.use(express.static('.'));

// Game Configuration Constants
const GAME_CONFIG = {
  MAX_EFFORT_POINTS: 12,
  MAX_SELL_PER_RESOURCE: 15,
  MAX_DUMP_PER_DAY: 15,
  RAID_COST: 2,
  RAID_LOOT: 2,
  DUMP_PRICE: 10,
  GAME_DURATION_DAYS: 10,
  PRICE_MIN: 5,
  PRICE_MAX: 50
};

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

// Add this function in app.js after helper functions
function generateColonyNeeds() {
  // 10-day cycle that balances to 150 total per resource over 10 days
  const colonyNeeds = [
    {day: 1, whiteDiamonds: 18, redRubies: 12, blueGems: 15, greenPoison: 15}, // 60 total
    {day: 2, whiteDiamonds: 12, redRubies: 18, blueGems: 15, greenPoison: 15}, // 60 total  
    {day: 3, whiteDiamonds: 15, redRubies: 15, blueGems: 18, greenPoison: 12}, // 60 total
    {day: 4, whiteDiamonds: 15, redRubies: 15, blueGems: 12, greenPoison: 18}, // 60 total
    {day: 5, whiteDiamonds: 16, redRubies: 14, blueGems: 16, greenPoison: 14}, // 60 total
    {day: 6, whiteDiamonds: 14, redRubies: 16, blueGems: 14, greenPoison: 16}, // 60 total
    {day: 7, whiteDiamonds: 17, redRubies: 13, blueGems: 17, greenPoison: 13}, // 60 total
    {day: 8, whiteDiamonds: 13, redRubies: 17, blueGems: 13, greenPoison: 17}, // 60 total
    {day: 9, whiteDiamonds: 15, redRubies: 15, blueGems: 15, greenPoison: 15}, // 60 total
    {day: 10, whiteDiamonds: 15, redRubies: 15, blueGems: 15, greenPoison: 15} // 60 total
  ];
  return colonyNeeds;
}

// Game Configuration - 6 players, passive income for inactive players
const GAME_PLAYERS = 6;
const PASSIVE_INCOME = {
  whiteDiamonds: 2,
  redRubies: 2, 
  blueGems: 2,
  greenPoison: 2
};

// Helper function to add categorized news
function addGeneralNews(day, message, priority = 1) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO news (day, message, category, priority) VALUES (?, ?, ?, ?)',
      [day, message, 'general', priority],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Core day processing logic
function processCoreDayLogic(currentDay, players, decisions, gameState, callback) {
  try {
    // Initialize data structures
    const playerData = {};
    const decisionMap = {};
    const news = [];
    
    // Initialize totalSupply for market calculations
    const totalSupply = { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
    
    // Parse player data and decisions
    players.forEach(player => {
      playerData[player.id] = {
        id: player.id,
        name: player.name,
        credits: player.credits || 0,
        stockpiles: JSON.parse(player.stockpiles || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'),
        protectedResources: JSON.parse(player.protected_resources || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'),
        lastEfforts: { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 },
        last_night_earnings: player.last_night_earnings || 0
      };
    });
    
    decisions.forEach(decision => {
      decisionMap[decision.playerId] = {
        efforts: JSON.parse(decision.efforts || '{}'),
        sales: JSON.parse(decision.sales || '{}'),
        raidTarget: decision.raidTarget || 'none',
        raidMaterial: decision.raidMaterial || 'none',
        blockTarget: decision.blockTarget || 'none',
        dumpResource: decision.dumpResource || 'none',
        dumpAmount: decision.dumpAmount || 0
      };
    });
    
    // STEP 1: MINING - Add mined resources to stockpiles
    players.forEach(player => {
      const pdata = playerData[player.id];
      const decision = decisionMap[player.id];
      
      if (decision && decision.efforts) {
        Object.keys(decision.efforts).forEach(resource => {
          const effort = decision.efforts[resource] || 0;
          if (effort > 0) {
            const mined = effort;
            pdata.stockpiles[resource] = (pdata.stockpiles[resource] || 0) + mined;
            pdata.lastEfforts[resource] = mined;
            totalSupply[resource] += mined;
            
            news.push(`⛏️ ${player.name} mined ${mined} ${getResourceIcon(resource)} ${resource}`);
          }
        });
      } else {
        // Player didn't submit decisions - no passive income, they get nothing
        pdata.lastEfforts = {
          whiteDiamonds: 0,
          redRubies: 0,
          blueGems: 0,
          greenPoison: 0
        };
        
        news.push(`🌙 ${player.name} was absent and mined nothing`);
      }
    });
    
    // STEP 2: SALES - Process resource sales
    const dailySalesTotals = { whiteDiamonds: 0, redRubies: 0, blueGems: 0, greenPoison: 0 };
    
    players.forEach(player => {
      const pdata = playerData[player.id];
      const decision = decisionMap[player.id];
      
      if (decision && decision.sales) {
        Object.keys(decision.sales).forEach(resource => {
          const sellAmount = Math.min(decision.sales[resource] || 0, pdata.stockpiles[resource] || 0);
          if (sellAmount > 0) {
            // Get current market price for this resource
            const currentPrice = 20; // Default price, will be updated by market calculation
            const earnings = sellAmount * currentPrice;
            
            pdata.credits += earnings;
            pdata.stockpiles[resource] -= sellAmount;
            pdata.last_night_earnings += earnings;
            dailySalesTotals[resource] += sellAmount;
            
            news.push(`💰 ${player.name} sold ${sellAmount} ${getResourceIcon(resource)} for $${earnings}`);
          }
        });
      }
    });
    
    // STEP 2.5: DUMP PROCESSING - Process emergency dumps
    players.forEach(player => {
      const pdata = playerData[player.id];
      const decision = decisionMap[player.id];
      
      if (decision && decision.dumpResource && decision.dumpResource !== 'none' && decision.dumpAmount > 0) {
        const dumpResource = decision.dumpResource;
        const dumpAmount = Math.min(decision.dumpAmount, pdata.stockpiles[dumpResource] || 0);
        
        if (dumpAmount > 0) {
          // Emergency dump at guaranteed $10/unit
          const dumpEarnings = dumpAmount * 10;
          
          pdata.credits += dumpEarnings;
          pdata.stockpiles[dumpResource] -= dumpAmount;
          pdata.last_night_earnings += dumpEarnings;
          
          news.push(`🚨 ${player.name} emergency dumped ${dumpAmount} ${getResourceIcon(dumpResource)} for $${dumpEarnings}`);
        }
      }
    });
    
    // STEP 4: COMBAT PHASE - Resolve raids and blocks
    console.log('⚔️ Combat phase - resolving raids and blocks...');
    
    // Debug: Log all decisions for combat
    console.log('🔍 Combat Debug - All decisions:', decisionMap);
    console.log('🔍 Combat Debug - All players:', players.map(p => ({ id: p.id, name: p.name })));
    
    players.forEach(player => {
      const pdata = playerData[player.id];
      const decision = decisionMap[player.id];
      
      console.log(`🔍 Combat Debug - Player ${player.name}:`, {
        hasDecision: !!decision,
        raidTarget: decision?.raidTarget,
        raidMaterial: decision?.raidMaterial,
        blockTarget: decision?.blockTarget
      });
      
      if (decision && decision.raidTarget && decision.raidTarget !== 'none') {
        console.log(`🔍 Combat Debug - ${player.name} attempting raid on ${decision.raidTarget}`);
        
        // Find target player
        const targetPlayer = players.find(p => p.name === decision.raidTarget);
        if (targetPlayer && targetPlayer.id !== player.id) {
          const targetData = playerData[targetPlayer.id];
          
          console.log(`🔍 Combat Debug - Target ${targetPlayer.name} data:`, {
            stockpiles: targetData.stockpiles,
            blockTarget: targetData.blockTarget
          });
          
          // Check if raid is blocked
          const isBlocked = targetData.blockTarget === player.name;
          console.log(`🔍 Combat Debug - Raid blocked? ${isBlocked} (${targetData.blockTarget} === ${player.name})`);
          
          if (isBlocked) {
            // Raid blocked
            news.push(`🛡️ ${player.name}'s raid on ${targetPlayer.name} was blocked!`);
            console.log(`🛡️ ${player.name}'s raid on ${targetPlayer.name} was blocked by ${targetPlayer.name}`);
          } else {
            // Raid successful - steal 2 units of specified resource
            const raidResource = decision.raidMaterial;
            if (raidResource && raidResource !== 'none' && targetData.stockpiles[raidResource] >= 2) {
              // Transfer resources
              targetData.stockpiles[raidResource] -= 2;
              pdata.stockpiles[raidResource] += 2;
              
              // Add to protected resources (can't be raided until next day)
              pdata.protectedResources = pdata.protectedResources || {};
              pdata.protectedResources[raidResource] = (pdata.protectedResources[raidResource] || 0) + 2;
              
              // Deduct raid cost (2 green poison)
              if (pdata.stockpiles.greenPoison >= 2) {
                pdata.stockpiles.greenPoison -= 2;
                news.push(`🚀 ${player.name} successfully raided ${targetPlayer.name} and stole 2 ${getResourceIcon(raidResource)} ${raidResource}!`);
                console.log(`🚀 ${player.name} raided ${targetPlayer.name}: stole 2 ${raidResource}, cost 2🌱`);
              } else {
                // Not enough green poison for raid
                news.push(`❌ ${player.name} attempted to raid ${targetPlayer.name} but didn't have enough green poison!`);
                console.log(`❌ ${player.name} raid failed: insufficient green poison`);
              }
            } else {
              news.push(`❌ ${player.name}'s raid on ${targetPlayer.name} failed - target resource not available!`);
              console.log(`❌ ${player.name} raid failed: target resource ${raidResource} not available`);
            }
          }
        } else {
          console.log(`🔍 Combat Debug - Invalid target for ${player.name}:`, decision.raidTarget);
        }
      }
    });
    
    // STEP 5: MARKET PRICE CALCULATION
    const currentPrices = { whiteDiamonds: 20, redRubies: 15, blueGems: 12, greenPoison: 10 };
    const currentColonyNeeds = getCurrentColonyNeeds(currentDay);
    const newPrices = calculateSellingBasedPrices(dailySalesTotals, currentColonyNeeds, currentPrices);
    const tomorrowColonyNeeds = getCurrentColonyNeeds(currentDay + 1);
    
    // STEP 6: UPDATE PRICE HISTORY
    // Get existing price history and append new day
    const existingPriceHistory = JSON.parse(gameState.price_history || '[]');
    const priceHistory = [...existingPriceHistory, { day: currentDay, ...newPrices }];
    
    const existingColonyNeedsHistory = JSON.parse(gameState.colony_needs_history || '[]');
    const colonyNeedsHistory = [...existingColonyNeedsHistory, { day: currentDay, ...currentColonyNeeds }];
    
    // Return results
    callback(null, {
      playerData, // Include the updated player data
      newPrices,
      tomorrowColonyNeeds,
      totalSupply,
      dailySalesTotals,
      priceHistory,
      colonyNeedsHistory,
      news
    });
    
  } catch (error) {
    callback(error);
  }
}

// Save news to database
function saveNewsToDatabase(newsArray, currentDay, callback) {
  if (!newsArray || newsArray.length === 0) {
    return callback(null); // No news to save
  }
  
  let completed = 0;
  let hasError = false;
  
  newsArray.forEach(newsItem => {
    // Determine category and priority based on news content
    let category = 'general';
    let priority = 1;
    
    if (newsItem.includes('⚔️') || newsItem.includes('raided') || newsItem.includes('stole')) {
      category = 'raid';
      priority = 3;
    } else if (newsItem.includes('🛡️') || newsItem.includes('blocked')) {
      category = 'block';
      priority = 3;
    } else if (newsItem.includes('💰') || newsItem.includes('sold')) {
      category = 'market';
      priority = 2;
    } else if (newsItem.includes('⛏️') || newsItem.includes('mined')) {
      category = 'mining';
      priority = 1;
    }
    
    db.run(
      'INSERT INTO news (day, message, category, priority) VALUES (?, ?, ?, ?)',
      [currentDay, newsItem, category, priority],
      function(err) {
        if (err) {
          console.error('Error saving news item:', {
            error: err.message,
            newsItem,
            currentDay,
            timestamp: new Date().toISOString()
          });
          hasError = true;
        } else {
          console.log(`📰 Saved news: ${newsItem}`);
        }
        
        completed++;
        if (completed === newsArray.length) {
          callback(hasError ? new Error('Some news items failed to save') : null);
        }
      }
    );
  });
}

// Update player data in database after day processing
function updatePlayerDataAfterDayProcessing(players, result, currentDay, callback) {
  const { playerData, totalSupply, dailySalesTotals, news } = result;
  
  if (!playerData) {
    console.error('No player data returned from day processing');
    return callback(new Error('No player data available'));
  }
  
  // Process each player's data
  let completed = 0;
  let hasError = false;
  
  players.forEach(player => {
    const updatedPlayer = playerData[player.id];
    if (!updatedPlayer) {
      console.error(`No updated data for player ${player.name}`);
      hasError = true;
      completed++;
      if (completed === players.length) {
        callback(hasError ? new Error('Some player updates failed') : null);
      }
      return;
    }
    
    // Update player record in database with new values
    db.run(
      `UPDATE players SET 
       stockpiles = ?,
       credits = ?,
       lastEfforts = ?,
       protected_resources = ?,
       last_night_earnings = ?,
       last_updated = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [
        JSON.stringify(updatedPlayer.stockpiles),
        updatedPlayer.credits,
        JSON.stringify(updatedPlayer.lastEfforts),
        JSON.stringify(updatedPlayer.protectedResources || {}),
        updatedPlayer.last_night_earnings || 0,
        player.id
      ],
      function(err) {
        if (err) {
          console.error(`Error updating player ${player.name}:`, err.message);
          hasError = true;
        } else {
          console.log(`✅ Updated player ${player.name}: ${JSON.stringify(updatedPlayer.stockpiles)} stockpiles, $${updatedPlayer.credits} credits`);
        }
        
        completed++;
        if (completed === players.length) {
          if (hasError) {
            callback(new Error('Some player updates failed'));
          } else {
            callback(null);
          }
        }
      }
    );
  });
}

// Add this function to get current day's needs
function getCurrentColonyNeeds(currentDay) {
  const needs = generateColonyNeeds();
  const dayIndex = ((currentDay - 1) % 10);
  return needs[dayIndex];
}

// Advanced market price calculation based on supply vs. demand ratios
function calculateSellingBasedPrices(dailySalesTotals, colonyNeeds, currentPrices) {
  // Market prices are adjusted daily based on supply (total player sales) vs. demand (colony needs).
  // This implements the sophisticated pricing algorithm from the game design guide.
  const newPrices = {};
  const resources = ['whiteDiamonds', 'redRubies', 'blueGems', 'greenPoison'];
  
  resources.forEach(resource => {
    const totalSold = dailySalesTotals[resource] || 0;
    const colonyDemand = colonyNeeds[resource] || 15;
    
    // Calculate supply/demand ratio
    const supplyDemandRatio = totalSold / colonyDemand;
    
    // Apply price multiplier based on supply/demand ratio
    let priceMultiplier = 1.0; // Stable prices (80-119%)
    
    if (supplyDemandRatio >= 1.5) {
      // 150%+ supply = 40% price drop
      priceMultiplier = 0.6;
    } else if (supplyDemandRatio >= 1.2) {
      // 120-149% = 20% price drop
      priceMultiplier = 0.8;
    } else if (supplyDemandRatio < 0.5) {
      // <50% = 60% price spike
      priceMultiplier = 1.6;
    } else if (supplyDemandRatio < 0.8) {
      // 50-79% = 30% price increase
      priceMultiplier = 1.3;
    }
    
    // Calculate new price with multiplier
    const basePrice = currentPrices[resource] || 20;
    let newPrice = Math.round(basePrice * priceMultiplier);
    
    // Clamp prices between $5-$50 as per game design
    newPrice = Math.max(5, Math.min(50, newPrice));
    
    newPrices[resource] = newPrice;
    
    // Log price changes for transparency
    console.log(`💰 ${resource}: ${totalSold} sold vs ${colonyDemand} demand (${(supplyDemandRatio * 100).toFixed(0)}%) - Price: $${basePrice} → $${newPrice} (${priceMultiplier > 1 ? '+' : ''}${((priceMultiplier - 1) * 100).toFixed(0)}%)`);
  });
  
  return newPrices;
}


// ========================================
// GROUP 3: GAME STRUCTURE IMPLEMENTATION
// ========================================

// 1. Check if game has ended (10 days completed)
function checkGameEnd(currentDay) {
  return currentDay > GAME_CONFIG.GAME_DURATION_DAYS;
}

// 2. Determine winner based on credits
function determineWinner(players) {
  if (!players || players.length === 0) return null;
  
  // Sort players by credits (descending) and return winner
  const sortedPlayers = players.sort((a, b) => b.credits - a.credits);
  const winner = sortedPlayers[0];
  
  return {
    winner: winner,
    leaderboard: sortedPlayers,
    winningCredits: winner.credits
  };
}

// 3. Check if all active players have submitted decisions
function checkAllPlayersSubmitted(decisions, activePlayers) {
  // Get list of all commanders (always these 6)
  const allCommanders = ['Dave', 'Silas', 'Chris', 'Brian', 'Joel', 'Curtis'];
  
  // Count how many of the active players have submitted
  const activePlayerIds = activePlayers.map(p => p.id);
  const submittedPlayerIds = decisions.map(d => d.playerId);
  
  // Check if all active players have submitted
  const allActiveSubmitted = activePlayerIds.every(id => submittedPlayerIds.includes(id));
  
  return {
    allSubmitted: allActiveSubmitted,
    submittedCount: submittedPlayerIds.length,
    activeCount: activePlayerIds.length,
    totalCommanders: allCommanders.length
  };
}

// Initialize database tables
db.serialize(() => {
  // Run the schema creation only if tables don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      race TEXT NOT NULL,
      pin TEXT,
      credits INTEGER DEFAULT 0,
      stockpiles TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      protected_resources TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      lastEfforts TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      last_night_earnings INTEGER DEFAULT 0,
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
      blockTarget TEXT,
      dumpResource TEXT DEFAULT 'none',
      dumpAmount INTEGER DEFAULT 0,
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
      daily_sales_totals TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      price_history TEXT DEFAULT '[{"day":1,"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}]',
      colony_needs_history TEXT DEFAULT '[{"day":1,"whiteDiamonds":15,"redRubies":15,"blueGems":15,"greenPoison":15}]',
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
      blocked BOOLEAN DEFAULT FALSE,
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
  db.run(`INSERT OR IGNORE INTO game_state (
    id, 
    current_day, 
    market_prices, 
    colony_needs, 
    last_supply, 
    daily_sales_totals, 
    price_history, 
    colony_needs_history, 
    active_players
  ) VALUES (
    1, 
    1, 
    '{"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}',
    '{"whiteDiamonds":18,"redRubies":12,"blueGems":15,"greenPoison":15}',
    '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
    '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
    '[{"day":1,"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}]',
    '[{"day":1,"whiteDiamonds":18,"redRubies":12,"blueGems":15,"greenPoison":15}]',
    0
  )`);

  db.run(`ALTER TABLE players ADD COLUMN protected_resources TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding protected_resources column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  db.run(`UPDATE players SET protected_resources = '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}' WHERE protected_resources IS NULL OR protected_resources = ''`);

  db.run(`ALTER TABLE players ADD COLUMN last_night_earnings INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding last_night_earnings column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  db.run(`ALTER TABLE players ADD COLUMN last_updated TIMESTAMP`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding last_updated column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Add dump columns to decisions table
  db.run(`ALTER TABLE decisions ADD COLUMN dumpResource TEXT DEFAULT 'none'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding dumpResource column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  db.run(`ALTER TABLE decisions ADD COLUMN dumpAmount INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding dumpAmount column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Add dump tracking to players table
  db.run(`ALTER TABLE players ADD COLUMN daily_dump_used TEXT DEFAULT 'none'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding daily_dump_used column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Add dump flag to sales tracking
  db.run(`ALTER TABLE player_sales ADD COLUMN is_dump BOOLEAN DEFAULT FALSE`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding is_dump column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Add news categorization (FIXED: Removed duplicate)
  db.run(`ALTER TABLE news ADD COLUMN category TEXT DEFAULT 'general'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding category column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  db.run(`ALTER TABLE news ADD COLUMN priority INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding priority column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  db.run(`ALTER TABLE decisions ADD COLUMN blockTarget TEXT DEFAULT 'none'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding blockTarget column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Add raid_impact column to players table
  db.run(`ALTER TABLE players ADD COLUMN raid_impact TEXT DEFAULT '{"gained":{},"lost":{}}'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding raid_impact column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  db.run(`ALTER TABLE game_state ADD COLUMN colony_needs_history TEXT DEFAULT '[]'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding colony_needs_history column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  db.run(`ALTER TABLE game_state ADD COLUMN price_history TEXT DEFAULT '[]'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding price_history column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  db.run(`ALTER TABLE game_state ADD COLUMN daily_sales_totals TEXT DEFAULT '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Database error adding daily_sales_totals column:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Function to create initial 6 players for the game (without PINs - they'll be set on first login)
  function createInitialPlayers() {
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
          console.log(`✅ Player ${player.name} ready for game`);
        }
      });
    });
  }

  // Update game_state initialization
  db.run(`
    UPDATE game_state SET 
      colony_needs_history = '[{"day":1,"whiteDiamonds":15,"redRubies":15,"blueGems":15,"greenPoison":15}]',
      price_history = '[{"day":1,"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}]',
      daily_sales_totals = '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'
    WHERE id = 1
  `);

  // Create initial 6 players if they don't exist
  createInitialPlayers();
});

// Login endpoint - fixed to accept name instead of race
app.post('/login', (req, res) => {
  const { name, pin } = req.body;
  
  if (!name) {
    return res.json({ error: 'Please select a commander' });
  }

  db.get('SELECT * FROM players WHERE name = ?', [name], (err, row) => {
    if (err) {
      console.error('Database error in /login:', {
        error: err.message,
        name,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Database error' });
    }

    if (row) {
      // Player exists
      if (!row.pin) {
        // First time login - set PIN
        db.run('UPDATE players SET pin = ? WHERE name = ?', [pin, name], (err) => {
          if (err) {
            console.error('Error setting PIN for player:', err.message);
            return res.json({ error: 'Failed to set PIN' });
          }
          res.json({ playerId: row.id, race: row.race, firstTime: true });
        });
      } else if (row.pin === pin) {
        // Returning player - PIN matches
        res.json({ playerId: row.id, race: row.race, firstTime: false });
      } else {
        // Returning player - incorrect PIN
        res.json({ error: 'Incorrect PIN' });
      }
    } else {
      // Player doesn't exist - create new player
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
            console.error('Database insert error in /login:', {
              error: err.message,
              name,
              race,
              timestamp: new Date().toISOString()
            });
            return res.json({ error: 'Registration failed' });
          }
          res.json({ playerId: this.lastID, race: race, firstTime: true });
        }
      );
    }
  });
});

// Process day endpoint - handles day advancement and game logic
app.post('/process-day', (req, res) => {
  db.get('SELECT * FROM game_state WHERE id = 1', (err, state) => {
    if (err || !state) {
      console.error('Game state error in /process-day:', {
        error: err?.message || 'No game state found',
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Game state error' });
    }

    const currentDay = state.current_day;
    
    // Get all players and their decisions for this day
    db.all('SELECT * FROM players', [], (err, players) => {
      if (err) {
        console.error('Players query error in /process-day:', {
          error: err.message,
          currentDay,
          timestamp: new Date().toISOString()
        });
        return res.json({ error: 'Failed to get players' });
      }

      db.all('SELECT * FROM decisions WHERE day = ?', [currentDay], (err, decisions) => {
        if (err) {
          console.error('Decisions query error in /process-day:', {
            error: err.message,
            currentDay,
            timestamp: new Date().toISOString()
          });
          return res.json({ error: 'Failed to get decisions' });
        }

        // All players are human players - no AI decisions needed
        console.log(`🎮 Processing day ${currentDay} for ${players.length} human players`);

        // Process the day using core logic
        processCoreDayLogic(currentDay, players, decisions, state, (err, result) => {
          if (err) {
            console.error('Error in core day processing:', {
              error: err.message,
              currentDay,
              timestamp: new Date().toISOString()
            });
            return res.json({ error: 'Failed to process day: ' + err.message });
          }

          const { newPrices, tomorrowColonyNeeds, totalSupply, dailySalesTotals, priceHistory, colonyNeedsHistory, news: processedNews } = result;

          // Update game state
          const newDay = currentDay + 1;
          
          // Check if game has ended
          if (newDay > GAME_CONFIG.GAME_DURATION_DAYS) {
            console.log('🏆 Game completed! Determining winner...');
            
            // Get final standings
            db.all('SELECT * FROM players ORDER BY credits DESC', [], (err, finalPlayers) => {
              if (err) {
                console.error('Error getting final players in /process-day:', {
                  error: err.message,
                  newDay,
                  timestamp: new Date().toISOString()
                });
                return res.json({ error: 'Failed to get final standings' });
              }
              
              const winner = finalPlayers[0];
              const finalStandings = finalPlayers;
              
              // Add final news
              const finalNews = [
                `🏆 GALACTIC CONQUEST COMPLETE! Winner: ${winner.name} with ${winner.credits}!`,
                `🥈 Second Place: ${finalStandings[1]?.name || 'None'} with ${finalStandings[1]?.credits || 0}`,
                `🥉 Third Place: ${finalStandings[2]?.name || 'None'} with ${finalStandings[2]?.credits || 0}`,
                `📊 Final standings determined after ${GAME_CONFIG.GAME_DURATION_DAYS} days of space conquest!`,
                `🌌 The galaxy recognizes ${winner.name} as the supreme space commander!`
              ];
              
              const finalNewsPromises = finalNews.map(newsItem => {
                return new Promise((resolve, reject) => {
                  db.run('INSERT INTO news (day, message, category, priority) VALUES (?, ?, ?, ?)', 
                    [currentDay, newsItem, 'general', 3], (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                });
              });
              
              Promise.all(finalNewsPromises).then(() => {
                // Update game state to mark as ended
                db.run(
                  `UPDATE game_state SET 
                   current_day = ?, 
                   market_prices = ?, 
                   colony_needs = ?,
                   last_supply = ?,
                   daily_sales_totals = ?,
                   price_history = ?,
                   colony_needs_history = ?,
                   last_updated = CURRENT_TIMESTAMP 
                   WHERE id = 1`,
                  [
                    newDay,
                    JSON.stringify(newPrices), 
                    JSON.stringify(tomorrowColonyNeeds),
                    JSON.stringify(totalSupply),
                    JSON.stringify(dailySalesTotals),
                    JSON.stringify(priceHistory),
                    JSON.stringify(colonyNeedsHistory)
                  ],
                  (err) => {
                    if (err) {
                      console.error('Error updating final game state in /process-day:', {
                        error: err.message,
                        newDay,
                        timestamp: new Date().toISOString()
                      });
                      return res.json({ error: 'Failed to update final game state' });
                    }
                    
                    // Clear decisions
                    db.run('DELETE FROM decisions WHERE day = ?', [currentDay], (err) => {
                      if (err) {
                        console.error('Error clearing decisions in /process-day:', {
                          error: err.message,
                          currentDay,
                          timestamp: new Date().toISOString()
                        });
                      }
                      
                      res.json({ 
                        success: true, 
                        message: '🏆 Game Complete! Check final standings!',
                        gameEnded: true,
                        winner: winner,
                        finalStandings: finalStandings,
                        newDay: newDay
                      });
                    });
                  }
                );
              }).catch(err => {
                console.error('Error saving final news in /process-day:', {
                  error: err.message,
                  currentDay,
                  timestamp: new Date().toISOString()
                });
                res.json({ error: 'Failed to save final results' });
              });
            });
          } else {
            // Game continues normally
            db.run(
              `UPDATE game_state SET 
               current_day = ?, 
               market_prices = ?, 
               colony_needs = ?,
               last_supply = ?,
               daily_sales_totals = ?,
               price_history = ?,
               colony_needs_history = ?,
               last_updated = CURRENT_TIMESTAMP 
               WHERE id = 1`,
              [
                newDay,
                JSON.stringify(newPrices), 
                JSON.stringify(tomorrowColonyNeeds),
                JSON.stringify(totalSupply),
                JSON.stringify(dailySalesTotals),
                JSON.stringify(priceHistory),
                JSON.stringify(colonyNeedsHistory)
              ],
              (err) => {
                if (err) {
                  console.error('Error updating game state in /process-day:', {
                    error: err.message,
                    newDay,
                    timestamp: new Date().toISOString()
                  });
                  return res.json({ error: 'Failed to update game state' });
                }
                
                // Update all player data (stockpiles, credits, etc.)
                updatePlayerDataAfterDayProcessing(players, result, currentDay, (err) => {
                  if (err) {
                    console.error('Error updating player data in /process-day:', {
                      error: err.message,
                      currentDay,
                      timestamp: new Date().toISOString()
                    });
                    return res.json({ error: 'Failed to update player data' });
                  }
                  
                  // Save news to database
                  saveNewsToDatabase(result.news, currentDay, (err) => {
                    if (err) {
                      console.error('Error saving news in /process-day:', {
                        error: err.message,
                        currentDay,
                        timestamp: new Date().toISOString()
                      });
                      // Continue processing even if news saving fails
                    }
                    
                    // Clear today's decisions
                    db.run('DELETE FROM decisions WHERE day = ?', [currentDay], (err) => {
                      if (err) {
                        console.error('Error clearing decisions in /process-day:', {
                          error: err.message,
                          currentDay,
                          timestamp: new Date().toISOString()
                        });
                      }
                      
                      console.log('✅ Day processed successfully!');
                      res.json({ 
                        success: true, 
                        message: 'Day processed successfully!',
                        gameEnded: false,
                        newDay: newDay
                      });
                    });
                  });
                });
              }
            );
          }
        });
      });
    });
  });
});

// Clear decisions for a specific day (admin function)
app.post('/clear-decisions/:day', (req, res) => {
  const day = parseInt(req.params.day);
  
  if (!day || day < 1) {
    return res.json({ error: 'Invalid day parameter' });
  }
  
  db.run('DELETE FROM decisions WHERE day = ?', [day], function(err) {
    if (err) {
      console.error('Database error clearing decisions:', {
        error: err.message,
        day,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Database error' });
    }
    
    console.log(`🗑️ Cleared ${this.changes} decisions for day ${day}`);
    res.json({ 
      success: true, 
      message: `Cleared ${this.changes} decisions for day ${day}`,
      changes: this.changes
    });
  });
});

// Force clear ALL decisions for a specific day (nuclear option)
app.post('/force-clear-decisions/:day', (req, res) => {
  const day = parseInt(req.params.day);
  
  if (!day || day < 1) {
    return res.json({ error: 'Invalid day parameter' });
  }
  
  // First, let's see what we're clearing
  db.all('SELECT * FROM decisions WHERE day = ?', [day], (err, existingDecisions) => {
    if (err) {
      console.error('Database error checking existing decisions:', {
        error: err.message,
        day,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Database error checking decisions' });
    }
    
    console.log(`🔍 Found ${existingDecisions.length} decisions for day ${day}:`, existingDecisions);
    
    // Now clear them all
    db.run('DELETE FROM decisions WHERE day = ?', [day], function(err) {
      if (err) {
        console.error('Database error force clearing decisions:', {
          error: err.message,
          day,
          timestamp: new Date().toISOString()
        });
        return res.json({ error: 'Database error clearing decisions' });
      }
      
      console.log(`💥 Force cleared ${this.changes} decisions for day ${day}`);
      res.json({ 
        success: true, 
        message: `Force cleared ${this.changes} decisions for day ${day}`,
        changes: this.changes,
        clearedDecisions: existingDecisions
      });
    });
  });
});

// Submit decisions endpoint
app.post('/submit-decisions', (req, res) => {
  const { playerId, day, efforts, sales, raidTarget, raidMaterial, blockTarget, dumpResource, dumpAmount } = req.body;
  
  if (!playerId || !day) {
    return res.json({ error: 'Missing required fields' });
  }
  
  // Validate effort points (max 12 total)
  const totalEffort = Object.values(efforts || {}).reduce((sum, val) => sum + (val || 0), 0);
  if (totalEffort > GAME_CONFIG.MAX_EFFORT_POINTS) {
    return res.json({ error: `Total effort cannot exceed ${GAME_CONFIG.MAX_EFFORT_POINTS} points` });
  }
  
  // Check if player already submitted for this day
  db.get('SELECT id FROM decisions WHERE playerId = ? AND day = ?', [playerId, day], (err, existing) => {
    if (err) {
      console.error('Database error checking existing decisions:', {
        error: err.message,
        playerId,
        day,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Database error' });
    }
    
    if (existing) {
      return res.json({ error: 'You have already submitted decisions for this day' });
    }
    
    // Insert new decision
    db.run(
      'INSERT INTO decisions (playerId, day, efforts, sales, raidTarget, raidMaterial, blockTarget, dumpResource, dumpAmount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        playerId,
        day,
        JSON.stringify(efforts || {}),
        JSON.stringify(sales || {}),
        raidTarget || 'none',
        raidMaterial || 'none',
        blockTarget || 'none',
        dumpResource || 'none',
        dumpAmount || 0
      ],
      function(err) {
        if (err) {
          console.error('Database error inserting decision:', {
            error: err.message,
            playerId,
            day,
            timestamp: new Date().toISOString()
          });
          return res.json({ error: 'Failed to save decisions' });
        }
        
        console.log(`✅ Decisions submitted for player ${playerId} on day ${day}`);
        res.json({ 
          success: true, 
          message: 'Decisions submitted successfully!',
          decisionId: this.lastID
        });
      }
    );
  });
});

// Get game data with proper calculations
app.get('/game-data/:playerId', (req, res) => {
  const playerId = req.params.playerId;
  
  // Get game state first
  db.get('SELECT * FROM game_state WHERE id = 1', (err, gameState) => {
    if (err || !gameState) {
      console.error('Game state error in /game-data:', {
        error: err?.message || 'No game state found',
        playerId,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Game state error' });
    }

    const currentDay = gameState.current_day;
    const prices = JSON.parse(gameState.market_prices);
    
    // Get current colony needs for this day
    const currentColonyNeeds = getCurrentColonyNeeds(currentDay);

    // Get tomorrow's colony needs for mining decisions
    const tomorrowColonyNeeds = getCurrentColonyNeeds(currentDay + 1);
    
    // Get price history
    const priceHistory = JSON.parse(gameState.price_history || '[]');
    const lastDayPrices = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1] : prices;
    
    // Get daily sales totals from yesterday
    const dailySalesTotals = JSON.parse(gameState.daily_sales_totals || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}');

    // Get player data
    db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, player) => {
      if (err || !player) {
        console.error('Player query error in /game-data:', {
          error: err?.message || 'Player not found',
          playerId,
          timestamp: new Date().toISOString()
        });
        return res.json({ error: 'Player not found' });
      }

      // Get last night's sales data
      db.all(
        'SELECT * FROM player_sales WHERE playerId = ? AND day = ?',
        [playerId, Math.max(1, currentDay - 1)],
        (err, lastNightSales) => {
          if (err) {
            console.error('Sales query error in /game-data:', {
              error: err.message,
              playerId,
              day: Math.max(1, currentDay - 1),
              timestamp: new Date().toISOString()
            });
            lastNightSales = [];
          }

          // Calculate total earned from last night's sales
          const totalEarned = lastNightSales.reduce((sum, sale) => sum + (sale.total_earned || 0), 0);

          res.json({
            player: {
              id: player.id,
              name: player.name,
              race: player.race,
              credits: player.credits,
              stockpiles: JSON.parse(player.stockpiles),
              protectedResources: JSON.parse(player.protected_resources || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'),
              lastEfforts: JSON.parse(player.lastEfforts || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}'),
              lastNightEarnings: player.last_night_earnings || 0
            },
            gameState: {
              currentDay: currentDay,
              prices: prices,
              colonyNeeds: currentColonyNeeds,
              tomorrowColonyNeeds: tomorrowColonyNeeds,
              priceHistory: priceHistory,
              lastDayPrices: lastDayPrices,
              dailySalesTotals: dailySalesTotals
            },
            lastNightSales: lastNightSales,
            totalEarned: totalEarned
          });
        }
      );
    });
  });
});

// Get all players status for real-time dashboard
app.get('/players-status', (req, res) => {
  db.all('SELECT * FROM players ORDER BY name', [], (err, players) => {
    if (err) {
      console.error('Players status query error:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Failed to get players status' });
    }

    // Get current day
    db.get('SELECT current_day FROM game_state WHERE id = 1', [], (err, gameState) => {
      if (err || !gameState) {
        return res.json({ error: 'Failed to get game state' });
      }

      const currentDay = gameState.current_day;
      
      // Get decisions for current day
      db.all('SELECT * FROM decisions WHERE day = ?', [currentDay], (err, decisions) => {
        if (err) {
          decisions = [];
        }

        const decisionMap = {};
        decisions.forEach(d => {
          decisionMap[d.playerId] = d;
        });

        // Build status for each player
        const playersStatus = players.map(player => {
          const hasSubmitted = decisionMap[player.id] ? true : false;
          const decision = decisionMap[player.id];
          
          let status = '🟡 Waiting';
          let details = 'No decisions submitted';
          
          if (hasSubmitted) {
            status = '✅ Active';
            const efforts = decision.efforts ? JSON.parse(decision.efforts) : {};
            const sales = decision.sales ? JSON.parse(decision.sales) : {};
            
            const totalEffort = Object.values(efforts).reduce((sum, val) => sum + (val || 0), 0);
            const totalSales = Object.values(sales).reduce((sum, val) => sum + (val || 0), 0);
            
            details = `${totalEffort} robots, ${totalSales} sales`;
            
            if (decision.raidTarget && decision.raidTarget !== 'none') {
              details += `, 🚀 raiding ${decision.raidTarget}`;
            }
            if (decision.blockTarget && decision.blockTarget !== 'none') {
              details += `, 🛡️ blocking ${decision.blockTarget}`;
            }
          }

          return {
            id: player.id,
            name: player.name,
            race: player.race,
            credits: player.credits,
            stockpiles: JSON.parse(player.stockpiles),
            status: status,
            details: details,
            hasSubmitted: hasSubmitted,
            lastActive: player.last_active || 'Never'
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

// Get colony stockpiles for public viewing (shows all players' holdings with color coding)
app.get('/colony-stockpiles', (req, res) => {
  db.all('SELECT * FROM players ORDER BY name', [], (err, players) => {
    if (err) {
      console.error('Colony stockpiles query error:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Failed to get colony stockpiles' });
    }

    // Get current day
    db.get('SELECT current_day FROM game_state WHERE id = 1', [], (err, gameState) => {
      if (err || !gameState) {
        return res.json({ error: 'Failed to get game state' });
      }

      const currentDay = gameState.current_day;
      
      // Get decisions for current day to determine resource sources
      db.all('SELECT * FROM decisions WHERE day = ?', [currentDay], (err, decisions) => {
        if (err) {
          decisions = [];
        }

        const decisionMap = {};
        decisions.forEach(d => {
          decisionMap[d.playerId] = d;
        });

        // Build colony stockpiles data
        const colonyStockpiles = players.map(player => {
          const decision = decisionMap[player.id];
          const stockpiles = JSON.parse(player.stockpiles);
          const lastEfforts = JSON.parse(player.lastEfforts || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}');
          const protectedResources = JSON.parse(player.protected_resources || '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}');
          
          // Create stockpile display with color coding
          const stockpileDisplay = {};
          const resources = ['whiteDiamonds', 'redRubies', 'blueGems', 'greenPoison'];
          
          resources.forEach(resource => {
            const amount = stockpiles[resource] || 0;
            const mined = lastEfforts[resource] || 0;
            const protected = protectedResources[resource] || 0;
            
            if (amount === 0) {
              stockpileDisplay[resource] = { amount: 0, source: 'none' };
            } else {
              // Always show total amount, mined amount (if any), and raided amount (if any)
              stockpileDisplay[resource] = { 
                amount: amount, 
                mined: mined,
                raided: protected,
                source: 'mixed'
              };
            }
          });

          return {
            id: player.id,
            name: player.name,
            race: player.race,
            stockpiles: stockpileDisplay,
            totalResources: Object.values(stockpiles).reduce((sum, val) => sum + val, 0)
          };
        });

        res.json({
          currentDay: currentDay,
          totalPlayers: players.length,
          colonyStockpiles: colonyStockpiles
        });
      });
    });
  });
});

// Get decisions for a specific day
app.get('/decisions/:day', (req, res) => {
  const day = parseInt(req.params.day);
  
  if (!day || day < 1) {
    return res.json({ error: 'Invalid day parameter' });
  }
  
  db.all('SELECT * FROM decisions WHERE day = ?', [day], (err, decisions) => {
    if (err) {
      console.error('Database error in /decisions:', {
        error: err.message,
        day,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Database error' });
    }
    
    res.json({ decisions: decisions });
  });
});

// Check submission status for all players
app.get('/submission-status/:day', (req, res) => {
  const day = parseInt(req.params.day);
  
  if (!day || day < 1) {
    return res.json({ error: 'Invalid day parameter' });
  }
  
  db.all('SELECT * FROM players', [], (err, players) => {
    if (err) {
      console.error('Database error in /submission-status:', {
        error: err.message,
        day,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Database error' });
    }
    
    db.all('SELECT playerId FROM decisions WHERE day = ?', [day], (err, submittedDecisions) => {
      if (err) {
        console.error('Database error checking decisions in /submission-status:', {
          error: err.message,
          day,
          timestamp: new Date().toISOString()
        });
        return res.json({ error: 'Database error' });
      }
      
      const submittedPlayerIds = submittedDecisions.map(d => d.playerId);
      const submissionStatus = checkAllPlayersSubmitted(submittedDecisions, players);
      
      res.json({
        day: day,
        players: players.map(player => ({
          id: player.id,
          name: player.name,
          hasSubmitted: submittedPlayerIds.includes(player.id)
        })),
        submissionStatus: submissionStatus
      });
    });
  });
});

// 3. ENHANCED NEWS RETRIEVAL ENDPOINT
app.get('/structured-news/:days?', (req, res) => {
  const daysToShow = parseInt(req.params.days) || 3; // Default show last 3 days
  
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, state) => {
    if (err) {
      console.error('Database error in /structured-news:', {
        error: err.message,
        daysToShow,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Database error' });
    }
    
    const currentDay = state.current_day;
    const startDay = Math.max(1, currentDay - daysToShow);
    
    db.all(
      `SELECT day, message, category, priority, created_at 
       FROM news 
       WHERE day >= ? AND day < ?
       ORDER BY day DESC, priority DESC, created_at DESC`,
      [startDay, currentDay],
      (err, newsRows) => {
        if (err) {
          console.error('News query error in /structured-news:', {
            error: err.message,
            startDay,
            currentDay,
            timestamp: new Date().toISOString()
          });
          return res.json({ error: 'Failed to get news' });
        }
        
        // Group news by day and category
        const structuredNews = {};
        
        newsRows.forEach(item => {
          // Only process news items with valid categories that exist in NEWS_CATEGORIES
          if (!item.category || !NEWS_CATEGORIES[item.category]) {
            return; // Skip invalid categories
          }
          
          if (!structuredNews[item.day]) {
            structuredNews[item.day] = {
              day: item.day
            };
          }
          
          // Initialize category array if it doesn't exist
          if (!structuredNews[item.day][item.category]) {
            structuredNews[item.day][item.category] = [];
          }
          
          structuredNews[item.day][item.category].push({
            message: item.message,
            priority: item.priority,
            timestamp: item.created_at
          });
        });
        
        // Convert to array and sort by day descending
        const newsArray = Object.values(structuredNews).sort((a, b) => b.day - a.day);
        
        res.json({
          structuredNews: newsArray,
          currentDay: currentDay,
          daysShown: daysToShow
        });
      }
    );
  });
});

// 6. NEWS CATEGORY ICONS AND PRIORITIES
const NEWS_CATEGORIES = {
  raid: {
    icon: '⚔️',
    color: '#ff6666',
    title: 'Raid Operations'
  },
  block: {
    icon: '🛡️',
    color: '#66ccff',
    title: 'Block Operations'
  }
};

// Export categories for frontend use
app.get('/news-categories', (req, res) => {
  res.json(NEWS_CATEGORIES);
});

// 7. New endpoint: End game and determine winner
app.post('/end-game', (req, res) => {
  db.get('SELECT current_day FROM game_state WHERE id = 1', (err, state) => {
    if (err) {
      console.error('Database error in /end-game:', {
        error: err.message,
        timestamp: new Date().toISOString()
      });
      return res.json({ error: 'Database error' });
    }
    
    const currentDay = state.current_day;
    
    db.all('SELECT * FROM players ORDER BY credits DESC', [], (err, players) => {
      if (err) {
        console.error('Players query error in /end-game:', {
          error: err.message,
          currentDay,
          timestamp: new Date().toISOString()
        });
        return res.json({ error: 'Failed to get players' });
      }
      
      const gameResult = determineWinner(players);
      
      // Mark game as ended in database (set current_day to exceed max days)
      db.run('UPDATE game_state SET current_day = ? WHERE id = 1', [GAME_CONFIG.GAME_DURATION_DAYS + 1], (err) => {
        if (err) {
          console.error('Game state update error in /end-game:', {
            error: err.message,
            currentDay,
            timestamp: new Date().toISOString()
          });
          return res.json({ error: 'Failed to end game' });
        }
        
        // Add final news
        const finalNews = [
          `🏆 GAME COMPLETE! Winner: ${gameResult.winner.name} with ${gameResult.winningCredits}!`,
          `🥈 Second Place: ${gameResult.leaderboard[1]?.name} with ${gameResult.leaderboard[1]?.credits || 0}`,
          `🥉 Third Place: ${gameResult.leaderboard[2]?.name} with ${gameResult.leaderboard[2]?.credits || 0}`
        ];
        
        const newsPromises = finalNews.map(newsItem => {
          return new Promise((resolve, reject) => {
            db.run('INSERT INTO news (day, message) VALUES (?, ?)', [currentDay, newsItem], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        });
        
        Promise.all(newsPromises).then(() => {
          res.json({
            success: true,
            gameEnded: true,
            winner: gameResult.winner,
            finalStandings: gameResult.leaderboard
          });
        }).catch(err => {
          console.error('Error saving final news in /end-game:', {
            error: err.message,
            currentDay,
            timestamp: new Date().toISOString()
          });
          res.json({ error: 'Failed to save final results' });
        });
      });
    });
  });
});

// 8. Auto-advance checking with timeout
let autoAdvanceTimeout = null;

function scheduleAutoAdvance(currentDay) {
  // Clear existing timeout
  if (autoAdvanceTimeout) {
    clearTimeout(autoAdvanceTimeout);
  }
  
  // Set 5-minute timer for auto-advance check
  autoAdvanceTimeout = setTimeout(() => {
    checkAndAutoAdvance(currentDay);
  }, 5 * 60 * 1000); // 5 minutes
}

function checkAndAutoAdvance(currentDay) {
  db.all('SELECT * FROM players WHERE credits > 0 OR EXISTS (SELECT 1 FROM decisions WHERE playerId = players.id)', [], (err, activePlayers) => {
    if (err) {
      console.error('Error checking active players for auto-advance:', {
        error: err.message,
        currentDay,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    db.all('SELECT * FROM decisions WHERE day = ?', [currentDay], (err, decisions) => {
      if (err) {
        console.error('Error checking decisions for auto-advance:', {
          error: err.message,
          currentDay,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      const submissionStatus = checkAllPlayersSubmitted(decisions, activePlayers);
      
      if (submissionStatus.allSubmitted && submissionStatus.activeCount >= 2) {
        console.log(`🤖 Auto-advancing day ${currentDay} - all ${submissionStatus.activeCount} active players submitted`);
        
        // Auto-process the day by calling the core logic
        db.get('SELECT * FROM game_state WHERE id = 1', (err, state) => {
          if (err || !state) {
            console.error('Auto-advance: Game state error or not found:', {
              error: err?.message || 'No state found',
              currentDay,
              timestamp: new Date().toISOString()
            });
            return;
          }
          const actualCurrentDay = state.current_day; // Get the most current day from DB

          if (actualCurrentDay !== currentDay) {
            console.log(`Auto-advance: Day already advanced from ${currentDay} to ${actualCurrentDay}. Skipping.`);
            return;
          }

          db.all('SELECT * FROM players', [], (err, playersForProcess) => {
            if (err) {
              console.error('Auto-advance: Failed to get players for processing:', {
                error: err.message,
                currentDay,
                timestamp: new Date().toISOString()
              });
              return;
            }
            processCoreDayLogic(actualCurrentDay, playersForProcess, decisions, state, (err, result) => {
              if (err) {
                console.error('Auto-advance: Error during core day processing:', {
                  error: err,
                  currentDay: actualCurrentDay,
                  timestamp: new Date().toISOString()
                });
                return;
              }

              const { newPrices, tomorrowColonyNeeds, totalSupply, dailySalesTotals, priceHistory, colonyNeedsHistory, news: processedNews } = result;

              db.run(
                `UPDATE game_state SET 
                 current_day = current_day + 1, 
                 market_prices = ?, 
                 colony_needs = ?,
                 last_supply = ?,
                 daily_sales_totals = ?,
                 price_history = ?,
                 colony_needs_history = ?,
                 last_updated = CURRENT_TIMESTAMP 
                 WHERE id = 1`,
                [
                  JSON.stringify(newPrices), 
                  JSON.stringify(tomorrowColonyNeeds),
                  JSON.stringify(totalSupply),
                  JSON.stringify(dailySalesTotals),
                  JSON.stringify(priceHistory),
                  JSON.stringify(colonyNeedsHistory)
                ],
                (err) => {
                  if (err) {
                    console.error('Auto-advance: Error updating game state:', {
                      error: err.message,
                      currentDay: actualCurrentDay,
                      timestamp: new Date().toISOString()
                    });
                    return;
                  }
                  db.run('DELETE FROM decisions WHERE day = ?', [actualCurrentDay], (err) => {
                    if (err) {
                      console.error('Auto-advance: Error clearing decisions:', {
                        error: err.message,
                        day: actualCurrentDay,
                        timestamp: new Date().toISOString()
                      });
                    }
                    console.log(`Auto-advance: Day ${actualCurrentDay} successfully processed to Day ${actualCurrentDay + 1}.`);
                    // Add news about auto-advance using the categorized function
                    addGeneralNews(actualCurrentDay, `Day ${actualCurrentDay} auto-advanced due to all active players submitting.`, 1)
                      .catch(newsErr => {
                        console.error('Auto-advance: Error adding news:', {
                          error: newsErr.message,
                          day: actualCurrentDay,
                          timestamp: new Date().toISOString()
                        });
                      });
                  });
                }
              );
            });
          });
        });
      } else {
        console.log(`Auto-advance: Not all active players submitted for day ${currentDay}. Submitted: ${submissionStatus.submittedCount}/${submissionStatus.activeCount}`);
      }
    });
  });
}

// Initial call to schedule auto-advance when server starts (for the current day)
db.get('SELECT current_day FROM game_state WHERE id = 1', (err, state) => {
  if (!err && state) {
    console.log(`📅 Game currently on day ${state.current_day}`);
    // Comment out auto-advance for now until we test day processing
    // scheduleAutoAdvance(state.current_day);
  } else {
    console.log('⚠️ Could not load game state for auto-advance scheduling');
  }
});

// Reset game endpoint
app.post('/reset-game', (req, res) => {
  console.log('🔄 Resetting game...');
  
  db.serialize(() => {
    // Clear all data
    db.run('DELETE FROM players', (err) => {
      if (err) {
        console.error('Error clearing players in /reset-game:', {
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    db.run('DELETE FROM decisions', (err) => {
      if (err) {
        console.error('Error clearing decisions in /reset-game:', {
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    db.run('DELETE FROM raid_logs', (err) => {
      if (err) {
        console.error('Error clearing raid logs in /reset-game:', {
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    db.run('DELETE FROM news', (err) => {
      if (err) {
        console.error('Error clearing news in /reset-game:', {
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    db.run('DELETE FROM player_sales', (err) => {
      if (err) {
        console.error('Error clearing sales in /reset-game:', {
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // Reset game state to Day 1 with correct starting colony needs
    db.run(`UPDATE game_state SET 
      current_day = 1,
      market_prices = '{"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}',
      colony_needs = '{"whiteDiamonds":18,"redRubies":12,"blueGems":15,"greenPoison":15}',
      last_supply = '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      daily_sales_totals = '{"whiteDiamonds":0,"redRubies":0,"blueGems":0,"greenPoison":0}',
      price_history = '[{"day":1,"whiteDiamonds":20,"redRubies":15,"blueGems":12,"greenPoison":10}]',
      colony_needs_history = '[{"day":1,"whiteDiamonds":18,"redRubies":12,"blueGems":15,"greenPoison":15}]',
      active_players = 0,
      last_updated = CURRENT_TIMESTAMP
      WHERE id = 1`, (err) => {
      if (err) {
        console.error('Error resetting game state in /reset-game:', {
          error: err.message,
          timestamp: new Date().toISOString()
        });
        return res.json({ error: 'Failed to reset game state' });
      }
      
      // Add welcome news for new game
      db.run('INSERT INTO news (day, message, category, priority) VALUES (?, ?, ?, ?)', 
        [1, `🚀 New ${GAME_CONFIG.GAME_DURATION_DAYS}-day galactic conquest begins! May the best commander win!`, 'general', 3], (err) => {
        if (err) {
          console.error('Error adding welcome news in /reset-game:', {
            error: err.message,
            timestamp: new Date().toISOString()
          });
        }
        
        console.log(`✅ Game reset complete - New ${GAME_CONFIG.GAME_DURATION_DAYS}-day conquest ready!`);
        res.json({ 
          success: true, 
          message: `New ${GAME_CONFIG.GAME_DURATION_DAYS}-day galactic conquest started!`,
          resetToDay: 1
        });
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Space Tribes server running on port ${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} to play!`);
  console.log(`💰 ${GAME_CONFIG.DUMP_PRICE} Dump Safety Net loaded!`);
  console.log(`📰 Structured Daily News system loaded!`);
  console.log(`⚙️ Game configured for ${GAME_CONFIG.GAME_DURATION_DAYS} days, max ${GAME_CONFIG.MAX_EFFORT_POINTS} effort points`);
});