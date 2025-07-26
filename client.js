// Client-side JavaScript for Space Tribes
document.addEventListener('DOMContentLoaded', () => {
  const playerName = localStorage.getItem('playerName');
  if (!playerName && window.location.pathname !== '/index.html') {
      window.location.href = '/index.html';
  }

  if (window.location.pathname.includes('dashboard.html')) {
      loadDashboard();
  } else if (window.location.pathname.includes('decisions.html')) {
      loadDecisions();
  }
});

async function loadDashboard() {
  const playerName = localStorage.getItem('playerName');
  document.getElementById('player-name').textContent = playerName;

  try {
      const response = await fetch(`/api/game-state/${playerName}`);
      const data = await response.json();
      if (data.error) {
          alert(data.error);
          return;
      }

      document.getElementById('current-day').textContent = data.currentDay;
      // Only set lastPrices:
      if (data.lastPrices) {
        document.getElementById('bluegems-lastprice').textContent = data.lastPrices.bluegems.toFixed(1);
        document.getElementById('redrubies-lastprice').textContent = data.lastPrices.redrubies.toFixed(1);
        document.getElementById('whitediamonds-lastprice').textContent = data.lastPrices.whitediamonds.toFixed(1);
        document.getElementById('greenpoison-lastprice').textContent = data.lastPrices.greenpoison.toFixed(1);
      } else {
        document.getElementById('bluegems-lastprice').textContent = '-';
        document.getElementById('redrubies-lastprice').textContent = '-';
        document.getElementById('whitediamonds-lastprice').textContent = '-';
        document.getElementById('greenpoison-lastprice').textContent = '-';
      }

      document.getElementById('bluegems-stock').textContent = data.resources.bluegems.toFixed(1);
      document.getElementById('redrubies-stock').textContent = data.resources.redrubies.toFixed(1);
      document.getElementById('whitediamonds-stock').textContent = data.resources.whitediamonds.toFixed(1);
      document.getElementById('greenpoison-stock').textContent = data.resources.greenpoison.toFixed(1);
      document.getElementById('credits').textContent = data.resources.credits.toFixed(1);

      // Fetch mining and selling assignments for tonight
      const decisionsResponse = await fetch(`/api/decisions/${playerName}`);
      const decisions = await decisionsResponse.json();
      const mining = decisions.mining || { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 };
      const sell = decisions.sell || { bluegems: 0, redrubies: 0, whitediamonds: 0, greenpoison: 0 };
      document.getElementById('bluegems-mining').textContent = mining.bluegems;
      document.getElementById('redrubies-mining').textContent = mining.redrubies;
      document.getElementById('whitediamonds-mining').textContent = mining.whitediamonds;
      document.getElementById('greenpoison-mining').textContent = mining.greenpoison;
      document.getElementById('bluegems-selling').textContent = sell.bluegems;
      document.getElementById('redrubies-selling').textContent = sell.redrubies;
      document.getElementById('whitediamonds-selling').textContent = sell.whitediamonds;
      document.getElementById('greenpoison-selling').textContent = sell.greenpoison;

      const leaderboard = document.getElementById('leaderboard');
      leaderboard.innerHTML = '';
      data.leaderboard.forEach(player => {
          const li = document.createElement('li');
          li.textContent = `${player.tribe_name}: ${player.credits.toFixed(1)} Credits`;
          leaderboard.appendChild(li);
      });

      const eventLog = document.getElementById('event-log');
      eventLog.innerHTML = '';
      data.eventLog.forEach(event => {
          const li = document.createElement('li');
          li.textContent = `Day ${event.day}: ${event.message}`;
          eventLog.appendChild(li);
      });
  } catch (error) {
      console.error('Error loading dashboard:', error);
      alert('Failed to load game state.');
  }
}

// Add this function to update projected values
function updateProjectedStockpiles() {
  const stockpiles = {
    bluegems: parseFloat(document.getElementById('stock_sell_bluegems').textContent.replace('Stockpile: ', '')) || 0,
    redrubies: parseFloat(document.getElementById('stock_sell_redrubies').textContent.replace('Stockpile: ', '')) || 0,
    whitediamonds: parseFloat(document.getElementById('stock_sell_whitediamonds').textContent.replace('Stockpile: ', '')) || 0,
    greenpoison: parseFloat(document.getElementById('stock_sell_greenpoison').textContent.replace('Stockpile: ', '')) || 0
  };
  const mining = {
    bluegems: parseInt(document.getElementById('eff_bluegems').value) || 0,
    redrubies: parseInt(document.getElementById('eff_redrubies').value) || 0,
    whitediamonds: parseInt(document.getElementById('eff_whitediamonds').value) || 0,
    greenpoison: parseInt(document.getElementById('eff_greenpoison').value) || 0
  };
  document.getElementById('projected_bluegems').textContent = `Projected: ${(stockpiles.bluegems + mining.bluegems).toFixed(1)}`;
  document.getElementById('projected_redrubies').textContent = `Projected: ${(stockpiles.redrubies + mining.redrubies).toFixed(1)}`;
  document.getElementById('projected_whitediamonds').textContent = `Projected: ${(stockpiles.whitediamonds + mining.whitediamonds).toFixed(1)}`;
  document.getElementById('projected_greenpoison').textContent = `Projected: ${(stockpiles.greenpoison + mining.greenpoison).toFixed(1)}`;
}

// Update projected values whenever mining effort changes
['eff_bluegems','eff_redrubies','eff_whitediamonds','eff_greenpoison'].forEach(id => {
  document.addEventListener('input', function(e) {
    if (e.target && e.target.id === id) updateProjectedStockpiles();
  });
});

async function loadDecisions() {
  const playerName = localStorage.getItem('playerName');
  document.getElementById('player-name').textContent = playerName;

  try {
      // Fetch current game state including prices and player resources
      const response = await fetch(`/api/game-state/${playerName}`);
      const data = await response.json();
      if (data.error) {
          alert(data.error);
          return;
      }

      // Update prices on decisions page
      document.getElementById('price_bluegems').textContent = `Value: ${data.prices.bluegems.toFixed(1)} coins`;
      document.getElementById('price_redrubies').textContent = `Value: ${data.prices.redrubies.toFixed(1)} coins`;
      document.getElementById('price_whitediamonds').textContent = `Value: ${data.prices.whitediamonds.toFixed(1)} coins`;
      document.getElementById('price_greenpoison').textContent = `Value: ${data.prices.greenpoison.toFixed(1)} coins`;

      // Update sell section stockpile displays
      document.getElementById('stock_sell_bluegems').textContent = `Stockpile: ${data.resources.bluegems.toFixed(1)}`;
      document.getElementById('stock_sell_redrubies').textContent = `Stockpile: ${data.resources.redrubies.toFixed(1)}`;
      document.getElementById('stock_sell_whitediamonds').textContent = `Stockpile: ${data.resources.whitediamonds.toFixed(1)}`;
      document.getElementById('stock_sell_greenpoison').textContent = `Stockpile: ${data.resources.greenpoison.toFixed(1)}`;

      // Populate raid target dropdown
      const raidTargetSelect = document.getElementById('raid_target');
      raidTargetSelect.innerHTML = '<option value="">None</option>';
      const playersResponse = await fetch('/api/players');
      const players = await playersResponse.json();
      players.forEach(player => {
          if (player.name !== playerName) {
              const option = document.createElement('option');
              option.value = player.name;
              option.textContent = player.tribe_name;
              raidTargetSelect.appendChild(option);
          }
      });

      // Load current decisions if any
      const decisionsResponse = await fetch(`/api/decisions/${playerName}`);
      const decisions = await decisionsResponse.json();
      if (decisions.mining) {
          document.getElementById('eff_bluegems').value = decisions.mining.bluegems || 0;
          document.getElementById('eff_redrubies').value = decisions.mining.redrubies || 0;
          document.getElementById('eff_whitediamonds').value = decisions.mining.whitediamonds || 0;
          document.getElementById('eff_greenpoison').value = decisions.mining.greenpoison || 0;
          document.getElementById('sell_bluegems').value = decisions.sell.bluegems || 0;
          document.getElementById('sell_redrubies').value = decisions.sell.redrubies || 0;
          document.getElementById('sell_whitediamonds').value = decisions.sell.whitediamonds || 0;
          document.getElementById('sell_greenpoison').value = decisions.sell.greenpoison || 0;
          document.getElementById('raid_target').value = decisions.raidTarget || '';
          document.getElementById('raid_mineral').value = decisions.raidMineral || 'bluegems';
          document.getElementById('up_miner').checked = decisions.upgrade === 'miner';
          document.getElementById('up_defense').checked = decisions.upgrade === 'defense';
      }

      // Update effort points remaining
      updateEffortPoints();
      updateProjectedStockpiles();
  } catch (error) {
      console.error('Error loading decisions:', error);
      document.getElementById('error').textContent = 'Failed to load decisions.';
  }
}

function updateEffortPoints() {
  const efforts = [
      parseInt(document.getElementById('eff_bluegems').value) || 0,
      parseInt(document.getElementById('eff_redrubies').value) || 0,
      parseInt(document.getElementById('eff_whitediamonds').value) || 0,
      parseInt(document.getElementById('eff_greenpoison').value) || 0
  ];
  const totalEffort = efforts.reduce((sum, val) => sum + val, 0);
  const remaining = 10 - totalEffort;
  document.getElementById('effort-points').textContent = remaining;
  document.getElementById('submitBtn').disabled = remaining < 0;
  document.getElementById('error').textContent = remaining < 0 ? 'Total effort exceeds 10 points!' : '';
}

function setSellPercentage(material, percentage) {
  const stockElement = document.getElementById(`stock_sell_${material}`);
  const stockText = stockElement.textContent.replace('Current: ', '');
  const stock = parseFloat(stockText) || 0;
  const amount = Math.round((stock * percentage) / 100 * 10) / 10;
  document.getElementById(`sell_${material}`).value = amount;
}

async function submitDecisions() {
  const playerName = localStorage.getItem('playerName');
  // Get current stockpiles
  const stockpiles = {
    bluegems: parseFloat(document.getElementById('stock_sell_bluegems').textContent.replace('Stockpile: ', '')) || 0,
    redrubies: parseFloat(document.getElementById('stock_sell_redrubies').textContent.replace('Stockpile: ', '')) || 0,
    whitediamonds: parseFloat(document.getElementById('stock_sell_whitediamonds').textContent.replace('Stockpile: ', '')) || 0,
    greenpoison: parseFloat(document.getElementById('stock_sell_greenpoison').textContent.replace('Stockpile: ', '')) || 0
  };
  // Get sell amounts
  const sell = {
    bluegems: parseInt(document.getElementById('sell_bluegems').value) || 0,
    redrubies: parseInt(document.getElementById('sell_redrubies').value) || 0,
    whitediamonds: parseInt(document.getElementById('sell_whitediamonds').value) || 0,
    greenpoison: parseInt(document.getElementById('sell_greenpoison').value) || 0
  };
  // Check for overselling
  let oversell = null;
  for (const mineral of Object.keys(sell)) {
    if (sell[mineral] > stockpiles[mineral]) {
      oversell = mineral;
      break;
    }
  }
  if (oversell) {
    document.getElementById('error').textContent = `You cannot sell more ${oversell.replace('bluegems','Blue Gems').replace('redrubies','Red Rubies').replace('whitediamonds','White Diamonds').replace('greenpoison','Green Poison')} than you have!`;
    return;
  }
  const decisions = {
      mining: {
          bluegems: parseInt(document.getElementById('eff_bluegems').value) || 0,
          redrubies: parseInt(document.getElementById('eff_redrubies').value) || 0,
          whitediamonds: parseInt(document.getElementById('eff_whitediamonds').value) || 0,
          greenpoison: parseInt(document.getElementById('eff_greenpoison').value) || 0
      },
      sell,
      raidTarget: document.getElementById('raid_target').value,
      raidMineral: document.getElementById('raid_mineral').value,
      upgrade: document.getElementById('up_miner').checked ? 'miner' : document.getElementById('up_defense').checked ? 'defense' : ''
  };

  const totalEffort = Object.values(decisions.mining).reduce((sum, val) => sum + val, 0);
  if (totalEffort > 10) {
      document.getElementById('error').textContent = 'Total effort exceeds 10 points!';
      return;
  }

  try {
      const response = await fetch('/api/submit-decisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName, decisions })
      });
      const result = await response.json();
      if (result.success) {
          alert('Decisions submitted successfully!');
          window.location.href = '/dashboard.html';
      } else {
          document.getElementById('error').textContent = result.error;
      }
  } catch (error) {
      console.error('Error submitting decisions:', error);
      document.getElementById('error').textContent = 'Failed to submit decisions.';
  }
}

async function logout() {
  localStorage.removeItem('playerName');
  window.location.href = '/index.html';
}// Test‐advance the game by one Sol
async function nextSol() {
  try {
    const res = await fetch('/api/process-day', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      alert('Advanced to next sol manually');
      loadDashboard();
    } else {
      alert('Failed to advance sol: ' + result.error);
    }
  } catch (e) {
    console.error(e);
    alert('Error advancing sol.');
  }
}

// Reset the game to day 1
async function resetGame() {
  if (confirm('Are you sure you want to reset the game to day 1? This will reset all progress and start a new game cycle.')) {
    try {
      const res = await fetch('/api/reset-game', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        alert('Game reset successfully! Starting new cycle.');
        loadDashboard();
      } else {
        alert('Failed to reset game: ' + result.error);
      }
    } catch (e) {
      console.error(e);
      alert('Error resetting game.');
    }
  }
}
