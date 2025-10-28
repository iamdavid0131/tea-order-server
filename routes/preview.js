// routes/preview.js
import express from 'express';
import { calcShipping } from '../lib/utils.js';
import { getSheetsClient } from '../lib/sheets.js';

const router = express.Router();

// 🧠 全域快取變數
let cachedPrices = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 分鐘有效（毫秒）

/**
 * 從 Google Sheets 讀取價格表，並建立 id → price 的對應
 */
async function fetchPriceMap() {
  if (!process.env.SHEET_ID) throw new Error('SHEET_ID not set');

  // 若快取仍有效 → 直接返回
  const now = Date.now();
  if (cachedPrices && now - lastFetchTime < CACHE_TTL) {
    return cachedPrices;
  }

  console.log('[preview] Fetching fresh prices from Google Sheets...');
  const sheets = await getSheetsClient();
  const data = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Products!A2:C', // A:id, B:title, C:price
  });

  const rows = data.data?.values || [];
  const map = Object.fromEntries(
    rows.map((r) => [r[0], Number(r[2] || 0)])
  );

  cachedPrices = map;
  lastFetchTime = now;
  console.log(`[preview] Price map cached (${Object.keys(map).length} items).`);
  return map;
}

/**
 * 金額試算 API
 * POST /api/preview
 */
router.post('/', async (req, res) => {
  try {
    const { items = [], shippingMethod = 'store', promoCode = '' } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items provided' });
    }

    // ✅ 從快取（或 Sheets）取得價格表
    const priceMap = await fetchPriceMap();

    // ✅ 計算小計
    const subtotal = items.reduce((sum, it) => {
      const price = priceMap[it.id] || 0;
      return sum + price * (it.qty || 0);
    }, 0);

    // ✅ 優惠碼邏輯
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
      cache: {
        valid: !!cachedPrices,
        lastFetch: new Date(lastFetchTime).toISOString(),
      },
    });
  } catch (err) {
    console.error('[previewTotals] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
