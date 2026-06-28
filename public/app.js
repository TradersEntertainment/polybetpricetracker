// ─── State ───
let currentMarket = null;
let currentOutcome = 'yes';
let currentTokenId = null;
let orderbookPollInterval = null;
let editingAlarmId = null;
let lastBookData = null;

// ─── DOM ───
const $ = id => document.getElementById(id);
const marketUrlInput = $('marketUrl');
const resolveBtn = $('resolveBtn');
const resolveLoader = $('resolveLoader');
const marketBar = $('marketBar');
const orderbookSection = $('orderbookSection');
const resolvedQuestion = $('resolvedQuestion');
const marketBadges = $('marketBadges');
const outcomeButtons = $('outcomeButtons');
const obMidPrice = $('obMidPrice');
const obBidsList = $('obBidsList');
const obAsksList = $('obAsksList');
const thresholdValueInput = $('thresholdValue');
const chatIdInput = $('chatId');
const saveAlarmBtn = $('saveAlarmBtn');
const testTelegramBtn = $('testTelegramBtn');
const alarmCountBadge = $('alarmCount');
const alarmsList = $('alarmsList');
const logsList = $('logsList');
const toastEl = $('toast');
const toastIcon = $('toastIcon');
const toastMsg = $('toastMessage');
const depthCanvas = $('depthChart');

// Edit Modal
const editModal = $('editModal');
const editModalClose = $('editModalClose');
const editCancelBtn = $('editCancelBtn');
const editSaveBtn = $('editSaveBtn');
const editTitle = $('editTitle');
const editOutcomeBtns = $('editOutcomeBtns');
const editTypeCards = $('editTypeCards');
const editThresholdValue = $('editThresholdValue');
const editThresholdLabel = $('editThresholdLabel');
const editThresholdSuffix = $('editThresholdSuffix');
const editChatId = $('editChatId');

// ─── Init ───
window.addEventListener('DOMContentLoaded', () => {
  fetchAlarms();
  fetchLogs();
  fetchSystemStatus();
  setInterval(fetchAlarms, 10000);
  setInterval(fetchLogs, 10000);
  setInterval(fetchSystemStatus, 15000);

  const savedChat = localStorage.getItem('tg_chat_id');
  if (savedChat) chatIdInput.value = savedChat;

  // Settings toggle panels
  document.querySelectorAll('.settings-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = $(btn.dataset.target);
      if (panel) panel.classList.toggle('hidden');
    });
  });

  // Toggle card active states based on checkbox state
  const bindCheckboxActiveState = (checkboxId) => {
    const cb = $(checkboxId);
    if (cb) {
      const updateClass = () => {
        const card = cb.closest('.alert-option');
        if (card) card.classList.toggle('active', cb.checked);
      };
      cb.addEventListener('change', updateClass);
      updateClass();
    }
  };
  bindCheckboxActiveState('togPriceAlert');
  bindCheckboxActiveState('togWall');
  bindCheckboxActiveState('togLiquidity');

  // Edit modal: type cards
  editTypeCards.addEventListener('click', e => {
    const item = e.target.closest('.mt-item');
    if (!item) return;
    editTypeCards.querySelectorAll('.mt-item').forEach(c => c.classList.remove('selected'));
    item.classList.add('selected');
    updateEditThresholdUI(item.dataset.type);
  });

  // Edit modal: outcome buttons
  editOutcomeBtns.addEventListener('click', e => {
    const btn = e.target.closest('.mo-btn');
    if (!btn) return;
    editOutcomeBtns.querySelectorAll('.mo-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  editModalClose.addEventListener('click', closeEditModal);
  editCancelBtn.addEventListener('click', closeEditModal);
  editModal.addEventListener('click', e => { if (e.target === editModal) closeEditModal(); });
  editSaveBtn.addEventListener('click', handleEditSave);
});

// ─── URL Events ───
marketUrlInput.addEventListener('paste', () => setTimeout(handleResolve, 100));
marketUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleResolve(); });
resolveBtn.addEventListener('click', handleResolve);

// ─── Resolve ───
async function handleResolve() {
  const url = marketUrlInput.value.trim();
  if (!url) return showToast('Polymarket linki yapıştırın.', 'error');

  if (orderbookPollInterval) { clearInterval(orderbookPollInterval); orderbookPollInterval = null; }
  resolveLoader.classList.remove('hidden');
  marketBar.classList.add('hidden');
  orderbookSection.classList.add('hidden');

  try {
    const res = await fetch('/api/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urlOrSlug: url })
    });
    const data = await res.json();
    if (!data.success || !data.markets?.length) throw new Error(data.error || 'Market bulunamadı.');

    currentMarket = data.markets[0];
    currentOutcome = 'yes';
    currentTokenId = currentMarket.clobTokenIds?.[0];
    if (!currentTokenId) throw new Error('Token ID bulunamadı.');

    renderMarketBar();
    await fetchAndRenderOrderbook();

    // Set default threshold
    if (currentMarket.prices?.[0] !== undefined) {
      thresholdValueInput.value = currentMarket.prices[0].toFixed(2);
    }

    orderbookPollInterval = setInterval(fetchAndRenderOrderbook, 5000);
    resolveLoader.classList.add('hidden');
    marketBar.classList.remove('hidden');
    orderbookSection.classList.remove('hidden');
    showToast('Market çözümlendi!', 'success');
  } catch (err) {
    resolveLoader.classList.add('hidden');
    showToast(err.message, 'error');
  }
}

// ─── Market Bar ───
function renderMarketBar() {
  resolvedQuestion.textContent = currentMarket.question;
  const vol = Math.round(currentMarket.volume).toLocaleString();
  const liq = Math.round(currentMarket.liquidity).toLocaleString();
  const p = currentMarket.prices || [0.5, 0.5];

  marketBadges.innerHTML = `
    <span><span class="stat-label">Volume:</span> <span class="stat-val">$${vol}</span></span>
    <span><span class="stat-label">Liquidity:</span> <span class="stat-val">$${liq}</span></span>
  `;

  outcomeButtons.innerHTML = `
    <div class="outcome-pill yes active" data-outcome="yes">
      <span class="oc-label">YES</span>
      <span class="oc-price">$${p[0]?.toFixed(2) || '--'}</span>
      <span class="oc-arrow">↑</span>
    </div>
    <div class="outcome-pill no" data-outcome="no">
      <span class="oc-label">NO</span>
      <span class="oc-price">$${p[1]?.toFixed(2) || '--'}</span>
      <span class="oc-arrow">↓</span>
    </div>
  `;

  outcomeButtons.querySelectorAll('.outcome-pill').forEach(pill => {
    pill.addEventListener('click', async () => {
      const oc = pill.dataset.outcome;
      if (oc === currentOutcome) return;
      outcomeButtons.querySelectorAll('.outcome-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentOutcome = oc;
      currentTokenId = currentMarket.clobTokenIds[oc === 'yes' ? 0 : 1];
      const idx = oc === 'yes' ? 0 : 1;
      if (currentMarket.prices?.[idx] !== undefined) {
        thresholdValueInput.value = currentMarket.prices[idx].toFixed(2);
      }
      await fetchAndRenderOrderbook();
    });
  });
}

// ─── Orderbook ───
async function fetchAndRenderOrderbook() {
  if (!currentTokenId) return;
  try {
    const res = await fetch('/api/orderbook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId: currentTokenId })
    });
    const data = await res.json();
    if (!data.success || !data.book) throw new Error(data.error || 'Orderbook yüklenemedi.');
    lastBookData = data.book;
    renderOrderbook(data.book);
    renderDepthChart(data.book);
  } catch (err) {
    obBidsList.innerHTML = `<div class="ob-empty">Hata: ${err.message}</div>`;
    obAsksList.innerHTML = `<div class="ob-empty">Hata</div>`;
  }
}

function renderOrderbook(book) {
  const bids = book.bids || [];
  const asks = book.asks || [];
  const spread = book.spread != null ? book.spread.toFixed(3) : '--';
  const mid = book.midPrice || '--';
  obMidPrice.textContent = `Mid: ${mid}$ | Spread: ${spread}$`;

  const wallT = getWallThreshold();

  obBidsList.innerHTML = bids.length === 0 ? '<div class="ob-empty">Yok</div>' :
    bids.slice(0, 20).map(b => {
      const w = b.size >= wallT ? 'wall' : '';
      return `<div class="ob-row ${w}" data-price="${b.price.toFixed(2)}">
        <span class="ob-price">${b.price.toFixed(2)}$</span>
        <span class="ob-vol">${w ? '🐳 ' : ''}${Math.round(b.size).toLocaleString()}</span>
      </div>`;
    }).join('');

  obAsksList.innerHTML = asks.length === 0 ? '<div class="ob-empty">Yok</div>' :
    asks.slice(0, 20).map(a => {
      const w = a.size >= wallT ? 'wall' : '';
      return `<div class="ob-row ${w}" data-price="${a.price.toFixed(2)}">
        <span class="ob-price">${a.price.toFixed(2)}$</span>
        <span class="ob-vol">${w ? '🐳 ' : ''}${Math.round(a.size).toLocaleString()}</span>
      </div>`;
    }).join('');

  // Click rows to fill threshold
  document.querySelectorAll('.ob-row').forEach(row => {
    row.addEventListener('click', () => {
      const p = row.dataset.price;
      thresholdValueInput.value = p;
      showToast(`Hedef: ${p}$`, 'info');
    });
  });
}

// ─── Depth Chart (Canvas) ───
function renderDepthChart(book) {
  const canvas = depthCanvas;
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const bids = (book.bids || []).slice(0, 25);
  const asks = (book.asks || []).slice(0, 25);
  if (bids.length === 0 && asks.length === 0) return;

  // Build cumulative arrays
  let bidCum = [], askCum = [];
  let cumBid = 0;
  for (let i = 0; i < bids.length; i++) {
    cumBid += bids[i].size;
    bidCum.push({ price: bids[i].price, cum: cumBid });
  }
  let cumAsk = 0;
  for (let i = 0; i < asks.length; i++) {
    cumAsk += asks[i].size;
    askCum.push({ price: asks[i].price, cum: cumAsk });
  }

  const maxCum = Math.max(cumBid, cumAsk, 1);
  const allPrices = [...bidCum.map(b => b.price), ...askCum.map(a => a.price)];
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice || 0.01;

  const pad = { top: 15, bottom: 25, left: 10, right: 10 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  function priceToX(price) { return pad.left + ((price - minPrice) / priceRange) * cw; }
  function cumToY(cum) { return pad.top + ch - (cum / maxCum) * ch; }

  // Draw grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  // Price labels
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '10px "JetBrains Mono"';
  ctx.textAlign = 'center';
  const labelCount = 5;
  for (let i = 0; i <= labelCount; i++) {
    const price = minPrice + (priceRange / labelCount) * i;
    const x = priceToX(price);
    ctx.fillText(price.toFixed(2) + '$', x, h - 5);
  }

  // Draw bid area (green, right-to-left step)
  if (bidCum.length > 1) {
    ctx.beginPath();
    ctx.moveTo(priceToX(bidCum[0].price), cumToY(0));
    for (let i = 0; i < bidCum.length; i++) {
      const x = priceToX(bidCum[i].price);
      const y = cumToY(bidCum[i].cum);
      if (i > 0) {
        ctx.lineTo(x, cumToY(bidCum[i - 1].cum)); // horizontal step
      }
      ctx.lineTo(x, y);
    }
    // Fill
    const lastBid = bidCum[bidCum.length - 1];
    ctx.lineTo(priceToX(lastBid.price), cumToY(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(priceToX(bidCum[0].price), cumToY(0));
    for (let i = 0; i < bidCum.length; i++) {
      const x = priceToX(bidCum[i].price);
      const y = cumToY(bidCum[i].cum);
      if (i > 0) ctx.lineTo(x, cumToY(bidCum[i - 1].cum));
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Draw ask area (red, left-to-right step)
  if (askCum.length > 1) {
    ctx.beginPath();
    ctx.moveTo(priceToX(askCum[0].price), cumToY(0));
    for (let i = 0; i < askCum.length; i++) {
      const x = priceToX(askCum[i].price);
      const y = cumToY(askCum[i].cum);
      if (i > 0) ctx.lineTo(x, cumToY(askCum[i - 1].cum));
      ctx.lineTo(x, y);
    }
    const lastAsk = askCum[askCum.length - 1];
    ctx.lineTo(priceToX(lastAsk.price), cumToY(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(priceToX(askCum[0].price), cumToY(0));
    for (let i = 0; i < askCum.length; i++) {
      const x = priceToX(askCum[i].price);
      const y = cumToY(askCum[i].cum);
      if (i > 0) ctx.lineTo(x, cumToY(askCum[i - 1].cum));
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// Resize depth chart
window.addEventListener('resize', () => {
  if (lastBookData) renderDepthChart(lastBookData);
});

function getWallThreshold() {
  const togWall = $('togWall');
  if (togWall && togWall.checked) {
    const v = Number($('wallThreshold')?.value);
    if (!isNaN(v) && v > 0) return v;
  }
  return 5000;
}

// ─── Save Alarm ───
saveAlarmBtn.addEventListener('click', async () => {
  if (!currentMarket || !currentTokenId) return showToast('Önce bir market çözümleyin.', 'error');

  const chatId = chatIdInput.value.trim();
  localStorage.setItem('tg_chat_id', chatId);

  // Create alarms for each checked type
  const types = [];
  
  if ($('togPriceAlert')?.checked) {
    const targetVal = Number(thresholdValueInput.value);
    if (isNaN(targetVal) || targetVal <= 0) {
      return showToast('Geçerli bir hedef fiyat girin.', 'error');
    }
    
    // Get current price to determine direction
    let currentPrice = 0.50;
    if (lastBookData && lastBookData.midPrice) {
      currentPrice = lastBookData.midPrice;
    } else {
      const idx = currentOutcome === 'yes' ? 0 : 1;
      if (currentMarket.prices?.[idx] !== undefined) {
        currentPrice = currentMarket.prices[idx];
      }
    }
    
    const isAbove = targetVal >= currentPrice;
    const refType = $('priceRefType')?.value || 'bid_ask';
    
    let direction = 'bid_above';
    if (refType === 'mid') {
      direction = isAbove ? 'price_above' : 'price_below';
    } else {
      direction = isAbove ? 'bid_above' : 'ask_below';
    }
    
    types.push({ type: direction, threshold: targetVal });
  }

  if ($('togWall')?.checked) types.push({ type: 'wall_created', threshold: Number($('wallThreshold')?.value || 5000) });
  if ($('togLiquidity')?.checked) types.push({ type: 'liquidity_surge', threshold: Number($('liquidityThreshold')?.value || 50) });

  if (types.length === 0) return showToast('En az bir alarm türünü açın.', 'error');

  let created = 0;
  for (const t of types) {
    if (isNaN(t.threshold) || t.threshold <= 0) continue;
    try {
      const res = await fetch('/api/alarms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentMarket.originalUrl, slug: currentMarket.slug,
          marketId: currentMarket.marketId, title: currentMarket.question,
          outcome: currentOutcome, tokenId: currentTokenId,
          alarmType: t.type, threshold: t.threshold, chatId
        })
      });
      const data = await res.json();
      if (!data.error) created++;
    } catch (e) { console.error(e); }
  }

  if (created > 0) {
    showToast(`${created} alarm kuruldu!`, 'success');
    fetchAlarms();
    fetchLogs();
  } else {
    showToast('Alarm oluşturulamadı.', 'error');
  }
});

// ─── Test Telegram ───
testTelegramBtn.addEventListener('click', async () => {
  const chatId = chatIdInput.value.trim();
  if (!chatId) return showToast('Chat ID girin.', 'error');
  localStorage.setItem('tg_chat_id', chatId);
  try {
    const res = await fetch('/api/test-telegram', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Test mesajı gönderildi!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
});

// ═══════════════════════════
// ─── ALARMS LIST ──────────
// ═══════════════════════════
async function fetchAlarms() {
  try {
    const res = await fetch('/api/alarms');
    const alarms = await res.json();
    alarmCountBadge.textContent = alarms.length;

    if (!alarms.length) {
      alarmsList.innerHTML = `<div class="empty-msg"><i class="fa-regular fa-bell-slash"></i> Henüz alarm yok</div>`;
      return;
    }

    alarmsList.innerHTML = alarms.map(a => {
      const cls = a.active ? '' : 'inactive';
      const togIcon = a.active ? 'fa-pause' : 'fa-play';
      const { kind, suffix } = alarmMeta(a.alarmType);
      return `<div class="alarm-row ${cls}" data-alarm-id="${a.id}">
        <span class="alarm-row-title" title="${a.title}">${a.title}</span>
        <div class="alarm-row-tags">
          <span class="atag ${a.outcome}">${a.outcome.toUpperCase()}</span>
          <span class="atag val">${a.threshold}${suffix}</span>
        </div>
        <div class="alarm-row-actions">
          <button onclick="event.stopPropagation(); toggleAlarm('${a.id}')" title="${a.active ? 'Durdur' : 'Başlat'}"><i class="fa-solid ${togIcon}"></i></button>
          <button class="del" onclick="event.stopPropagation(); deleteAlarm('${a.id}')" title="Sil"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');

    // Click alarm → edit modal
    alarmsList.querySelectorAll('.alarm-row').forEach(row => {
      row.addEventListener('click', () => {
        const alarm = alarms.find(a => a.id === row.dataset.alarmId);
        if (alarm) openEditModal(alarm);
      });
    });
  } catch (err) { console.error('Alarms error:', err); }
}

function alarmMeta(type) {
  const map = {
    bid_above: { kind: 'Yükselirse 📈', suffix: '$' },
    ask_below: { kind: 'Düşerse 📉', suffix: '$' },
    price_above: { kind: 'Mid↑', suffix: '$' },
    price_below: { kind: 'Mid↓', suffix: '$' },
    wall_created: { kind: 'Duvar 🐳', suffix: ' Adet' },
    liquidity_surge: { kind: 'Likidite 🌊', suffix: '%' },
  };
  return map[type] || { kind: type, suffix: '' };
}

// ═══════════════════
// ─── EDIT MODAL ───
// ═══════════════════
function openEditModal(alarm) {
  editingAlarmId = alarm.id;
  editTitle.textContent = alarm.title;

  editOutcomeBtns.querySelectorAll('.mo-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.outcome === alarm.outcome));

  editTypeCards.querySelectorAll('.mt-item').forEach(c =>
    c.classList.toggle('selected', c.dataset.type === alarm.alarmType));

  editThresholdValue.value = alarm.threshold;
  updateEditThresholdUI(alarm.alarmType);
  editChatId.value = alarm.chatId || '';

  editModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  editModal.classList.add('hidden');
  document.body.style.overflow = '';
  editingAlarmId = null;
}

function updateEditThresholdUI(type) {
  if (type === 'bid_above' || type === 'ask_below' || type === 'price_above' || type === 'price_below') {
    editThresholdLabel.textContent = 'Hedef Fiyat';
    editThresholdSuffix.textContent = '$';
    editThresholdValue.step = '0.01';
  } else if (type === 'wall_created') {
    editThresholdLabel.textContent = 'Min. Duvar Boyutu';
    editThresholdSuffix.textContent = 'Adet';
    editThresholdValue.step = '1000';
  } else if (type === 'liquidity_surge') {
    editThresholdLabel.textContent = 'Kalınlaşma Oranı';
    editThresholdSuffix.textContent = '%';
    editThresholdValue.step = '5';
  }
}

async function handleEditSave() {
  if (!editingAlarmId) return;
  const selectedType = editTypeCards.querySelector('.mt-item.selected')?.dataset.type;
  const selectedOutcome = editOutcomeBtns.querySelector('.mo-btn.active')?.dataset.outcome;
  const threshold = Number(editThresholdValue.value);
  const chatId = editChatId.value.trim();

  if (!selectedType) return showToast('Alarm türü seçin.', 'error');
  if (isNaN(threshold) || threshold <= 0) return showToast('Geçerli limit girin.', 'error');

  try {
    const res = await fetch(`/api/alarms/${editingAlarmId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alarmType: selectedType, outcome: selectedOutcome, threshold, chatId })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Alarm güncellendi!', 'success');
    closeEditModal();
    fetchAlarms();
    fetchLogs();
  } catch (err) { showToast(err.message, 'error'); }
}

// ─── Delete & Toggle ───
window.deleteAlarm = async id => {
  if (!confirm('Alarm silinsin mi?')) return;
  try {
    const res = await fetch(`/api/alarms/${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    showToast('Alarm silindi.', 'success');
    fetchAlarms(); fetchLogs();
  } catch (e) { showToast(e.message, 'error'); }
};

window.toggleAlarm = async id => {
  try {
    const res = await fetch(`/api/alarms/${id}/toggle`, { method: 'POST' });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    showToast(`Alarm ${d.active ? 'başlatıldı' : 'durduruldu'}.`, 'success');
    fetchAlarms(); fetchLogs();
  } catch (e) { showToast(e.message, 'error'); }
};

// ─── Logs ───
async function fetchLogs() {
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    if (!logs.length) { logsList.innerHTML = '<div class="empty-msg">Log yok</div>'; return; }
    logsList.innerHTML = logs.slice(0, 40).map(l => {
      let cls = 'sys';
      if (l.message.includes('[ALARM TETİKLENDİ]')) cls = 'alert';
      else if (l.message.includes('Hata')) cls = 'err';
      const t = new Date(l.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="log-line ${cls}"><span class="ts">[${t}]</span> ${l.message}</div>`;
    }).join('');
  } catch (e) { console.error('Logs error:', e); }
}

// ─── System Status ───
async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const s = await res.json();
    const dot = $('systemStatus').querySelector('.status-dot');
    const txt = $('systemStatus').querySelector('.status-label');
    if (s.telegramConfigured) {
      dot.className = 'status-dot online';
      txt.textContent = `Aktif (${s.activeAlarmsCount} takip)`;
    } else {
      dot.className = 'status-dot offline';
      txt.textContent = 'Token eksik';
    }
  } catch {
    const dot = $('systemStatus').querySelector('.status-dot');
    const txt = $('systemStatus').querySelector('.status-label');
    dot.className = 'status-dot offline';
    txt.textContent = 'Offline';
  }
}

// ─── Toast ───
function showToast(msg, type = 'success') {
  toastMsg.textContent = msg;
  toastEl.className = `toast ${type}`;
  const icons = { success: 'fa-circle-check', error: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  toastIcon.innerHTML = `<i class="fa-solid ${icons[type] || icons.success}"></i>`;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), 3500);
}
