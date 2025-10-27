import express from 'express';
import { getSheetsClient } from '../lib/sheets.js';
import { parseISO, isBefore } from 'date-fns';
import { format } from 'date-fns-tz';

const router = express.Router();

/**
 * 每日清理過期優惠券
 * - 檢查 PromoCodes 表的 expiresAt
 * - 若已過期且未使用，則將 used 欄標記為 "EXPIRED"
 */
router.post('/', async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;
    const sheetName = 'PromoCodes';

    // 讀取資料
    const resVals = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:J`,
    });
    const rows = resVals.data.values || [];
    if (!rows.length) return res.json({ ok: true, msg: '無資料' });

    const now = new Date();
    const expiredRows = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const expiresAtStr = r[6];
      const used = r[7];
      if (!expiresAtStr || used) continue;

      try {
        const expiresAt = parseISO(expiresAtStr);
        if (isBefore(expiresAt, now)) {
          // 標記為已過期
          r[7] = 'EXPIRED';
          r[8] = 'System';
          expiredRows.push({ idx: i, code: r[0] });

          const range = `${sheetName}!A${i + 2}:J${i + 2}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [r] },
          });
        }
      } catch (err) {
        console.warn('[cleanupCoupons] invalid date:', expiresAtStr);
      }
    }

    const summary = {
      ok: true,
      expiredCount: expiredRows.length,
      expiredCodes: expiredRows.map(r => r.code),
      time: format(now, 'yyyy/MM/dd HH:mm:ss', { timeZone: 'Asia/Taipei' }),
    };

    console.log('[cleanupCoupons]', summary);
    res.json(summary);
  } catch (err) {
    console.error('[cleanupCoupons] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
