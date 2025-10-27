// 配置相關路由
import express from 'express';
import { getSheetsClient } from '../lib/sheets.js';

const router = express.Router();


// 從 Google Sheets 讀取商品資料
router.get('/', async (req, res) => {
  try {
    if (!process.env.SHEET_ID) {
      return res.status(500).json({ 
        ok: false, 
        error: 'Server configuration error: SHEET_ID is not set' 
      });
    }

    console.log('Fetching products from Google Sheets...');
    const sheets = await getSheetsClient();
    
    console.log('Accessing spreadsheet with ID:', process.env.SHEET_ID);
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Products!A2:V',
    });
    
    if (!data.data || !data.data.values) {
      console.error('No data returned from Google Sheets:', data);
      return res.status(500).json({ 
        ok: false, 
        error: 'No data returned from Google Sheets' 
      });
    }

    const rows = data.data.values || [];
    const items = rows.map((r) => ({
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
    }));

    res.json({ ok: true, data: items });
  } catch (err) {
    console.error('[config/products] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
