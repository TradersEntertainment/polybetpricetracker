const fs = require('fs');
const path = require('path');

// Determine database path: check if /data is available (Railway Volume), otherwise use local ./data directory
let dbDir = '/data';
let dbPath = path.join(dbDir, 'tracker_db.json');

try {
  // Check if we can write to /data, if not use local directory
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  // Try writing a test file to make sure it's writable
  const testFile = path.join(dbDir, '.write_test');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
} catch (err) {
  // Fallback to project root data directory
  dbDir = path.join(__dirname, 'data');
  dbPath = path.join(dbDir, 'tracker_db.json');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

console.log(`Database is initialized at: ${dbPath}`);

// Helper to read database
function readDb() {
  try {
    if (!fs.existsSync(dbPath)) {
      const defaultDb = { alarms: [], logs: [], sentAlerts: [] };
      fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2), 'utf8');
      return defaultDb;
    }
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database file, returning empty default:', err);
    return { alarms: [], logs: [], sentAlerts: [] };
  }
}

// Helper to write database atomically
function writeDb(data) {
  try {
    const tempPath = `${dbPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, dbPath);
    return true;
  } catch (err) {
    console.error('Error writing database file:', err);
    return false;
  }
}

const db = {
  // Alarms
  getAlarms() {
    return readDb().alarms || [];
  },

  saveAlarm(alarm) {
    const data = readDb();
    if (!data.alarms) data.alarms = [];
    
    if (alarm.id) {
      // Update
      const idx = data.alarms.findIndex(a => a.id === alarm.id);
      if (idx !== -1) {
        data.alarms[idx] = { ...data.alarms[idx], ...alarm, updatedAt: new Date().toISOString() };
      } else {
        data.alarms.push(alarm);
      }
    } else {
      // Create new
      alarm.id = 'alarm_' + Math.random().toString(36).substr(2, 9);
      alarm.createdAt = new Date().toISOString();
      alarm.active = true;
      data.alarms.push(alarm);
    }
    writeDb(data);
    return alarm;
  },

  deleteAlarm(id) {
    const data = readDb();
    if (!data.alarms) data.alarms = [];
    const filtered = data.alarms.filter(a => a.id !== id);
    const deleted = data.alarms.length !== filtered.length;
    data.alarms = filtered;
    writeDb(data);
    return deleted;
  },

  toggleAlarm(id) {
    const data = readDb();
    if (!data.alarms) data.alarms = [];
    const alarm = data.alarms.find(a => a.id === id);
    if (alarm) {
      alarm.active = !alarm.active;
      alarm.updatedAt = new Date().toISOString();
      writeDb(data);
      return alarm;
    }
    return null;
  },

  // Logs
  getLogs() {
    return readDb().logs || [];
  },

  addLog(message, details = {}) {
    const data = readDb();
    if (!data.logs) data.logs = [];
    
    const newLog = {
      id: 'log_' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      message,
      details
    };
    
    data.logs.unshift(newLog); // Newest first
    // Limit to last 150 entries
    if (data.logs.length > 150) {
      data.logs = data.logs.slice(0, 150);
    }
    writeDb(data);
    return newLog;
  },

  // Alert Cooldown and Prevention
  hasAlertBeenSentRecently(marketId, alertType, outcome, thresholdValue, currentVal, chatId, cooldownMinutes = 15) {
    const data = readDb();
    if (!data.sentAlerts) data.sentAlerts = [];
    
    const now = new Date().getTime();
    const thresholdMs = cooldownMinutes * 60 * 1000;
    
    // Clean old alerts while matching
    data.sentAlerts = data.sentAlerts.filter(alert => {
      const alertTime = new Date(alert.timestamp).getTime();
      return (now - alertTime) < (24 * 60 * 60 * 1000); // keep in DB for max 24 hours
    });
    
    // Find matching alert
    const match = data.sentAlerts.find(alert => {
      const matchMarket = alert.marketId === marketId;
      const matchType = alert.alertType === alertType;
      const matchOutcome = alert.outcome === outcome;
      const matchChat = alert.chatId === chatId;
      
      if (!matchMarket || !matchType || !matchOutcome || !matchChat) return false;
      
      // For price alerts, check if it's the same threshold crossing
      if (alertType === 'price_above' || alertType === 'price_below') {
        return alert.thresholdValue === thresholdValue;
      }
      
      // For wall created, verify it's the same price level
      if (alertType === 'wall_created') {
        return alert.thresholdValue === thresholdValue; // thresholdValue holds the wall price level
      }

      // For liquidity surge, check if it was sent recently
      return true;
    });

    if (match) {
      const matchTime = new Date(match.timestamp).getTime();
      if ((now - matchTime) < thresholdMs) {
        return true; // Sent recently, suppress
      }
    }
    
    return false;
  },

  markAlertSent(marketId, alertType, outcome, thresholdValue, currentVal, chatId) {
    const data = readDb();
    if (!data.sentAlerts) data.sentAlerts = [];
    
    // Remove existing match if any to update timestamp
    data.sentAlerts = data.sentAlerts.filter(alert => !(
      alert.marketId === marketId &&
      alert.alertType === alertType &&
      alert.outcome === outcome &&
      alert.thresholdValue === thresholdValue &&
      alert.chatId === chatId
    ));

    data.sentAlerts.push({
      marketId,
      alertType,
      outcome,
      thresholdValue,
      currentVal,
      chatId,
      timestamp: new Date().toISOString()
    });
    
    writeDb(data);
  }
};

module.exports = db;
