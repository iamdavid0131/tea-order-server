// routes/preview.js
import express from 'express';
import { calcShipping } from '../lib/utils.js';
import { getSheetsClient } from '../lib/sheets.js';

const router = express.Router();

// 🤫 隱藏版商品定義
const SECRET_PRODUCT = {
  id: "secret_888",
  price: 8800
};

// 🧠 全域快取
let cachedPrices = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; 

async function fetchPriceMap() {
  if (!process.env.SHEET_ID) throw new Error('SHEET_ID not set');
  const now = Date.now();
  if (cachedPrices && now - lastFetchTime < CACHE_TTL) return cachedPrices;

  console.log('[preview] Fetching fresh prices from Google Sheets...');
  const sheets = await getSheetsClient();
  const data = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Products!A2:C',
  });
  const rows = data.data?.values || [];
  const map = Object.fromEntries(rows.map((r) => [r[0], Number(r[2] || 0)]));
  cachedPrices = map;
  lastFetchTime = now;
  console.log(`[preview] Price map cached (${Object.keys(map).length} items).`);
  return map;
}

/**
 * 金額試算 API
 */
router.post('/', async (req, res) => {
  try {
    const { items = [], shippingMethod = 'store', promoCode = '' } = req.body;

    // 🔍 Debug: 印出前端到底傳了什麼給後端
    // 請在後端 Log 查看這行，確認有沒有收到 id: "secret_888"
    console.log("🔍 [Preview API] Received Items:", JSON.stringify(items));

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items provided' });
    }

    const priceMap = await fetchPriceMap();

    const subtotal = items.reduce((sum, it) => {
      let price = 0;
      const itemId = String(it.id).trim(); // 強制轉字串並去空白 (防呆)

      // 🔥 1. 先判斷隱藏商品
      if (itemId === SECRET_PRODUCT.id) {
        price = SECRET_PRODUCT.price;
        console.log(`💰 [Preview] 發現隱藏商品! ID: ${itemId}, Price: ${price}`);
      } 
      // 2. 再查一般商品
      else {
        price = priceMap[itemId] || 0;
        if (price === 0) console.warn(`⚠️ [Preview] 查無價格或價格為0: ${itemId}`);
      }

      return sum + price * (Number(it.qty) || 0);
    }, 0);

    console.log(`🧾 [Preview] Calculated Subtotal: ${subtotal}`);

    // 優惠碼
    let discount = 0;
    if (promoCode && promoCode.toLowerCase() === 'tea10') {
      discount = Math.round(subtotal * 0.1);
    }

    const totalAfterDiscount = subtotal - discount;
    const shipping = calcShipping(totalAfterDiscount, shippingMethod);
    const total = totalAfterDiscount + shipping;

    res.json({
      ok: true,
      data: { subtotal, discount, totalAfterDiscount, shipping, total },
      shippingFee: shipping,
      cache: { valid: !!cachedPrices, lastFetch: new Date(lastFetchTime).toISOString() },
    });
  } catch (err) {
    console.error('[previewTotals] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;