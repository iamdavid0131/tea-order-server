import { getSheetsClient } from './sheets.js';
import { format } from 'date-fns-tz';
import { addDays } from 'date-fns';
import crypto from 'crypto';

/**
 * 產生隨機優惠碼
 */
function genPromoCode(prefix = 'TEA') {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${rand}`;
}

/**
 * 建立新優惠券
 * @param {Object} opt
 * @param {'fixed'|'percent'} opt.type 折扣類型
 * @param {number} opt.value 折扣金額或百分比
 * @param {number} opt.minSpend 最低消費
 * @param {number} opt.expiresInDays 幾天後到期
 * @param {string} opt.note 備註或說明
 * @param {string} [opt.perUserId] LINE userId，用來標記專屬券
 */
export async function createCoupon(opt = {}) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const sheetName = 'PromoCodes';

  // 檢查試算表是否有該工作表
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetNames = meta.data.sheets.map(s => s.properties.title);
    if (!sheetNames.includes(sheetName)) {
      // 自動建立 PromoCodes 表
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: { properties: { title: sheetName } },
            },
          ],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:J1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'code','type','value','minSpend','note','createdAt',
            'expiresAt','used','usedBy','userId'
          ]],
        },
      });
    }
  } catch (err) {
    console.error('[promo] check sheet error:', err.message);
  }

  // 建立一筆優惠券資料
  const code = genPromoCode();
  const now = new Date();
  const expiresAt = addDays(now, opt.expiresInDays || 30);

  const row = [
    code,
    opt.type,
    opt.value,
    opt.minSpend || 0,
    opt.note || '',
    format(now, 'yyyy-MM-dd HH:mm:ss', { timeZone: 'Asia/Taipei' }),
    format(expiresAt, 'yyyy-MM-dd HH:mm:ss', { timeZone: 'Asia/Taipei' }),
    '', // used
    '', // usedBy
    opt.perUserId || '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:J`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return {
    ok: true,
    code,
    type: opt.type,
    value: opt.value,
    minSpend: opt.minSpend,
    note: opt.note,
    expiresAt,
  };
}

/**
 * 查詢優惠券
 */
export async function getCoupon(code) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const sheetName = 'PromoCodes';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:J`,
  });
  const rows = res.data.values || [];
  const row = rows.find(r => (r[0] || '').toUpperCase() === code.toUpperCase());
  if (!row) return null;

  return {
    code: row[0],
    type: row[1],
    value: Number(row[2]),
    minSpend: Number(row[3]),
    note: row[4],
    createdAt: row[5],
    expiresAt: row[6],
    used: !!row[7],
    usedBy: row[8],
    userId: row[9],
  };
}

/**
 * 標記優惠券已使用
 */
export async function markCouponUsed(code, usedBy = '') {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const sheetName = 'PromoCodes';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:J`,
  });
  const rows = res.data.values || [];
  const idx = rows.findIndex(r => (r[0] || '').toUpperCase() === code.toUpperCase());
  if (idx < 0) return { ok: false, error: 'Coupon not found' };

  const row = rows[idx];
  row[7] = 'TRUE';
  row[8] = usedBy;
  const range = `${sheetName}!A${idx + 2}:J${idx + 2}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return { ok: true, code };
}
