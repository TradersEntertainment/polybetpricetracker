# PolyBetPriceTracker 🐳

Polymarket fiyatlarını, emir defteri kalınlığını (orderbook depth/thickness) ve yeni girilen büyük emir duvarlarını (buy/sell walls) takip edip Telegram üzerinden bildiren gelişmiş otomasyon ve bildirim botu.

Arayüz üzerinden herhangi bir Polymarket linkini yapıştırarak hızlıca çözümler, canlı orderbook'u görselleştirir ve istediğiniz fiyat, duvar veya likidite koşuluna göre alarmlar tanımlayabilirsiniz.

## Özellikler

- 🔗 **Polymarket Link Çözümleyici**: `/event/` veya `/market/` linklerini yapıştırdığınız an otomatik olarak Gamma API üzerinden başlık, fiyat, hacim ve token ID'lerini çeker.
- 📖 **Görsel Canlı OrderBook**: Seçilen outcome (YES/NO) için CLOB API'den canlı sipariş defterini çeker. Fiyat seviyelerini ve emir büyüklüklerini görsel grafik barlarla gösterir.
- 🎯 **Tıklayarak Fiyat Seçme**: Orderbook'ta herhangi bir fiyat satırına tıkladığınızda o fiyat seviyesi otomatik olarak alarm formuna yazılır.
- 🐳 **Büyük Emir Duvarı (Wall) Tespiti**: Spread yakınında aniden yığılan büyük emirleri (örn: >5,000 shares) yakalar ve gruba anlık bildirim atar (insider / balina tespiti için ideal).
- 🌊 **Likidite Kalınlaşması (Depth Surge)**: Spread'e yakın derinliğin belirli bir oranda (örn: %50) artması durumunda bildirim gönderir.
- 📬 **Çoklu Telegram Chat Yönlendirmesi**: Tek bir Telegram Bot tokenı kullanarak farklı alarmları farklı Chat ID'lerine (farklı gruplar veya kanallar) yönlendirebilirsiniz.
- 💾 **Railway Volume Desteği**: `/data` dizinine bağlanan Volume sayesinde sunucu kapansa/açılsa dahi kurduğunuz alarmlar ve atılmış bildirimlerin önbelleği silinmez (çift bildirim atılmasını önler).

---

## Kurulum ve Çalıştırma

### Yerel Çalıştırma (Local)

1. Depoyu klonlayın veya indirin.
2. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
3. Kök dizinde `.env` dosyası oluşturun ve Telegram tokenınızı tanımlayın:
   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
   PORT=3000
   ```
4. Uygulamayı başlatın:
   ```bash
   npm start
   ```
5. Tarayıcınızdan `http://localhost:3000` adresine gidin.

### Railway ile Yayına Alma (Deployment)

1. Projeyi GitHub reponuza yükleyin.
2. Railway kontrol panelinden **New Project > Deploy from GitHub repo** adımlarını izleyin.
3. **Variables** sekmesinden şu environment variable'ı ekleyin:
   - `TELEGRAM_BOT_TOKEN` = `[BOT_TOKENİNİZ]`
4. **Settings > Volumes** sekmesinden bir Volume ekleyin:
   - **Mount Path**: `/data`
   - Bu volume sayesinde veritabanınız kalıcı olacaktır.

---

## Gelişmiş Takip Algoritmaları

1. **Fiyat Alarmları (`price_above`, `price_below`)**:
   Belirlediğiniz fiyat sınırı aşıldığında veya altına inildiğinde anında bildirim atılır. Spam önleme amacıyla aynı alarm için 15 dakika boyunca tekrar bildirim atılması engellenir.
2. **Duvar Tespiti (`wall_created`)**:
   Sipariş defterinin spread etrafındaki 5 cent'lik diliminde, girdiğiniz miktardan büyük yeni bir emir duvarı tespit edildiğinde tetiklenir. Seviyeye özel 20 dakikalık cooldown uygulanır.
3. **Likidite Kalınlaşması (`liquidity_surge`)**:
   Spread'in 3 cent yakınındaki toplam bid veya ask büyüklüğünün bir önceki taramaya göre en az %50 (ve minimum 5,000 adet) artması durumunda tetiklenir.

## Lisans

ISC
