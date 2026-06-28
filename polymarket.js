const axios = require('axios');

// Cache to store the previous orderbook states for change detection
// Keyed by token_id
const orderbookCache = {};

/**
 * Extracts slug from a Polymarket URL.
 * Supports:
 * - https://polymarket.com/event/slug
 * - https://polymarket.com/market/slug
 * - slug-string-directly
 */
function extractSlug(urlOrSlug) {
  if (!urlOrSlug) return '';
  let str = urlOrSlug.trim();
  
  // Remove query params or hashes
  str = str.split('?')[0].split('#')[0];
  
  try {
    // If it's a full URL
    if (str.startsWith('http://') || str.startsWith('https://')) {
      const urlObj = new URL(str);
      const paths = urlObj.pathname.split('/').filter(Boolean);
      // Usually paths are ['event', 'slug'] or ['market', 'slug']
      if (paths.length >= 2 && (paths[0] === 'event' || paths[0] === 'market')) {
        return paths[1];
      }
      if (paths.length > 0) {
        return paths[paths.length - 1]; // Fallback to last segment
      }
    }
  } catch (e) {
    // Ignore URL parse error and treat as slug
  }
  
  return str;
}

/**
 * Resolves a Polymarket URL or slug to market details using Gamma API
 */
async function resolveMarket(urlOrSlug) {
  const slug = extractSlug(urlOrSlug);
  if (!slug) {
    throw new Error('Invalid Polymarket URL or slug');
  }

  console.log(`Resolving slug: ${slug}`);

  // Try fetching as market first
  try {
    const marketResponse = await axios.get(`https://gamma-api.polymarket.com/markets?slug=${slug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    if (marketResponse.data && marketResponse.data.length > 0) {
      return parseGammaMarkets(marketResponse.data, urlOrSlug);
    }
  } catch (err) {
    console.log(`Gamma API market endpoint error for ${slug}: ${err.message}`);
  }

  // Fallback to fetching as event
  try {
    const eventResponse = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    if (eventResponse.data && eventResponse.data.length > 0 && eventResponse.data[0].markets) {
      return parseGammaMarkets(eventResponse.data[0].markets, urlOrSlug, eventResponse.data[0].title);
    }
  } catch (err) {
    console.log(`Gamma API event endpoint error for ${slug}: ${err.message}`);
  }

  throw new Error(`Could not find any markets for slug "${slug}"`);
}

/**
 * Parses Gamma API market array into a clean format
 */
function parseGammaMarkets(gammaMarkets, originalUrl, eventTitle = '') {
  return gammaMarkets.map(m => {
    let outcomes = [];
    let prices = [];
    let clobTokenIds = [];
    
    try {
      outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : (m.outcomes || []);
      prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices).map(Number) : (m.outcomePrices ? m.outcomePrices.map(Number) : []);
      clobTokenIds = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : (m.clobTokenIds || []);
    } catch (e) {
      console.error('Error parsing outcomes, prices or token IDs:', e);
    }

    return {
      marketId: m.id,
      conditionId: m.conditionId,
      question: m.question,
      eventTitle: eventTitle || m.question,
      slug: m.slug,
      outcomes,
      prices, // YES price is index 0, NO is index 1 (usually)
      clobTokenIds,
      bestBid: m.bestBid ? Number(m.bestBid) : null,
      bestAsk: m.bestAsk ? Number(m.bestAsk) : null,
      spread: m.spread ? Number(m.spread) : null,
      volume: m.volume ? Number(m.volume) : 0,
      liquidity: m.liquidity ? Number(m.liquidity) : 0,
      originalUrl: originalUrl
    };
  });
}

/**
 * Fetches orderbook from CLOB API
 */
async function fetchOrderbook(tokenId) {
  try {
    const res = await axios.get(`https://clob.polymarket.com/book?token_id=${tokenId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    
    if (res.data) {
      return parseOrderbook(res.data);
    }
  } catch (err) {
    console.error(`Error fetching orderbook for token ${tokenId}: ${err.message}`);
    throw err;
  }
}

/**
 * Parses raw orderbook data from CLOB API and sorts levels
 */
function parseOrderbook(rawBook) {
  // Sort bids descending (highest buy price first)
  const bids = (rawBook.bids || []).map(b => ({
    price: Number(b.price),
    size: Number(b.size)
  })).sort((a, b) => b.price - a.price);

  // Sort asks ascending (lowest sell price first)
  const asks = (rawBook.asks || []).map(a => ({
    price: Number(a.price),
    size: Number(a.size)
  })).sort((a, b) => a.price - b.price);

  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;
  const spread = (bestBid && bestAsk) ? Number((bestAsk - bestBid).toFixed(4)) : null;
  const midPrice = (bestBid && bestAsk) ? Number(((bestAsk + bestBid) / 2).toFixed(4)) : null;

  return {
    marketId: rawBook.market,
    tokenId: rawBook.asset_id,
    bids,
    asks,
    bestBid,
    bestAsk,
    spread,
    midPrice,
    timestamp: Date.now()
  };
}

/**
 * Calculates depth of orderbook within a margin of the mid-price (e.g. 0.03 cents)
 */
function calculateDepth(book, margin = 0.03) {
  if (!book || !book.midPrice) return { bidsDepth: 0, asksDepth: 0 };
  
  const mid = book.midPrice;
  
  const bidsDepth = book.bids
    .filter(b => b.price >= (mid - margin))
    .reduce((sum, b) => sum + b.size, 0);

  const asksDepth = book.asks
    .filter(a => a.price <= (mid + margin))
    .reduce((sum, a) => sum + a.size, 0);

  return {
    bidsDepth: Math.round(bidsDepth),
    asksDepth: Math.round(asksDepth)
  };
}

/**
 * Compares current orderbook to cached orderbook to find changes
 */
function analyzeOrderbookChanges(currentBook, wallThreshold = 5000, margin = 0.03) {
  const tokenId = currentBook.tokenId;
  const prevBook = orderbookCache[tokenId];
  
  // Store the current book in cache for the next run
  orderbookCache[tokenId] = currentBook;

  const result = {
    newWalls: [],
    liquiditySurge: null,
    thickenedSide: null // 'bids', 'asks', or null
  };

  // If there's no previous state, we can't find relative changes, but we can detect absolute walls
  const prevBidsMap = new Map();
  const prevAsksMap = new Map();
  
  if (prevBook) {
    prevBook.bids.forEach(b => prevBidsMap.set(b.price.toFixed(2), b.size));
    prevBook.asks.forEach(a => prevAsksMap.set(a.price.toFixed(2), a.size));
  }

  // 1. Detect Buy Walls (in Bids) near the spread (within 5 cents)
  currentBook.bids.forEach(bid => {
    // Only check levels within 5 cents of the best bid
    if (currentBook.bestBid && bid.price >= (currentBook.bestBid - 0.05)) {
      const prevSize = prevBidsMap.get(bid.price.toFixed(2)) || 0;
      
      // If current size exceeds threshold, and it grew significantly (or is new)
      if (bid.size >= wallThreshold) {
        const addedSize = bid.size - prevSize;
        // Trigger if:
        // - It's a new wall (was under 20% of threshold before)
        // - Or it grew by at least 50% of the threshold size
        if (prevSize < (wallThreshold * 0.2) || addedSize >= (wallThreshold * 0.5)) {
          result.newWalls.push({
            side: 'buy',
            price: bid.price,
            size: bid.size,
            prevSize,
            addedSize
          });
        }
      }
    }
  });

  // 2. Detect Sell Walls (in Asks) near the spread (within 5 cents)
  currentBook.asks.forEach(ask => {
    if (currentBook.bestAsk && ask.price <= (currentBook.bestAsk + 0.05)) {
      const prevSize = prevAsksMap.get(ask.price.toFixed(2)) || 0;
      
      if (ask.size >= wallThreshold) {
        const addedSize = ask.size - prevSize;
        if (prevSize < (wallThreshold * 0.2) || addedSize >= (wallThreshold * 0.5)) {
          result.newWalls.push({
            side: 'sell',
            price: ask.price,
            size: ask.size,
            prevSize,
            addedSize
          });
        }
      }
    }
  });

  // 3. Detect overall liquidity surges (depth within 3 cents of mid-price)
  if (prevBook) {
    const curDepth = calculateDepth(currentBook, margin);
    const prevDepth = calculateDepth(prevBook, margin);

    const bidsDiff = curDepth.bidsDepth - prevDepth.bidsDepth;
    const asksDiff = curDepth.asksDepth - prevDepth.asksDepth;

    // Check if buy depth surged (grew by > 50% AND at least 5000 shares)
    if (prevDepth.bidsDepth > 1000 && (bidsDiff / prevDepth.bidsDepth) >= 0.5 && bidsDiff >= 5000) {
      result.liquiditySurge = {
        side: 'buy',
        currentDepth: curDepth.bidsDepth,
        prevDepth: prevDepth.bidsDepth,
        increasePercent: Math.round((bidsDiff / prevDepth.bidsDepth) * 100),
        increaseAmount: bidsDiff
      };
    }
    // Check if sell depth surged
    else if (prevDepth.asksDepth > 1000 && (asksDiff / prevDepth.asksDepth) >= 0.5 && asksDiff >= 5000) {
      result.liquiditySurge = {
        side: 'sell',
        currentDepth: curDepth.asksDepth,
        prevDepth: prevDepth.asksDepth,
        increasePercent: Math.round((asksDiff / prevDepth.asksDepth) * 100),
        increaseAmount: asksDiff
      };
    }
  }

  return result;
}

module.exports = {
  resolveMarket,
  fetchOrderbook,
  calculateDepth,
  analyzeOrderbookChanges,
  extractSlug
};
