// Global Application State
let currentMarket = null;
let currentOutcome = 'yes'; // default
let currentTokenId = null;
let orderbookPollInterval = null;

// DOM Elements
const marketUrlInput = document.getElementById('marketUrl');
const resolveBtn = document.getElementById('resolveBtn');
const resolveLoader = document.getElementById('resolveLoader');
const step2Container = document.getElementById('step2');

const resolvedQuestion = document.getElementById('resolvedQuestion');
const marketBadges = document.getElementById('marketBadges');
const outcomeButtons = document.getElementById('outcomeButtons');

const obMidPrice = document.getElementById('obMidPrice');
const obBidsList = document.getElementById('obBidsList');
const obAsksList = document.getElementById('obAsksList');

const alarmTypeSelect = document.getElementById('alarmType');
const thresholdValueInput = document.getElementById('thresholdValue');
const thresholdLabel = document.getElementById('thresholdLabel');
const thresholdSuffix = document.getElementById('thresholdSuffix');
const chatIdInput = document.getElementById('chatId');

const saveAlarmBtn = document.getElementById('saveAlarmBtn');
const testTelegramBtn = document.getElementById('testTelegramBtn');

const alarmCountBadge = document.getElementById('alarmCount');
const alarmsList = document.getElementById('alarmsList');
const logsList = document.getElementById('logsList');
const clearLogsBtn = document.getElementById('clearLogsBtn');

const toastElement = document.getElementById('toast');
const toastIcon = document.getElementById('toastIcon');
const toastMessage = document.getElementById('toastMessage');

// Event Listeners
window.addEventListener('DOMContentLoaded', () => {
  // Load initial settings
  fetchAlarms();
  fetchLogs();
  fetchSystemStatus();
  
  // Set up periodic logs and alarms updates
  setInterval(fetchAlarms, 10000);
  setInterval(fetchLogs, 10000);
  setInterval(fetchSystemStatus, 15000);

  // Auto-fill Chat ID from localStorage if exists
  const savedChatId = localStorage.getItem('tg_chat_id');
  if (savedChatId) {
    chatIdInput.value = savedChatId;
  }
});

// Detect paste or direct input on URL
marketUrlInput.addEventListener('paste', (e) => {
  // Use setTimeout to let the paste complete and value populate in input
  setTimeout(() => {
    handleResolve();
  }, 100);
});

marketUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleResolve();
  }
});

resolveBtn.addEventListener('click', handleResolve);

// Handle Resolve
async function handleResolve() {
  const urlOrSlug = marketUrlInput.value.trim();
  if (!urlOrSlug) {
    showToast('Lütfen geçerli bir Polymarket linki veya slug girin.', 'error');
    return;
  }

  // Clear existing polling
  if (orderbookPollInterval) {
    clearInterval(orderbookPollInterval);
    orderbookPollInterval = null;
  }

  showLoader(true);
  step2Container.classList.add('hidden');

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urlOrSlug })
    });

    const data = await response.json();

    if (!data.success || !data.markets || data.markets.length === 0) {
      throw new Error(data.error || 'Market çözümlenemedi.');
    }

    // Use the first resolved market
    currentMarket = data.markets[0];
    currentOutcome = 'yes'; // Default to YES
    
    // Set initial token ID
    if (currentMarket.clobTokenIds && currentMarket.clobTokenIds.length > 0) {
      currentTokenId = currentMarket.clobTokenIds[0]; // YES token ID
    } else {
      throw new Error('Market için CLOB token ID\'leri bulunamadı.');
    }

    renderMarketDetails();
    await fetchAndRenderOrderbook();
    
    // Set default threshold price to YES price
    if (currentMarket.prices && currentMarket.prices[0] !== undefined) {
      thresholdValueInput.value = currentMarket.prices[0].toFixed(2);
    } else {
      thresholdValueInput.value = '0.50';
    }

    // Set up polling for orderbook (every 5 seconds while editing/viewing)
    orderbookPollInterval = setInterval(fetchAndRenderOrderbook, 5000);

    showLoader(false);
    step2Container.classList.remove('hidden');
    showToast('Market başarıyla çözümlendi!', 'success');
  } catch (err) {
    showLoader(false);
    showToast(err.message, 'error');
  }
}

// Render Resolved Market Details
function renderMarketDetails() {
  resolvedQuestion.textContent = currentMarket.question;
  
  // Render badges
  marketBadges.innerHTML = `
    <span class="badge purple-badge">Slug: ${currentMarket.slug}</span>
    <span class="badge">Hacim: $${Math.round(currentMarket.volume).toLocaleString()}</span>
    <span class="badge">Likidite: $${Math.round(currentMarket.liquidity).toLocaleString()}</span>
  `;

  // Render YES / NO outcome selection buttons
  const prices = currentMarket.prices || [0.5, 0.5];
  const yesPrice = prices[0] ? prices[0].toFixed(2) : '--';
  const noPrice = prices[1] ? prices[1].toFixed(2) : '--';

  outcomeButtons.innerHTML = `
    <button type="button" class="outcome-btn active" data-outcome="yes">
      <span>YES (Evet)</span>
      <span class="outcome-price">${yesPrice}$</span>
    </button>
    <button type="button" class="outcome-btn" data-outcome="no">
      <span>NO (Hayır)</span>
      <span class="outcome-price">${noPrice}$</span>
    </button>
  `;

  // Handle outcome selection switch
  const buttons = outcomeButtons.querySelectorAll('.outcome-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const selectedOutcome = btn.getAttribute('data-outcome');
      if (selectedOutcome === currentOutcome) return;

      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      currentOutcome = selectedOutcome;
      
      if (currentOutcome === 'yes') {
        currentTokenId = currentMarket.clobTokenIds[0];
        if (currentMarket.prices && currentMarket.prices[0] !== undefined) {
          thresholdValueInput.value = currentMarket.prices[0].toFixed(2);
        }
      } else {
        currentTokenId = currentMarket.clobTokenIds[1];
        if (currentMarket.prices && currentMarket.prices[1] !== undefined) {
          thresholdValueInput.value = currentMarket.prices[1].toFixed(2);
        }
      }

      showToast(`${currentOutcome.toUpperCase()} seçeneği seçildi.`, 'info');
      
      // Immediately fetch new orderbook
      await fetchAndRenderOrderbook();
    });
  });
}

// Fetch and Render Orderbook
async function fetchAndRenderOrderbook() {
  if (!currentTokenId) return;

  try {
    const response = await fetch('/api/orderbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId: currentTokenId })
    });

    const data = await response.json();
    if (!data.success || !data.book) {
      throw new Error(data.error || 'Sipariş defteri yüklenemedi.');
    }

    renderOrderbook(data.book);
  } catch (err) {
    console.error('Orderbook error:', err.message);
    obBidsList.innerHTML = `<div class="ob-empty">Hata: ${err.message}</div>`;
    obAsksList.innerHTML = `<div class="ob-empty">Hata: ${err.message}</div>`;
  }
}

// Render Orderbook inside Bids and Asks lists
function renderOrderbook(book) {
  const bids = book.bids || [];
  const asks = book.asks || [];
  const midPrice = book.midPrice || '--';
  
  obMidPrice.textContent = `Orta Fiyat: ${midPrice}$`;

  // Find max size to calculate relative percentage bar
  const allSizes = [...bids.map(b => b.size), ...asks.map(a => a.size)];
  const maxSize = allSizes.length > 0 ? Math.max(...allSizes) : 1;

  const wallSharesThreshold = getWallThresholdShares();

  // 1. Render Bids (Buy orders)
  if (bids.length === 0) {
    obBidsList.innerHTML = '<div class="ob-empty">Alış emri yok</div>';
  } else {
    obBidsList.innerHTML = bids.slice(0, 15).map(bid => {
      const percentage = (bid.size / maxSize) * 100;
      const isWall = bid.size >= wallSharesThreshold;
      const wallClass = isWall ? 'has-wall' : '';
      const wallIcon = isWall ? '<i class="fa-solid fa-whale"></i> ' : '';

      return `
        <div class="ob-row ${wallClass}" data-price="${bid.price.toFixed(2)}">
          <div class="ob-row-bar" style="width: ${percentage}%"></div>
          <span class="ob-row-price">${bid.price.toFixed(2)}$</span>
          <span class="ob-row-size">${wallIcon}${Math.round(bid.size).toLocaleString()}</span>
        </div>
      `;
    }).join('');
  }

  // 2. Render Asks (Sell orders)
  if (asks.length === 0) {
    obAsksList.innerHTML = '<div class="ob-empty">Satış emri yok</div>';
  } else {
    obAsksList.innerHTML = asks.slice(0, 15).map(ask => {
      const percentage = (ask.size / maxSize) * 100;
      const isWall = ask.size >= wallSharesThreshold;
      const wallClass = isWall ? 'has-wall' : '';
      const wallIcon = isWall ? '<i class="fa-solid fa-whale"></i> ' : '';

      return `
        <div class="ob-row ${wallClass}" data-price="${ask.price.toFixed(2)}">
          <div class="ob-row-bar" style="width: ${percentage}%"></div>
          <span class="ob-row-price">${ask.price.toFixed(2)}$</span>
          <span class="ob-row-size">${wallIcon}${Math.round(ask.size).toLocaleString()}</span>
        </div>
      `;
    }).join('');
  }

  // Click handler to pre-fill threshold limit input
  const obRows = document.querySelectorAll('.ob-row');
  obRows.forEach(row => {
    row.addEventListener('click', () => {
      const price = row.getAttribute('data-price');
      thresholdValueInput.value = price;
      
      // Flash threshold input green to show interaction
      thresholdValueInput.style.borderColor = 'var(--green)';
      thresholdValueInput.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.3)';
      setTimeout(() => {
        thresholdValueInput.style.borderColor = 'var(--purple)';
        thresholdValueInput.style.boxShadow = 'none';
      }, 1000);

      showToast(`Alarm fiyat hedefi ${price}$ olarak güncellendi.`, 'info');
    });
  });
}

// Adjust labels and values depending on alarm type selection
alarmTypeSelect.addEventListener('change', () => {
  const type = alarmTypeSelect.value;
  
  if (type === 'price_above' || type === 'price_below') {
    thresholdLabel.textContent = 'Fiyat Limiti ($)';
    thresholdSuffix.textContent = '$';
    thresholdValueInput.step = '0.01';
    thresholdValueInput.placeholder = '0.25';
    // Reset to current option price
    const idx = currentOutcome === 'yes' ? 0 : 1;
    if (currentMarket && currentMarket.prices && currentMarket.prices[idx] !== undefined) {
      thresholdValueInput.value = currentMarket.prices[idx].toFixed(2);
    }
  } 
  else if (type === 'wall_created') {
    thresholdLabel.textContent = 'Minimum Duvar Boyutu (Shares)';
    thresholdSuffix.textContent = 'Adet';
    thresholdValueInput.step = '1000';
    thresholdValueInput.value = '5000';
    thresholdValueInput.placeholder = '5000';
  } 
  else if (type === 'liquidity_surge') {
    thresholdLabel.textContent = 'Kalınlaşma Oranı (%)';
    thresholdSuffix.textContent = '%';
    thresholdValueInput.step = '5';
    thresholdValueInput.value = '50';
    thresholdValueInput.placeholder = '50';
  }
});

// Create Alarm
saveAlarmBtn.addEventListener('click', async () => {
  if (!currentMarket || !currentTokenId) {
    showToast('Öncelikle bir Polymarket linki çözümlemelisiniz.', 'error');
    return;
  }

  const threshold = Number(thresholdValueInput.value);
  const chatId = chatIdInput.value.trim();

  if (isNaN(threshold) || threshold <= 0) {
    showToast('Lütfen geçerli bir limit değeri girin.', 'error');
    return;
  }

  if (!chatId) {
    showToast('Lütfen bildirimlerin iletileceği Telegram Chat ID\'sini girin.', 'error');
    return;
  }

  // Save Chat ID to localStorage for convenience
  localStorage.setItem('tg_chat_id', chatId);

  const payload = {
    url: currentMarket.originalUrl,
    slug: currentMarket.slug,
    marketId: currentMarket.marketId,
    title: currentMarket.question,
    outcome: currentOutcome,
    tokenId: currentTokenId,
    alarmType: alarmTypeSelect.value,
    threshold,
    chatId
  };

  try {
    const response = await fetch('/api/alarms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    showToast('Alarm başarıyla kuruldu ve arka planda çalıştırıldı!', 'success');
    
    // Clear inputs and state
    marketUrlInput.value = '';
    step2Container.classList.add('hidden');
    currentMarket = null;
    currentTokenId = null;
    if (orderbookPollInterval) {
      clearInterval(orderbookPollInterval);
      orderbookPollInterval = null;
    }

    // Refresh alarms list
    fetchAlarms();
    fetchLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Test Telegram Button
testTelegramBtn.addEventListener('click', async () => {
  const chatId = chatIdInput.value.trim();
  if (!chatId) {
    showToast('Test etmek için bir Telegram Chat ID girin.', 'error');
    return;
  }

  // Save to storage
  localStorage.setItem('tg_chat_id', chatId);

  try {
    const response = await fetch('/api/test-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    showToast('Telegram test mesajı gönderildi! Grubunuzu kontrol edin.', 'success');
    fetchLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Helper to determine wall size threshold based on input
function getWallThresholdShares() {
  if (alarmTypeSelect.value === 'wall_created') {
    const inputVal = Number(thresholdValueInput.value);
    if (!isNaN(inputVal) && inputVal > 0) return inputVal;
  }
  return 5000; // Default 5000 shares
}

// Fetch and Render Alarms List
async function fetchAlarms() {
  try {
    const response = await fetch('/api/alarms');
    const alarms = await response.json();

    alarmCountBadge.textContent = alarms.length;

    if (alarms.length === 0) {
      alarmsList.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-shield-cat"></i>
          <p>Şu an kurulu bir alarm bulunmuyor.</p>
        </div>
      `;
      return;
    }

    alarmsList.innerHTML = alarms.map(alarm => {
      const statusClass = alarm.active ? 'active' : 'inactive';
      const statusIcon = alarm.active ? 'fa-bell-slash' : 'fa-bell';
      const statusTitle = alarm.active ? 'Pasifleştir' : 'Aktifleştir';
      
      let typeText = '';
      let targetSuffix = '';
      
      switch (alarm.alarmType) {
        case 'price_above':
          typeText = 'Fiyat Üzeri 📈';
          targetSuffix = '$';
          break;
        case 'price_below':
          typeText = 'Fiyat Altı 📉';
          targetSuffix = '$';
          break;
        case 'wall_created':
          typeText = 'Yeni Duvar 🐳';
          targetSuffix = ' Adet';
          break;
        case 'liquidity_surge':
          typeText = 'Likidite Artış 🌊';
          targetSuffix = '%';
          break;
      }

      return `
        <div class="alarm-card ${statusClass}">
          <div class="alarm-card-header">
            <div class="alarm-card-title">${alarm.title}</div>
            <div class="alarm-card-actions">
              <button class="alarm-action-btn toggle-btn" onclick="toggleAlarm('${alarm.id}')" title="${statusTitle}">
                <i class="fa-solid ${statusIcon}"></i>
              </button>
              <button class="alarm-action-btn delete-btn" onclick="deleteAlarm('${alarm.id}')" title="Sil">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
          <div class="alarm-card-body">
            <span class="alarm-badge ${alarm.outcome}">${alarm.outcome.toUpperCase()}</span>
            <span class="alarm-badge type">${typeText}</span>
            <span class="alarm-badge target">Hedef: ${alarm.threshold}${targetSuffix}</span>
          </div>
          <div class="alarm-card-footer">
            <span><i class="fa-brands fa-telegram"></i> ID: ${alarm.chatId}</span>
            <span><i class="fa-solid fa-clock"></i> ${new Date(alarm.createdAt).toLocaleDateString('tr-TR')}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching alarms:', err.message);
  }
}

// Global actions called from HTML onClick
window.deleteAlarm = async function(id) {
  if (!confirm('Bu alarmı silmek istediğinize emin misiniz?')) return;

  try {
    const response = await fetch(`/api/alarms/${id}`, { method: 'DELETE' });
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    showToast('Alarm silindi.', 'success');
    fetchAlarms();
    fetchLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.toggleAlarm = async function(id) {
  try {
    const response = await fetch(`/api/alarms/${id}/toggle`, { method: 'POST' });
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    showToast(`Alarm ${data.active ? 'aktifleştirildi' : 'pasifleştirildi'}.`, 'success');
    fetchAlarms();
    fetchLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Fetch and Render Log history
async function fetchLogs() {
  try {
    const response = await fetch('/api/logs');
    const logs = await response.json();

    if (logs.length === 0) {
      logsList.innerHTML = '<div class="ob-empty">Kayıtlı bildirim yok.</div>';
      return;
    }

    logsList.innerHTML = logs.map(log => {
      let typeClass = 'system';
      if (log.message.includes('[ALARM TETİKLENDİ]')) {
        typeClass = 'alert';
      } else if (log.message.includes('Hata') || log.message.includes('Failed')) {
        typeClass = 'error';
      }

      const time = new Date(log.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `
        <div class="log-item ${typeClass}">
          <span class="time">${time}</span> ${log.message}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching logs:', err.message);
  }
}

// Fetch System Status
async function fetchSystemStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    
    const indicator = document.getElementById('systemStatus').querySelector('.status-indicator');
    const statusText = document.getElementById('systemStatus').querySelector('.status-text');

    if (status.telegramConfigured) {
      indicator.className = 'status-indicator online';
      statusText.textContent = `Bot Aktif (${status.activeAlarmsCount} Takip)`;
    } else {
      indicator.className = 'status-indicator offline';
      statusText.textContent = 'Token Eksik (Railway Env)';
    }
  } catch (err) {
    const indicator = document.getElementById('systemStatus').querySelector('.status-indicator');
    const statusText = document.getElementById('systemStatus').querySelector('.status-text');
    indicator.className = 'status-indicator offline';
    statusText.textContent = 'Server Bağlantı Hatası';
  }
}

// UI Helpers
function showLoader(visible) {
  if (visible) {
    resolveLoader.classList.remove('hidden');
  } else {
    resolveLoader.classList.add('hidden');
  }
}

function showToast(message, type = 'success') {
  toastMessage.textContent = message;
  toastElement.className = `toast ${type}`;
  
  let iconHtml = '<i class="fa-solid fa-circle-check"></i>';
  if (type === 'error') {
    iconHtml = '<i class="fa-solid fa-triangle-exclamation"></i>';
  } else if (type === 'info') {
    iconHtml = '<i class="fa-solid fa-info-circle"></i>';
  }
  toastIcon.innerHTML = iconHtml;

  toastElement.classList.remove('hidden');

  // Auto-hide after 3 seconds
  setTimeout(() => {
    toastElement.classList.add('hidden');
  }, 4000);
}
