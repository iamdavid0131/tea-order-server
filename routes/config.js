// routes/config.js
import express from 'express';
import { getSheetsClient } from '../lib/sheets.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    if (!process.env.SHEET_ID) {
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error: SHEET_ID is not set',
      });
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;

    // 同步讀取兩個表格：Products + Stock
    const [productsRes, stockRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Products!A2:V',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Stock!A2:C',
      }),
    ]);

    const productRows = productsRes.data.values || [];
    const stockRows = stockRes.data.values || [];

    // 整理庫存表為對照表 { ProductID: Stock }
    const stockMap = {};
    for (const r of stockRows) {
      const pid = r[0];
      const qty = parseInt(r[2] || 0);
      stockMap[pid] = qty;
    }

    // 整理商品資料並附上 stock
    const items = productRows.map(r => ({
      id: r[0],
      title: r[1],
      price: +r[2],
      unit: r[3],
      category: r[4],
      packable: r[5] === 'TRUE',
      tagline: r[6],
      tags: (r[7] || '').split(','),
      story: r[8],
      brew: {
        hot: {
          grams: +r[9],
          water_ml: +r[10],
          temp_c: r[11],
          time_s: +r[12],
          infusions: r[13],
        },
        cold: {
          grams: +r[14],
          water_ml: +r[15],
          hours: r[16],
        },
      },
      profile: {
        sweetness: +r[17],
        aroma: +r[18],
        roast: +r[19],
        body: +r[20],
        finish: +r[21],
      },
      stock: stockMap[r[0]] ?? 0, // ✅ 整合庫存
    }));

    res.json({ ok: true, data: items });
  } catch (err) {
    console.error('[config/products] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
