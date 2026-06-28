const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

// Helper to get bot token from env
function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * Sends a HTML message to a Telegram chat
 */
async function sendTelegramMessage(chatId, htmlMessage) {
  const token = getBotToken();
  if (!token) {
    const errorMsg = 'Telegram token is not configured in env (TELEGRAM_BOT_TOKEN)';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await axios.post(url, {
      chat_id: chatId,
      text: htmlMessage,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    }, {
      timeout: 10000
    });
    return res.data;
  } catch (err) {
    const detail = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`Failed to send Telegram message to chat ${chatId}: ${detail}`);
    throw new Error(`Telegram API Error: ${detail}`);
  }
}

/**
 * Sends a test connection message to Telegram
 */
async function sendTestMessage(chatId) {
  const html = `<b>🤖 PolyBetPriceTracker Entegrasyon Testi</b>\n\n` +
               `Telegram bildirimleri başarıyla bağlandı!\n` +
               `<b>Sohbet ID:</b> <code>${chatId}</code>\n` +
               `<b>Zaman damgası:</b> ${new Date().toLocaleString('tr-TR')}\n\n` +
               `<i>Artık Polymarket alarmlarını bu gruba veya sohbete yönlendirebilirsiniz.</i>`;
  return sendTelegramMessage(chatId, html);
}

/**
 * Formats and sends a price cross alert
 */
async function sendPriceAlert(chatId, marketQuestion, outcome, triggerType, thresholdPrice, currentPrice, url) {
  const symbol = outcome.toUpperCase();
  const dirSymbol = triggerType === 'price_above' ? '📈' : '📉';
  const dirText = triggerType === 'price_above' ? 'üzerine çıktı' : 'altına düştü';

  const html = `${dirSymbol} <b>Polymarket Fiyat Alarmı Tetiklendi!</b>\n\n` +
               `<b>Pazar:</b> ${marketQuestion}\n` +
               `<b>Seçenek:</b> <code>${symbol}</code>\n` +
               `<b>Hedef Fiyat:</b> ${thresholdPrice.toFixed(2)}$\n` +
               `<b>Güncel Fiyat:</b> <b>${currentPrice.toFixed(2)}$</b> (${dirText})\n\n` +
               `🔗 <a href="${url}">Polymarket'te Görüntüle</a>`;

  return sendTelegramMessage(chatId, html);
}

/**
 * Formats and sends a wall creation alert
 */
async function sendWallAlert(chatId, marketQuestion, outcome, wallInfo, currentPrice, url) {
  const symbol = outcome.toUpperCase();
  const sideText = wallInfo.side === 'buy' ? 'Alış (Bid) Duvarı' : 'Satış (Ask) Duvarı';
  const sideEmoji = wallInfo.side === 'buy' ? '🐳' : '🚨';
  const actionText = wallInfo.side === 'buy' 
    ? 'seviyesine büyük bir alış yığıldı! (Insider / Ciddi alıcı şüphesi)' 
    : 'seviyesine büyük bir satış yığıldı!';

  const html = `${sideEmoji} <b>Polymarket Yeni Emir Duvarı (Wall) Tespit Edildi!</b>\n\n` +
               `<b>Pazar:</b> ${marketQuestion}\n` +
               `<b>Seçenek:</b> <code>${symbol}</code>\n\n` +
               `<b>Emir Türü:</b> <b>${sideText}</b>\n` +
               `<b>Fiyat Seviyesi:</b> <b>${wallInfo.price.toFixed(2)}$</b>\n` +
               `<b>Duvar Boyutu:</b> <code>${wallInfo.size.toLocaleString()}</code> adet\n` +
               `<b>Önceki Boyut:</b> ${wallInfo.prevSize.toLocaleString()} adet (Artış: +${wallInfo.addedSize.toLocaleString()})\n` +
               `<b>Anlık Fiyat:</b> ${currentPrice.toFixed(2)}$\n\n` +
               `<i>💡 ${actionText}</i>\n\n` +
               `🔗 <a href="${url}">Polymarket'te Görüntüle</a>`;

  return sendTelegramMessage(chatId, html);
}

/**
 * Formats and sends a liquidity surge alert
 */
async function sendLiquiditySurgeAlert(chatId, marketQuestion, outcome, surgeInfo, currentPrice, url) {
  const symbol = outcome.toUpperCase();
  const sideEmoji = surgeInfo.side === 'buy' ? '🌊' : '⚡️';
  const sideText = surgeInfo.side === 'buy' ? 'Alış (Bid)' : 'Satış (Ask)';

  const html = `${sideEmoji} <b>Polymarket Likidite Patlaması (Surge)!</b>\n\n` +
               `<b>Pazar:</b> ${marketQuestion}\n` +
               `<b>Seçenek:</b> <code>${symbol}</code>\n\n` +
               `<b>Bölge:</b> ${sideText} derinliği (3 cent aralığı)\n` +
               `<b>Değişim:</b> <b>+%${surgeInfo.increasePercent} kalınlaşma</b>\n` +
               `<b>Önceki Derinlik:</b> ${surgeInfo.prevDepth.toLocaleString()} adet\n` +
               `<b>Yeni Derinlik:</b> <b>${surgeInfo.currentDepth.toLocaleString()} adet</b> (Artış: +${surgeInfo.increaseAmount.toLocaleString()})\n` +
               `<b>Anlık Fiyat:</b> ${currentPrice.toFixed(2)}$\n\n` +
               `<i>💡 Bu taraftaki emir kalınlaşması fiyatın yakında bu yöne hareket edebileceğine işaret edebilir.</i>\n\n` +
               `🔗 <a href="${url}">Polymarket'te Görüntüle</a>`;

  return sendTelegramMessage(chatId, html);
}

module.exports = {
  sendTelegramMessage,
  sendTestMessage,
  sendPriceAlert,
  sendWallAlert,
  sendLiquiditySurgeAlert
};
