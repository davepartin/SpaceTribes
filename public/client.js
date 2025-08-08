function login() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) {
    document.getElementById('error').textContent = 'Name required';
    return;
  }

  fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      document.getElementById('error').textContent = data.error;
    } else {
      window.location.href = `/dashboard.html?playerId=${data.playerId}`;
    }
  })
  .catch(err => {
    console.error('Login error:', err);
    document.getElementById('error').textContent = 'Login failed. Check console.';
  });
}

function loadDashboard(playerId) {
  fetch(`/game-data/${playerId}`)
    .then(res => res.json())
    .then(data => {
      document.getElementById('currentDay').textContent = data.currentDay;

      const resourcesOrder = ['whiteDiamonds', 'redRubies', 'blueGems', 'greenPoison'];

      const stockpileTable = document.getElementById('stockpile');
      stockpileTable.innerHTML = '<tr><th>Resource</th><th>Stockpile</th></tr>';
      resourcesOrder.forEach(resource => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${resource}</td><td>${data.stockpiles[resource] || 0}</td>`;
        stockpileTable.appendChild(row);
      });

      const lastMiningTable = document.getElementById('lastMining');
      lastMiningTable.innerHTML = '<tr><th>Resource</th><th>Last Mined</th></tr>';
      resourcesOrder.forEach(resource => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${resource}</td><td>${data.lastEfforts[resource] || 0}</td>`;
        lastMiningTable.appendChild(row);
      });

      const pricesList = document.getElementById('prices');
      pricesList.innerHTML = '';
      resourcesOrder.forEach(min => {
        const li = document.createElement('li');
        li.textContent = `${min}: ${data.prices[min]} coins`;
        pricesList.appendChild(li);
      });

      const needsSupply = document.getElementById('needsSupply');
      needsSupply.innerHTML = '';
      resourcesOrder.forEach(min => {
        const li = document.createElement('li');
        li.textContent = `${min}: Need ${data.needs[min]}, Supplied ${data.stockpiles[min] || 0}`;
        needsSupply.appendChild(li);
      });

      const playersStockpiles = document.getElementById('playersStockpiles');
      playersStockpiles.innerHTML = '<tr><th>Player</th><th>White Diamonds</th><th>Red Rubies</th><th>Blue Gems</th><th>Green Poison</th></tr>';
      data.leaderboard.forEach(player => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${player.name}</td><td>${player.stockpiles.whiteDiamonds || 0}</td><td>${player.stockpiles.redRubies || 0}</td><td>${player.stockpiles.blueGems || 0}</td><td>${player.stockpiles.greenPoison || 0}</td>`;
        playersStockpiles.appendChild(row);
      });

      const newsBoard = document.getElementById('newsBoard');
      newsBoard.innerHTML = '';
      for (let attacker in data.raidSummaries) {
        const li = document.createElement('li');
        li.textContent = data.raidSummaries[attacker] || '';
        if (li.textContent) newsBoard.appendChild(li);
      }

      const leaderboard = document.getElementById('leaderboard');
      leaderboard.innerHTML = '';
      data.leaderboard.forEach(player => {
        const li = document.createElement('li');
        li.textContent = `${player.name}: ${player.credits || 0} coins`;
        leaderboard.appendChild(li);
      });

      const message = document.getElementById('message');
      message.textContent = data.message || '';
    });
}

function loadDecisions(playerId) {
  fetch(`/game-data/${playerId}`)
    .then(res => res.json())
    .then(data => {
      document.getElementById('playerName').textContent = data.playerName || 'Unknown';
      document.getElementById('credits').textContent = data.credits || 0;
      document.getElementById('effortPoints').textContent = 10 - Object.values(data.efforts).reduce((a, b) => a + b, 0);

      const resourcesOrder = ['whiteDiamonds', 'redRubies', 'blueGems', 'greenPoison'];
      resourcesOrder.forEach(resource => {
        document.getElementById(`resource${resource}`).textContent = data.stockpiles[resource] || 0;
        document.getElementById(`price${resource}`).textContent = data.prices[resource] || 0;
        document.querySelector(`input[name="${resource}"]`).value = data.efforts[resource] || 0;
        document.querySelector(`input[name="sell${resource}"]`).value = data.sales[resource] || 0;
      });

      const raidTarget = document.getElementById('raidTarget');
      raidTarget.innerHTML = '<option value="none">None</option>';
      data.leaderboard.forEach(player => {
        if (player.name !== data.playerName) {
          const option = document.createElement('option');
          option.value = player.name;
          option.textContent = player.name;
          raidTarget.appendChild(option);
        }
      });
    });
}

function submitDecisions() {
  const urlParams = new URLSearchParams(window.location.search);
  const playerId = urlParams.get('playerId');

  const efforts = {
    whiteDiamonds: parseInt(document.querySelector('input[name="whiteDiamonds"]').value) || 0,
    redRubies: parseInt(document.querySelector('input[name="redRubies"]').value) || 0,
    blueGems: parseInt(document.querySelector('input[name="blueGems"]').value) || 0,
    greenPoison: parseInt(document.querySelector('input[name="greenPoison"]').value) || 0
  };

  const sales = {
    whiteDiamonds: parseInt(document.querySelector('input[name="sellWhiteDiamonds"]').value) || 0,
    redRubies: parseInt(document.querySelector('input[name="sellRedRubies"]').value) || 0,
    blueGems: parseInt(document.querySelector('input[name="sellBlueGems"]').value) || 0,
    greenPoison: parseInt(document.querySelector('input[name="sellGreenPoison"]').value) || 0
  };

  const raidTarget = document.getElementById('raidTarget').value;
  const raidMaterial = document.querySelector('input[name="raidMaterial"]:checked')?.value;

  if (raidTarget !== 'none' && raidMaterial) {
    console.log(`Raid: 4 ${raidMaterial} from ${raidTarget}`);
  }

  fetch('/submit-decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, efforts, sales, raidTarget, raidMaterial })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      document.getElementById('message').textContent = data.error;
    } else {
      document.getElementById('message').textContent = 'Decisions submitted!';
      loadDecisions(playerId);
    }
  });
}

function goToDecisions() {
  const urlParams = new URLSearchParams(window.location.search);
  const playerId = urlParams.get('playerId');
  window.location.href = `/decisions.html?playerId=${playerId}`;
}

function goBack() {
  const urlParams = new URLSearchParams(window.location.search);
  const playerId = urlParams.get('playerId');
  window.location.href = `/dashboard.html?playerId=${playerId}`;
}

function processDay() {
  const urlParams = new URLSearchParams(window.location.search);
  const playerId = urlParams.get('playerId');

  fetch('/process-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      document.getElementById('message').textContent = data.error;
    } else {
      document.getElementById('message').textContent = 'Day processed successfully!';
      loadDashboard(playerId);
    }
  })
  .catch(err => {
    console.error('Process Day error:', err);
    document.getElementById('message').textContent = 'Failed to process day. Check console.';
  });
}

function copyResources() {
  const resources = document.getElementById('resources').innerText;
  const credits = document.getElementById('credits').textContent;
  const textToCopy = `Resources: ${resources}, Coins: ${credits}`;
  navigator.clipboard.writeText(textToCopy)
    .then(() => alert('Resources copied to clipboard!'))
    .catch(err => console.error('Copy failed:', err));
}

// Load appropriate page on load
const urlParams = new URLSearchParams(window.location.search);
const playerId = urlParams.get('playerId');
if (playerId) {
  if (window.location.pathname.endsWith('dashboard.html')) {
    loadDashboard(playerId);
  } else if (window.location.pathname.endsWith('decisions.html')) {
    loadDecisions(playerId);
  }
}