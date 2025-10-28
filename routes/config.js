// routes/config.js
import express from 'express';
import { getSheetsClient } from '../lib/sheets.js';

const router = express.Router();

/**
 * 📦 從 Google Sheets 讀取商品資料
 * 對應試算表：Products!A2:V
 * 欄位對應：
 * id | title | price | unit | category | packable | tagline | tags | story |
 * brew_hot_grams | brew_hot_water_ml | brew_hot_temp_c | brew_hot_time_s | brew_hot_infusions |
 * brew_cold_grams | brew_cold_water_ml | brew_cold_hours |
 * profile_sweetness | profile_aroma | profile_roast | profile_body | profile_finish
 */
router.get('/', async (req, res) => {
  try {
    // --- 1️⃣ 確認環境變數 ---
    const SHEET_ID = process.env.SHEET_ID;
    if (!SHEET_ID) {
      return res.status(500).json({
        ok: false,
        error: '❌ Server configuration error: SHEET_ID not set'
      });
    }

    console.log('[config] Fetching products from Google Sheets...');
    const sheets = await getSheetsClient();

    // --- 2️⃣ 取得試算表資料 ---
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Products!A2:V',
    });

    const rows = data.data?.values || [];
    if (!rows.length) {
      console.error('[config] No product rows found.');
      return res.status(500).json({
        ok: false,
        error: 'No data returned from Google Sheets',
      });
    }

    // --- 3️⃣ 資料轉換 ---
    const items = rows.map((r, i) => ({
      id: r[0]?.trim() || `row${i + 2}`,
      title: r[1]?.trim() || '(未命名茶品)',
      price: Number(r[2]) || 0,
      unit: r[3] || '罐',
      category: r[4] || '未分類',
      packable: String(r[5]).toUpperCase() === 'TRUE',
      tagline: r[6] || '',
      tags: (r[7] || '').split(',').map(s => s.trim()).filter(Boolean),
      story: r[8] || '',
      brew: {
        hot: {
          grams: Number(r[9]) || 0,
          water_ml: Number(r[10]) || 0,
          temp_c: r[11] || '',
          time_s: Number(r[12]) || 0,
          infusions: r[13] || '',
        },
        cold: {
          grams: Number(r[14]) || 0,
          water_ml: Number(r[15]) || 0,
          hours: r[16] || '',
        },
      },
      profile: {
        sweetness: Number(r[17]) || 0,
        aroma: Number(r[18]) || 0,
        roast: Number(r[19]) || 0,
        body: Number(r[20]) || 0,
        finish: Number(r[21]) || 0,
      },
    }));

    // --- 4️⃣ 成功回傳 ---
    res.json({ ok: true, data: items });

  } catch (err) {
    console.error('[config/products] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
