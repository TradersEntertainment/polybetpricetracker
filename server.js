const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const db = require('./db');
const polymarket = require('./polymarket');
const telegram = require('./telegram');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_CHAT_ID = '-5581160915';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoints

// 1. Get system status
app.get('/api/status', (req, res) => {
  const hasTelegramToken = !!process.env.TELEGRAM_BOT_TOKEN;
  const alarms = db.getAlarms();
  res.json({
    telegramConfigured: hasTelegramToken,
    activeAlarmsCount: alarms.filter(a => a.active).length,
    totalAlarmsCount: alarms.length,
    timestamp: new Date().toISOString()
  });
});

// 2. Get all alarms
app.get('/api/alarms', (req, res) => {
  res.json(db.getAlarms());
});

// 3. Create a new alarm
app.post('/api/alarms', (req, res) => {
  try {
    const {
      url,
      slug,
      marketId,
      title,
      outcome,
      tokenId,
      alarmType,
      threshold,
      chatId
    } = req.body;

    // Use default chat ID if none provided
    const resolvedChatId = (chatId && chatId.trim()) ? chatId.trim() : DEFAULT_CHAT_ID;

    if (!url || !slug || !marketId || !title || !outcome || !tokenId || !alarmType || threshold === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const alarm = db.saveAlarm({
      url,
      slug,
      marketId,
      title,
      outcome,
      tokenId,
      alarmType,
      threshold: Number(threshold),
      chatId: resolvedChatId
    });

    db.addLog(`Yeni alarm kuruldu: ${title} (${outcome}) - ${alarmType} @ ${threshold}`, { alarmId: alarm.id });
    res.json(alarm);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete an alarm
app.delete('/api/alarms/:id', (req, res) => {
  const deleted = db.deleteAlarm(req.params.id);
  if (deleted) {
    db.addLog(`Alarm silindi: ID ${req.params.id}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Alarm not found' });
  }
});

// 5. Toggle alarm active status
app.post('/api/alarms/:id/toggle', (req, res) => {
  const alarm = db.toggleAlarm(req.params.id);
  if (alarm) {
    db.addLog(`Alarm ${alarm.active ? 'aktifleştrildi' : 'pasifleştirildi'}: ${alarm.title}`);
    res.json(alarm);
  } else {
    res.status(404).json({ error: 'Alarm not found' });
  }
});

// 5b. Update an alarm
app.put('/api/alarms/:id', (req, res) => {
  try {
    const existing = db.getAlarms().find(a => a.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Alarm not found' });

    const { alarmType, threshold, chatId, outcome } = req.body;
    const updated = db.saveAlarm({
      ...existing,
      alarmType: alarmType || existing.alarmType,
      threshold: threshold !== undefined ? Number(threshold) : existing.threshold,
      chatId: (chatId && chatId.trim()) ? chatId.trim() : existing.chatId,
      outcome: outcome || existing.outcome
    });
    db.addLog(`Alarm güncellendi: ${updated.title} → ${updated.alarmType} @ ${updated.threshold}`);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Resolve Polymarket URL / slug
app.post('/api/resolve', async (req, res) => {
  const { urlOrSlug } = req.body;
  if (!urlOrSlug) {
    return res.status(400).json({ error: 'URL or slug is required' });
  }
  try {
    const markets = await polymarket.resolveMarket(urlOrSlug);
    res.json({ success: true, markets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Get Orderbook for a token
app.post('/api/orderbook', async (req, res) => {
  const { tokenId } = req.body;
  if (!tokenId) {
    return res.status(400).json({ error: 'Token ID is required' });
  }
  try {
    const book = await polymarket.fetchOrderbook(tokenId);
    const depth = polymarket.calculateDepth(book, 0.03);
    res.json({ success: true, book, depth });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Send test Telegram notification
app.post('/api/test-telegram', async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) {
    return res.status(400).json({ error: 'Chat ID is required' });
  }
  try {
    await telegram.sendTestMessage(chatId.trim());
    db.addLog(`Telegram test mesajı gönderildi: ${chatId}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Get logs
app.get('/api/logs', (req, res) => {
  res.json(db.getLogs());
});

// Server Background Tracker Loop

let trackingIntervalId = null;

async function checkMarketsAndTriggerAlarms() {
  const alarms = db.getAlarms().filter(a => a.active);
  if (alarms.length === 0) return;

  // Group alarms by tokenId to query the API only once per token
  const groupedAlarms = {};
  alarms.forEach(alarm => {
    if (!groupedAlarms[alarm.tokenId]) {
      groupedAlarms[alarm.tokenId] = [];
    }
    groupedAlarms[alarm.tokenId].push(alarm);
  });

  for (const tokenId in groupedAlarms) {
    try {
      const tokenAlarms = groupedAlarms[tokenId];
      
      // Fetch latest orderbook from CLOB (gives us current price, bids, and asks)
      const currentBook = await polymarket.fetchOrderbook(tokenId);
      if (!currentBook) continue;

      const currentPrice = currentBook.midPrice || currentBook.bestBid || currentBook.bestAsk;
      if (currentPrice === null) continue;

      // Analyze orderbook changes (new walls, liquidity surges) using default thresholds
      // For wall detection, we check if any alarm specifies a custom wall size threshold
      const wallAlarms = tokenAlarms.filter(a => a.alarmType === 'wall_created');
      const minWallThreshold = wallAlarms.length > 0 
        ? Math.min(...wallAlarms.map(a => a.threshold)) 
        : 5000; // default 5000 shares wall

      const changes = polymarket.analyzeOrderbookChanges(currentBook, minWallThreshold, 0.03);

      for (const alarm of tokenAlarms) {
        let triggerAlert = false;
        let alertDetails = '';

        if (alarm.alarmType === 'price_above') {
          if (currentPrice >= alarm.threshold) {
            // Check cooldown (15 minutes)
            const sent = db.hasAlertBeenSentRecently(alarm.marketId, 'price_above', alarm.outcome, alarm.threshold, currentPrice, alarm.chatId, 15);
            if (!sent) {
              triggerAlert = true;
              alertDetails = `Orta Fiyat üst sınıra ulaştı. Hedef: ${alarm.threshold}, Güncel: ${currentPrice}`;
              
              await telegram.sendPriceAlert(alarm.chatId, alarm.title, alarm.outcome, 'price_above', alarm.threshold, currentPrice, alarm.url);
              db.markAlertSent(alarm.marketId, 'price_above', alarm.outcome, alarm.threshold, currentPrice, alarm.chatId);
            }
          }
        } 
        else if (alarm.alarmType === 'price_below') {
          if (currentPrice <= alarm.threshold) {
            const sent = db.hasAlertBeenSentRecently(alarm.marketId, 'price_below', alarm.outcome, alarm.threshold, currentPrice, alarm.chatId, 15);
            if (!sent) {
              triggerAlert = true;
              alertDetails = `Orta Fiyat alt sınıra ulaştı. Hedef: ${alarm.threshold}, Güncel: ${currentPrice}`;
              
              await telegram.sendPriceAlert(alarm.chatId, alarm.title, alarm.outcome, 'price_below', alarm.threshold, currentPrice, alarm.url);
              db.markAlertSent(alarm.marketId, 'price_below', alarm.outcome, alarm.threshold, currentPrice, alarm.chatId);
            }
          }
        } 
        else if (alarm.alarmType === 'bid_above') {
          const bidPrice = currentBook.bestBid;
          if (bidPrice !== null && bidPrice >= alarm.threshold) {
            const sent = db.hasAlertBeenSentRecently(alarm.marketId, 'bid_above', alarm.outcome, alarm.threshold, bidPrice, alarm.chatId, 15);
            if (!sent) {
              triggerAlert = true;
              alertDetails = `Best Bid üst sınıra ulaştı. Hedef: ${alarm.threshold}, Güncel: ${bidPrice}`;
              
              await telegram.sendPriceAlert(alarm.chatId, alarm.title, alarm.outcome, 'bid_above', alarm.threshold, bidPrice, alarm.url);
              db.markAlertSent(alarm.marketId, 'bid_above', alarm.outcome, alarm.threshold, bidPrice, alarm.chatId);
            }
          }
        }
        else if (alarm.alarmType === 'ask_below') {
          const askPrice = currentBook.bestAsk;
          if (askPrice !== null && askPrice <= alarm.threshold) {
            const sent = db.hasAlertBeenSentRecently(alarm.marketId, 'ask_below', alarm.outcome, alarm.threshold, askPrice, alarm.chatId, 15);
            if (!sent) {
              triggerAlert = true;
              alertDetails = `Best Ask alt sınıra ulaştı. Hedef: ${alarm.threshold}, Güncel: ${askPrice}`;
              
              await telegram.sendPriceAlert(alarm.chatId, alarm.title, alarm.outcome, 'ask_below', alarm.threshold, askPrice, alarm.url);
              db.markAlertSent(alarm.marketId, 'ask_below', alarm.outcome, alarm.threshold, askPrice, alarm.chatId);
            }
          }
        } 
        else if (alarm.alarmType === 'wall_created') {
          // Find if a wall was created at this alarm's threshold or higher
          // In wall alarms, threshold represents the minimum wall size in shares
          const matchingWalls = changes.newWalls.filter(wall => {
            // Match side based on outcome:
            // For binary outcomes, usually YES buying is bid wall, selling is ask wall.
            // Let's alert on bid walls (side === 'buy') as buyers/insiders, which is the main interest.
            // If the user wants to see any wall above their threshold on this token:
            return wall.size >= alarm.threshold;
          });

          for (const wall of matchingWalls) {
            // Cooldown keyed by wall price level to avoid spamming the same wall
            const sent = db.hasAlertBeenSentRecently(alarm.marketId, 'wall_created', alarm.outcome, wall.price, wall.size, alarm.chatId, 20);
            if (!sent) {
              triggerAlert = true;
              alertDetails = `Yeni emir duvarı tespit edildi: ${wall.side === 'buy' ? 'Alış' : 'Satış'} seviyesi ${wall.price}$ - Boyut: ${wall.size} adet`;
              
              await telegram.sendWallAlert(alarm.chatId, alarm.title, alarm.outcome, wall, currentPrice, alarm.url);
              db.markAlertSent(alarm.marketId, 'wall_created', alarm.outcome, wall.price, wall.size, alarm.chatId);
            }
          }
        } 
        else if (alarm.alarmType === 'liquidity_surge') {
          // In liquidity surge, threshold is percentage increase (e.g. 50%)
          if (changes.liquiditySurge && changes.liquiditySurge.increasePercent >= alarm.threshold) {
            const sent = db.hasAlertBeenSentRecently(alarm.marketId, 'liquidity_surge', alarm.outcome, alarm.threshold, currentPrice, alarm.chatId, 15);
            if (!sent) {
              triggerAlert = true;
              alertDetails = `Likidite kalınlaşması tespit edildi: %${changes.liquiditySurge.increasePercent} artış (${changes.liquiditySurge.side === 'buy' ? 'Alışlar' : 'Satışlar'})`;
              
              await telegram.sendLiquiditySurgeAlert(alarm.chatId, alarm.title, alarm.outcome, changes.liquiditySurge, currentPrice, alarm.url);
              db.markAlertSent(alarm.marketId, 'liquidity_surge', alarm.outcome, alarm.threshold, currentPrice, alarm.chatId);
            }
          }
        }

        if (triggerAlert) {
          db.addLog(`[ALARM TETİKLENDİ] ${alarm.title} (${alarm.outcome}) - ${alertDetails}`, {
            alarmId: alarm.id,
            chatId: alarm.chatId
          });
        }
      }
    } catch (err) {
      console.error(`Tracker error for token ${tokenId}:`, err.message);
    }
  }
}

// Start tracking loop
function startTracking(intervalMs = 30000) {
  if (trackingIntervalId) {
    clearInterval(trackingIntervalId);
  }
  
  // Run once immediately
  checkMarketsAndTriggerAlarms();
  
  trackingIntervalId = setInterval(checkMarketsAndTriggerAlarms, intervalMs);
  console.log(`Polymarket tracking loop started. Interval: ${intervalMs / 1000}s`);
  db.addLog('Polymarket takip döngüsü başlatıldı.');
}

// Listen server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  db.addLog(`Sistem başlatıldı. Port: ${PORT}`);
  
  // Start tracking
  startTracking(30000); // 30 seconds
});
