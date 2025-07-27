const express = require('express');
const cron = require('node-cron');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname))); // <-- update here


/*
 * Simplified Space Tribes server
 *
 * This version of the server removes the dependency on SQLite and stores all
 * game state in memory. It exposes the same API endpoints expected by the
 * existing HTML/JS front‑end. Use this file instead of the original
 * database‑backed version.
 *
 * Note: Because this server keeps everything in memory, all data will be
 * lost whenever the process restarts. This implementation is intended
 * primarily for development and testing.
 */

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Define the minerals used in the game
const MINERALS = ['bluegems', 'redrubies', 'whitediamonds', 'greenpoison'];

// In‑memory storage for players and game state
let players = [];
let decisionsByPlayer = {}; // maps player name -> decisions for the current day
let gameState = {
  current_day: 1,
  prices: { bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 },
  last_prices: { bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 },
  events_log: []
};

/**
 * Ensure there are always six total players in the game. Human players occupy
 * the first slots and the remainder are filled by AI bots. Bots make simple
 * decisions each day during processing.
 */
function addBotPlayers() {
  const needed = 6 - players.length;
  for (let i = 0; i < needed; i++) {
    const botIndex = players.filter(p => p.is_ai).length + 1;
    const name = `Bot${botIndex}`;
    const tribe = `Bot Tribe ${botIndex}`;
    if (!players.find(p => p.name === name)) {
      players.push({
        id: players.length + 1,
        name,
        tribe_name: tribe,
        is_ai: true,
        resources: { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 },
        credits: 1000,
        upgrades: { miner: 0, defense: 0 }
      });
    }
  }
}

/**
 * POST /api/login
 * Logs in an existing human player or creates a new one if room allows.
 */
app.post('/api/login', (req, res) => {
  const { name, tribeName } = req.body;
  if (!name || !tribeName) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  const existing = players.find(p => !p.is_ai && p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    return res.json({ success: true });
  }
  const humanCount = players.filter(p => !p.is_ai).length;
  if (humanCount >= 6) {
    return res.status(400).json({ error: 'Maximum 6 players allowed' });
  }
  players.push({
    id: players.length + 1,
    name,
    tribe_name: tribeName,
    is_ai: false,
    resources: { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 },
    credits: 1000,
    upgrades: { miner: 0, defense: 0 }
  });
  addBotPlayers();
  return res.json({ success: true });
});

/**
 * GET /api/players
 * Returns the names and tribe names of all human players.
 */
app.get('/api/players', (req, res) => {
  const humans = players.filter(p => !p.is_ai).map(p => ({ name: p.name, tribe_name: p.tribe_name }));
  return res.json(humans);
});

/**
 * GET /api/game-state/:playerName
 * Returns the current day, prices, last prices, resources and credits for the
 * specified player, leaderboard and event log.
 */
app.get('/api/game-state/:playerName', (req, res) => {
  const playerName = req.params.playerName;
  const player = players.find(p => p.name === playerName);
  if (!player) {
    return res.status(400).json({ error: 'Player not found' });
  }
  const resources = { ...player.resources };
  resources.credits = player.credits;
  const leaderboard = players
    .map(p => ({ tribe_name: p.tribe_name, credits: p.credits }))
    .sort((a, b) => b.credits - a.credits);
  return res.json({
    currentDay: gameState.current_day,
    prices: { ...gameState.prices },
    lastPrices: { ...gameState.last_prices },
    resources,
    leaderboard,
    eventLog: [...gameState.events_log]
  });
});

/**
 * GET /api/decisions/:playerName
 * Returns the decisions that the specified player has already submitted for
 * the current day.
 */
app.get('/api/decisions/:playerName', (req, res) => {
  const playerName = req.params.playerName;
  if (!players.find(p => p.name === playerName)) {
    return res.status(400).json({ error: 'Player not found' });
  }
  const decisions = decisionsByPlayer[playerName] || {};
  return res.json(decisions);
});

/**
 * POST /api/submit-decisions
 * Saves a player's decisions for the current day. Validates that the total
 * mining effort does not exceed 10 points.
 */
app.post('/api/submit-decisions', (req, res) => {
  const { playerName, decisions } = req.body;
  if (!playerName || !decisions) {
    return res.status(400).json({ error: 'Invalid submission' });
  }
  const player = players.find(p => p.name === playerName);
  if (!player) {
    return res.status(400).json({ error: 'Player not found' });
  }
  const totalEffort = MINERALS.reduce((sum, m) => sum + (decisions.mining?.[m] || 0), 0);
  if (totalEffort > 10) {
    return res.status(400).json({ error: 'Total effort exceeds 10 points' });
  }
  decisionsByPlayer[playerName] = decisions;
  return res.json({ success: true });
});

/**
 * Core game logic that processes the end of the current day and advances to
 * the next. This function updates resources, credits, prices and logs events.
 */
async function processDay() {
  console.log('Processing day', gameState.current_day);
  const yesterdayPrices = { ...gameState.prices };
  gameState.last_prices = { ...yesterdayPrices };
  const totalSold = { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 };
  players.forEach(p => {
    let dec = decisionsByPlayer[p.name];
    if (!dec) {
      dec = {
        mining: { bluegems: 2, redrubies: 2, whitediamonds: 2, greenpoison: 2 },
        sell: { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 },
        raidTarget: '',
        raidMineral: 'bluegems',
        upgrade: ''
      };
      if (p.is_ai) {
        dec.sell = {};
        MINERALS.forEach(m => {
          dec.sell[m] = Math.floor((p.resources[m] || 0) * 0.5);
        });
        if (Math.random() < 0.2 && players.length > 1) {
          const targets = players.filter(x => x.name !== p.name);
          const target = targets[Math.floor(Math.random() * targets.length)];
          dec.raidTarget = target.name;
          dec.raidMineral = MINERALS[Math.floor(Math.random() * MINERALS.length)];
        }
        if (Math.random() < 0.3) {
          dec.upgrade = Math.random() < 0.5 ? 'miner' : 'defense';
        }
      }
    }
    // Mining
    MINERALS.forEach(m => {
      const effort = dec.mining[m] || 0;
      const baseYield = 2 + p.upgrades.miner;
      p.resources[m] += baseYield * effort;
    });
    // Selling
    MINERALS.forEach(m => {
      const amount = Math.min(p.resources[m], dec.sell[m] || 0);
      p.resources[m] -= amount;
      p.credits += amount * gameState.prices[m];
      totalSold[m] += amount;
    });
    // Raiding
    if (dec.raidTarget) {
      const target = players.find(x => x.name === dec.raidTarget);
      if (target) {
        const stolen = Math.min((target.resources[dec.raidMineral] || 0) * 0.1, 5);
        if (stolen > 0) {
          target.resources[dec.raidMineral] -= stolen;
          p.resources[dec.raidMineral] += stolen;
          gameState.events_log.push(
            `${p.name} raided ${target.name} for ${stolen.toFixed(1)} ${dec.raidMineral}`
          );
        }
      }
    }
    // Upgrades
    if (dec.upgrade === 'miner') {
      const cost = 100 + p.upgrades.miner * 50;
      if (p.credits >= cost) {
        p.credits -= cost;
        p.upgrades.miner += 1;
        gameState.events_log.push(`${p.name} upgraded their mining robots`);
      }
    }
    if (dec.upgrade === 'defense') {
      const cost = 80 + p.upgrades.defense * 40;
      if (p.credits >= cost) {
        p.credits -= cost;
        p.upgrades.defense += 1;
        gameState.events_log.push(`${p.name} upgraded their defense systems`);
      }
    }
  });
  // Price adjustments based on supply/demand
  MINERALS.forEach(m => {
    const sold = totalSold[m];
    const priceChange = sold > 0 ? -0.1 * sold : 0.05;
    gameState.prices[m] = Math.max(1, gameState.prices[m] + priceChange);
  });
  // Random market events
  if (Math.random() < 0.2) {
    const mineral = MINERALS[Math.floor(Math.random() * MINERALS.length)];
    const change = Math.random() < 0.5 ? 2 : -2;
    gameState.prices[mineral] = Math.max(1, gameState.prices[mineral] + change);
    gameState.events_log.push(`Market event: ${mineral} price ${change > 0 ? 'rose' : 'fell'} by ${Math.abs(change)}`);
  }
  // Reset decisions and increment day
  decisionsByPlayer = {};
  gameState.current_day += 1;
  // Trim event log to last 10 entries
  if (gameState.events_log.length > 10) {
    gameState.events_log = gameState.events_log.slice(-10);
  }
}

/**
 * POST /api/process-day
 * Endpoint to manually advance the game to the next day.
 */
app.post('/api/process-day', async (req, res) => {
  await processDay();
  return res.json({ success: true });
});

/**
 * POST /api/reset-game
 * Resets all players and game state back to their initial conditions.
 */
app.post('/api/reset-game', (req, res) => {
  players = [];
  decisionsByPlayer = {};
  gameState = {
    current_day: 1,
    prices: { bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 },
    last_prices: { bluegems: 10, redrubies: 10, whitediamonds: 10, greenpoison: 10 },
    events_log: []
  };
  res.json({ success: true });
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// Cron job: process the day at midnight (UTC) every day
cron.schedule('0 0 * * *', async () => {
  console.log('Cron job triggered');
  await processDay();
});

// Start the server on port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Space Tribes server listening on port ${PORT}`);
});
