const polymarket = require('./polymarket');

async function test() {
  const url = 'https://polymarket.com/event/will-microstrategy-announce-a-bitcoin-purchase-june-23-29';
  console.log(`Resolving URL: ${url}`);
  
  try {
    const markets = await polymarket.resolveMarket(url);
    console.log('\n--- Resolved Markets ---');
    console.log(JSON.stringify(markets, null, 2));

    if (markets.length > 0) {
      const firstMarket = markets[0];
      const yesToken = firstMarket.clobTokenIds[0];
      console.log(`\nFetching YES token orderbook for: ${yesToken}`);
      
      const book = await polymarket.fetchOrderbook(yesToken);
      console.log('\n--- Orderbook Summary ---');
      console.log(`Best Bid: ${book.bestBid}`);
      console.log(`Best Ask: ${book.bestAsk}`);
      console.log(`Mid Price: ${book.midPrice}`);
      console.log(`Spread: ${book.spread}`);
      
      console.log('\nBids (Top 5):');
      console.log(book.bids.slice(0, 5));
      
      console.log('\nAsks (Top 5):');
      console.log(book.asks.slice(0, 5));
      
      const depth = polymarket.calculateDepth(book, 0.03);
      console.log('\n--- Depth Summary (3 cents range) ---');
      console.log(`Bids Depth: ${depth.bidsDepth} shares`);
      console.log(`Asks Depth: ${depth.asksDepth} shares`);
    }
  } catch (err) {
    console.error('Test failed with error:', err);
  }
}

test();
