function login() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) return;

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
  .catch(err => console.error(err));
}

function loadDashboard(playerId) {
  fetch(`/game-data/${playerId}`)
  .then(res => res.json())
  .then(data => {
    document.getElementById('currentDay').textContent = data.currentDay;
    
    const pricesList = document.getElementById('prices');
    pricesList.innerHTML = '';
    for (let min in data.prices) {
      const li = document.createElement('li');
      li.textContent = `${min}: ${data.prices[min]} credits`;
      pricesList.appendChild(li);
    }
    
    const stockList = document.getElementById('stockpiles');
    stockList.innerHTML = '';
    for (let min in data.stockpiles) {
      const li = document.createElement('li');
      li.textContent = `${min}: ${data.stockpiles[min]}`;
      stockList.appendChild(li);
    }
    document.getElementById('credits').textContent = data.credits;
    
    const lb = document.getElementById('leaderboard');
    lb.innerHTML = '';
    data.leaderboard.forEach(player => {
      const li = document.createElement('li');
      li.textContent = `${player.name}: ${player.credits} credits`;
      lb.appendChild(li);
    });
    
    // Pre-fill form with current decisions
    document.querySelector('input[name="crystium"]').value = data.efforts.crystium || 0;
    document.querySelector('input[name="adamantite"]').value = data.efforts.adamantite || 0;
    document.querySelector('input[name="xerium"]').value = data.efforts.xerium || 0;
    document.querySelector('input[name="nourite"]').value = data.efforts.nourite || 0;
    
    document.querySelector('input[name="sell_crystium"]').value = data.sales.crystium || 0;
    document.querySelector('input[name="sell_adamantite"]').value = data.sales.adamantite || 0;
    document.querySelector('input[name="sell_xerium"]').value = data.sales.xerium || 0;
    document.querySelector('input[name="sell_nourite"]').value = data.sales.nourite || 0;
  });
}

function submitDecisions() {
  const urlParams = new URLSearchParams(window.location.search);
  const playerId = urlParams.get('playerId');
  
  const efforts = {
    crystium: parseInt(document.querySelector('input[name="crystium"]').value) || 0,
    adamantite: parseInt(document.querySelector('input[name="adamantite"]').value) || 0,
    xerium: parseInt(document.querySelector('input[name="xerium"]').value) || 0,
    nourite: parseInt(document.querySelector('input[name="nourite"]').value) || 0
  };
  
  const sales = {
    crystium: parseInt(document.querySelector('input[name="sell_crystium"]').value) || 0,
    adamantite: parseInt(document.querySelector('input[name="sell_adamantite"]').value) || 0,
    xerium: parseInt(document.querySelector('input[name="sell_xerium"]').value) || 0,
    nourite: parseInt(document.querySelector('input[name="sell_nourite"]').value) || 0
  };
  
  fetch('/submit-decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, efforts, sales })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      document.getElementById('message').textContent = data.error;
    } else {
      document.getElementById('message').textContent = 'Decisions submitted!';
      loadDashboard(playerId); // Refresh
    }
  });
}

function processDay() {
  fetch('/process-day', { method: 'POST' })
  .then(res => res.json())
  .then(data => {
    document.getElementById('message').textContent = 'Day processed! Refreshing...';
    const urlParams = new URLSearchParams(window.location.search);
    const playerId = urlParams.get('playerId');
    loadDashboard(playerId);
  });
}