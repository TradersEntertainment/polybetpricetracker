// ─── State ───
let currentMarket = null;
let currentOutcome = 'yes';
let currentTokenId = null;
let orderbookPollInterval = null;
let selectedAlarmType = 'bid_above';
let editingAlarmId = null;

// ─── DOM ───
const $ = id => document.getElementById(id);
const marketUrlInput = $('marketUrl');
const resolveBtn = $('resolveBtn');
const resolveLoader = $('resolveLoader');
const step2 = $('step2');
const resolvedQuestion = $('resolvedQuestion');
const marketBadges = $('marketBadges');
const outcomeButtons = $('outcomeButtons');
const obMidPrice = $('obMidPrice');
const obBidsList = $('obBidsList');
const obAsksList = $('obAsksList');
const thresholdValueInput = $('thresholdValue');
const thresholdLabel = $('thresholdLabel');
const thresholdSuffix = $('thresholdSuffix');
const chatIdInput = $('chatId');
const saveAlarmBtn = $('saveAlarmBtn');
const testTelegramBtn = $('testTelegramBtn');
const alarmCountBadge = $('alarmCount');
const alarmsList = $('alarmsList');
const logsList = $('logsList');
const toastEl = $('toast');
const toastIcon = $('toastIcon');
const toastMsg = $('toastMessage');

// Edit Modal DOM
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

  // Alarm type card clicks (create form)
  document.querySelectorAll('#alarmTypeCards .alarm-type-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#alarmTypeCards .alarm-type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedAlarmType = card.dataset.type;
      updateThresholdUI();
    });
  });

  // Edit modal type cards
  editTypeCards.addEventListener('click', e => {
    const card = e.target.closest('.alarm-type-card-mini');
    if (!card) return;
    editTypeCards.querySelectorAll('.alarm-type-card-mini').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    updateEditThresholdUI(card.dataset.type);
  });

  // Edit modal outcome buttons
  editOutcomeBtns.addEventListener('click', e => {
    const btn = e.target.closest('.outcome-btn');
    if (!btn) return;
    editOutcomeBtns.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Close modal
  editModalClose.addEventListener('click', closeEditModal);
  editCancelBtn.addEventListener('click', closeEditModal);
  editModal.addEventListener('click', e => { if (e.target === editModal) closeEditModal(); });

  // Save edit
  editSaveBtn.addEventListener('click', handleEditSave);
});

// ─── URL Events ───
marketUrlInput.addEventListener('paste', () => setTimeout(handleResolve, 100));
marketUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleResolve(); });
resolveBtn.addEventListener('click', handleResolve);

// ─── Resolve Market ───
async function handleResolve() {
  const url = marketUrlInput.value.trim();
  if (!url) return showToast('Lütfen Polymarket linki yapıştırın.', 'error');

  if (orderbookPollInterval) { clearInterval(orderbookPollInterval); orderbookPollInterval = null; }
  resolveLoader.classList.remove('hidden');
  step2.classList.add('hidden');

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

    renderMarketInfo();
    await fetchAndRenderOrderbook();
    updateThresholdUI();

    orderbookPollInterval = setInterval(fetchAndRenderOrderbook, 5000);
    resolveLoader.classList.add('hidden');
    step2.classList.remove('hidden');
    showToast('Market çözümlendi!', 'success');
  } catch (err) {
    resolveLoader.classList.add('hidden');
    showToast(err.message, 'error');
  }
}

// ─── Market Info ───
function renderMarketInfo() {
  resolvedQuestion.textContent = currentMarket.question;
  const vol = Math.round(currentMarket.volume).toLocaleString();
  const liq = Math.round(currentMarket.liquidity).toLocaleString();
  marketBadges.innerHTML = `
    <span class="meta-tag accent">${currentMarket.slug}</span>
    <span class="meta-tag">Hacim: $${vol}</span>
    <span class="meta-tag">Likidite: $${liq}</span>
  `;

  const p = currentMarket.prices || [0.5, 0.5];
  outcomeButtons.innerHTML = `
    <button type="button" class="outcome-btn active" data-outcome="yes">
      YES <span class="price-tag">${p[0]?.toFixed(2) || '--'}$</span>
    </button>
    <button type="button" class="outcome-btn" data-outcome="no">
      NO <span class="price-tag">${p[1]?.toFixed(2) || '--'}$</span>
    </button>
  `;

  outcomeButtons.querySelectorAll('.outcome-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const oc = btn.dataset.outcome;
      if (oc === currentOutcome) return;
      outcomeButtons.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentOutcome = oc;
      currentTokenId = currentMarket.clobTokenIds[oc === 'yes' ? 0 : 1];
      updateThresholdUI();
      await fetchAndRenderOrderbook();
    });
  });
}

// ─── Threshold UI ───
function updateThresholdUI() {
  const t = selectedAlarmType;
  if (t === 'bid_above' || t === 'ask_below') {
    thresholdLabel.textContent = 'Hedef Fiyat';
    thresholdSuffix.textContent = '$';
    thresholdValueInput.step = '0.01';
    thresholdValueInput.placeholder = '0.25';
    const idx = currentOutcome === 'yes' ? 0 : 1;
    if (currentMarket?.prices?.[idx] !== undefined) {
      thresholdValueInput.value = currentMarket.prices[idx].toFixed(2);
    }
  } else if (t === 'wall_created') {
    thresholdLabel.textContent = 'Minimum Duvar Boyutu';
    thresholdSuffix.textContent = 'Adet';
    thresholdValueInput.step = '1000';
    thresholdValueInput.value = '5000';
    thresholdValueInput.placeholder = '5000';
  } else if (t === 'liquidity_surge') {
    thresholdLabel.textContent = 'Kalınlaşma Oranı';
    thresholdSuffix.textContent = '%';
    thresholdValueInput.step = '5';
    thresholdValueInput.value = '50';
    thresholdValueInput.placeholder = '50';
  }
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
    renderOrderbook(data.book);
  } catch (err) {
    obBidsList.innerHTML = `<div class="ob-empty">Hata: ${err.message}</div>`;
    obAsksList.innerHTML = `<div class="ob-empty">Hata: ${err.message}</div>`;
  }
}

function renderOrderbook(book) {
  const bids = book.bids || [];
  const asks = book.asks || [];
  const spread = book.spread !== null && book.spread !== undefined ? book.spread.toFixed(2) : '--';
  const mid = book.midPrice || '--';
  obMidPrice.textContent = `Mid: ${mid}$ | Spread: ${spread}$`;

  const allSizes = [...bids.map(b => b.size), ...asks.map(a => a.size)];
  const maxSize = allSizes.length > 0 ? Math.max(...allSizes) : 1;
  const wallThreshold = getWallThreshold();

  obBidsList.innerHTML = bids.length === 0 ? '<div class="ob-empty">Alış emri yok</div>' :
    bids.slice(0, 20).map(b => obRowHtml(b, maxSize, wallThreshold)).join('');

  obAsksList.innerHTML = asks.length === 0 ? '<div class="ob-empty">Satış emri yok</div>' :
    asks.slice(0, 20).map(a => obRowHtml(a, maxSize, wallThreshold)).join('');

  document.querySelectorAll('.ob-row').forEach(row => {
    row.addEventListener('click', () => {
      const p = row.dataset.price;
      thresholdValueInput.value = p;
      thresholdValueInput.style.borderColor = 'var(--green)';
      thresholdValueInput.style.boxShadow = '0 0 12px rgba(34,197,94,0.25)';
      setTimeout(() => { thresholdValueInput.style.borderColor = ''; thresholdValueInput.style.boxShadow = ''; }, 800);
      showToast(`Hedef: ${p}$`, 'info');
    });
  });
}

function obRowHtml(level, maxSize, wallThreshold) {
  const pct = (level.size / maxSize) * 100;
  const isWall = level.size >= wallThreshold;
  return `<div class="ob-row ${isWall ? 'wall' : ''}" data-price="${level.price.toFixed(2)}">
    <div class="ob-row-bar" style="width:${pct}%"></div>
    <span class="ob-row-price">${level.price.toFixed(2)}$</span>
    <span class="ob-row-size">${isWall ? '🐳 ' : ''}${Math.round(level.size).toLocaleString()}</span>
  </div>`;
}

function getWallThreshold() {
  if (selectedAlarmType === 'wall_created') {
    const v = Number(thresholdValueInput.value);
    if (!isNaN(v) && v > 0) return v;
  }
  return 5000;
}

// ─── Save Alarm ───
saveAlarmBtn.addEventListener('click', async () => {
  if (!currentMarket || !currentTokenId) return showToast('Önce bir market çözümleyin.', 'error');
  const threshold = Number(thresholdValueInput.value);
  const chatId = chatIdInput.value.trim();
  if (isNaN(threshold) || threshold <= 0) return showToast('Geçerli bir limit girin.', 'error');

  localStorage.setItem('tg_chat_id', chatId);

  try {
    const res = await fetch('/api/alarms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentMarket.originalUrl, slug: currentMarket.slug,
        marketId: currentMarket.marketId, title: currentMarket.question,
        outcome: currentOutcome, tokenId: currentTokenId,
        alarmType: selectedAlarmType, threshold, chatId
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Alarm kuruldu!', 'success');
    fetchAlarms();
    fetchLogs();
  } catch (err) { showToast(err.message, 'error'); }
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
    fetchLogs();
  } catch (err) { showToast(err.message, 'error'); }
});

// ═══════════════════════════════════════
// ─── ALARMS LIST (clickable to edit) ───
// ═══════════════════════════════════════
async function fetchAlarms() {
  try {
    const res = await fetch('/api/alarms');
    const alarms = await res.json();
    alarmCountBadge.textContent = alarms.length;

    if (!alarms.length) {
      alarmsList.innerHTML = `<div class="empty-placeholder"><i class="fa-regular fa-bell-slash"></i><span>Henüz alarm yok</span></div>`;
      return;
    }

    alarmsList.innerHTML = alarms.map(a => {
      const cls = a.active ? '' : 'inactive';
      const togIcon = a.active ? 'fa-pause' : 'fa-play';
      const { kind, suffix } = alarmMeta(a.alarmType);
      return `<div class="alarm-item ${cls}" data-alarm-id="${a.id}">
        <div class="alarm-item-top">
          <div class="alarm-item-title" title="${a.title}">${a.title}</div>
          <div class="alarm-item-actions">
            <button onclick="event.stopPropagation(); toggleAlarm('${a.id}')" title="${a.active ? 'Durdur' : 'Başlat'}"><i class="fa-solid ${togIcon}"></i></button>
            <button class="del" onclick="event.stopPropagation(); deleteAlarm('${a.id}')" title="Sil"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="alarm-item-tags">
          <span class="atag ${a.outcome}">${a.outcome.toUpperCase()}</span>
          <span class="atag kind">${kind}</span>
          <span class="atag target">${a.threshold}${suffix}</span>
        </div>
      </div>`;
    }).join('');

    // Click on alarm item → open edit modal
    alarmsList.querySelectorAll('.alarm-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.alarmId;
        const alarm = alarms.find(a => a.id === id);
        if (alarm) openEditModal(alarm);
      });
    });
  } catch (err) { console.error('Alarms fetch error:', err); }
}

function alarmMeta(type) {
  switch (type) {
    case 'bid_above': return { kind: 'Yükselirse 📈', suffix: '$' };
    case 'ask_below': return { kind: 'Düşerse 📉', suffix: '$' };
    case 'price_above': return { kind: 'Mid Üzeri 📈', suffix: '$' };
    case 'price_below': return { kind: 'Mid Altı 📉', suffix: '$' };
    case 'wall_created': return { kind: 'Duvar 🐳', suffix: ' Adet' };
    case 'liquidity_surge': return { kind: 'Likidite 🌊', suffix: '%' };
    default: return { kind: type, suffix: '' };
  }
}

// ═══════════════════════════
// ─── EDIT MODAL ───────────
// ═══════════════════════════
function openEditModal(alarm) {
  editingAlarmId = alarm.id;

  // Title
  editTitle.textContent = alarm.title;

  // Outcome
  editOutcomeBtns.querySelectorAll('.outcome-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.outcome === alarm.outcome);
  });

  // Alarm type
  editTypeCards.querySelectorAll('.alarm-type-card-mini').forEach(card => {
    card.classList.toggle('selected', card.dataset.type === alarm.alarmType);
  });

  // Threshold
  editThresholdValue.value = alarm.threshold;
  updateEditThresholdUI(alarm.alarmType);

  // Chat ID
  editChatId.value = alarm.chatId || '';

  // Show
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
    editThresholdLabel.textContent = 'Minimum Duvar Boyutu';
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

  const selectedType = editTypeCards.querySelector('.alarm-type-card-mini.selected')?.dataset.type;
  const selectedOutcome = editOutcomeBtns.querySelector('.outcome-btn.active')?.dataset.outcome;
  const threshold = Number(editThresholdValue.value);
  const chatId = editChatId.value.trim();

  if (!selectedType) return showToast('Alarm türü seçin.', 'error');
  if (isNaN(threshold) || threshold <= 0) return showToast('Geçerli limit girin.', 'error');

  try {
    const res = await fetch(`/api/alarms/${editingAlarmId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alarmType: selectedType,
        outcome: selectedOutcome,
        threshold,
        chatId
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Alarm güncellendi!', 'success');
    closeEditModal();
    fetchAlarms();
    fetchLogs();
  } catch (err) { showToast(err.message, 'error'); }
}

// ─── Delete & Toggle (global) ───
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
    if (!logs.length) { logsList.innerHTML = '<div class="ob-empty">Log yok.</div>'; return; }
    logsList.innerHTML = logs.slice(0, 30).map(l => {
      let cls = 'sys';
      if (l.message.includes('[ALARM TETİKLENDİ]')) cls = 'alert';
      else if (l.message.includes('Hata')) cls = 'err';
      const t = new Date(l.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="log-entry ${cls}"><span class="ts">${t}</span> ${l.message}</div>`;
    }).join('');
  } catch (e) { console.error('Logs error:', e); }
}

// ─── System Status ───
async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const s = await res.json();
    const dot = $('systemStatus').querySelector('.status-dot');
    const txt = $('systemStatus').querySelector('.status-text');
    if (s.telegramConfigured) {
      dot.className = 'status-dot online';
      txt.textContent = `Aktif (${s.activeAlarmsCount} takip)`;
    } else {
      dot.className = 'status-dot offline';
      txt.textContent = 'Token eksik';
    }
  } catch {
    const dot = $('systemStatus').querySelector('.status-dot');
    const txt = $('systemStatus').querySelector('.status-text');
    dot.className = 'status-dot offline';
    txt.textContent = 'Bağlantı yok';
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
