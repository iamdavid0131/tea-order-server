import { getSheetsClient } from './sheets.js';
import { format, toDate } from 'date-fns-tz';
import { addDays, isPast, parseISO } from 'date-fns';
import crypto from 'crypto';

const TIME_ZONE = 'Asia/Taipei';
const SHEET_NAME = 'PromoCodes';
let couponsCache = null; // 🧠 記憶體快取
let lastFetchTime = 0;
const CACHE_TTL = 60 * 1000; // 快取存活時間：60秒 (可自行調整)

// 欄位對映 (方便維護，不用算 array index)
const COL_MAP = {
  code: 0, type: 1, value: 2, minSpend: 3, note: 4,
  createdAt: 5, expiresAt: 6, used: 7, usedBy: 8, userId: 9
};

/**
 * 產生隨機優惠碼 (更短、更易讀)
 */
function genPromoCode(prefix = 'TEA') {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `${prefix}-${rand}`;
}

/**
 * 初始化檢查 Sheet 是否存在 (只在伺服器啟動時檢查一次即可，或是發生錯誤時)
 */
async function ensureSheetExists() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetExists = meta.data.sheets.some(s => s.properties.title === SHEET_NAME);
    
    if (!sheetExists) {
      console.log('[promo] Creating sheet...');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A1:J1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['code', 'type', 'value', 'minSpend', 'note', 'createdAt', 'expiresAt', 'used', 'usedBy', 'userId']],
        },
      });
    }
  } catch (err) {
    console.error('[promo] init sheet error:', err.message);
  }
}

/**
 * 🔄 同步快取：從 Google Sheets 讀取所有資料
 */
async function syncCache(force = false) {
  const now = Date.now();
  // 如果快取還很新，且不強制更新，直接返回
  if (!force && couponsCache && (now - lastFetchTime < CACHE_TTL)) {
    return couponsCache;
  }

  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${SHEET_NAME}!A2:J`, // 讀取所有數據
    });
    
    const rows = res.data.values || [];
    
    // 轉換成好讀的物件格式，並紀錄 rowIndex 以便快速更新
    couponsCache = rows.map((row, index) => ({
      rowIndex: index + 2, // A2 是第 2 行
      code: row[COL_MAP.code],
      type: row[COL_MAP.type],
      value: Number(row[COL_MAP.value]),
      minSpend: Number(row[COL_MAP.minSpend] || 0),
      note: row[COL_MAP.note],
      createdAt: row[COL_MAP.createdAt],
      expiresAt: row[COL_MAP.expiresAt],
      used: row[COL_MAP.used] === 'TRUE',
      usedBy: row[COL_MAP.usedBy],
      userId: row[COL_MAP.userId],
    }));

    lastFetchTime = now;
    console.log(`[promo] Cache synced. ${couponsCache.length} coupons loaded.`);
    return couponsCache;
  } catch (err) {
    console.error('[promo] Sync cache failed:', err.message);
    // 如果失敗但有舊快取，先用舊的，避免服務中斷
    if (couponsCache) return couponsCache;
    throw err;
  }
}

/**
 * 建立新優惠券
 */
export async function createCoupon(opt = {}) {
  // 確保 Sheet 存在 (Lazy check)
  if (!couponsCache) await ensureSheetExists();

  const sheets = await getSheetsClient();
  const code = opt.customCode || genPromoCode();
  const now = new Date();
  const expiresAt = addDays(now, opt.expiresInDays || 30);
  
  const rowData = [
    code,
    opt.type || 'fixed', // fixed | percent
    opt.value || 0,
    opt.minSpend || 0,
    opt.note || '',
    format(now, 'yyyy-MM-dd HH:mm:ss', { timeZone: TIME_ZONE }),
    format(expiresAt, 'yyyy-MM-dd HH:mm:ss', { timeZone: TIME_ZONE }),
    'FALSE', // used
    '',      // usedBy
    opt.perUserId || '',
  ];

  // 1. 寫入 Google Sheet
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowData] },
  });

  // 2. 強制刷新快取，確保新建的券能馬上被查到
  await syncCache(true);

  return {
    ok: true,
    data: {
      code,
      type: opt.type,
      value: opt.value,
      expiresAt,
    }
  };
}

/**
 * 查詢並驗證優惠券 (Cache First)
 */
export async function checkCoupon(code, currentCartTotal = 0) {
  // 確保有快取
  const list = await syncCache(); 
  
  const coupon = list.find(c => c.code?.toUpperCase() === code?.toUpperCase());
  
  if (!coupon) {
    return { ok: false, error: '無效的優惠碼' };
  }

  // 驗證：是否已使用
  if (coupon.used) {
    return { ok: false, error: '此優惠碼已被使用' };
  }

  // 驗證：是否過期
  const expiryDate = new Date(coupon.expiresAt); // 這裡假設格式標準，若格式複雜需用 parse
  if (isPast(expiryDate)) {
    return { ok: false, error: '優惠碼已過期' };
  }

  // 驗證：最低消費
  if (currentCartTotal > 0 && currentCartTotal < coupon.minSpend) {
    return { ok: false, error: `未達最低消費金額 $${coupon.minSpend}` };
  }

  return { 
    ok: true, 
    data: coupon,
    message: '優惠碼適用'
  };
}

/**
 * 使用/核銷優惠券
 */
export async function redeemCoupon(code, usedBy = '') {
  // 1. 先驗證狀態
  const check = await checkCoupon(code);
  if (!check.ok) return check; // 如果無效直接回傳錯誤

  const coupon = check.data;
  const sheets = await getSheetsClient();

  // 2. 更新 Google Sheet (只更新 used 和 usedBy 欄位，減少傳輸量)
  // H欄是 used (index 7), I欄是 usedBy (index 8)
  // 對應 Excel 座標是 H{rowIndex}:I{rowIndex}
  const range = `${SHEET_NAME}!H${coupon.rowIndex}:I${coupon.rowIndex}`;

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['TRUE', usedBy]] },
    });

    // 3. 更新記憶體快取 (不用重新 fetch 整個 sheet，直接改記憶體)
    coupon.used = true;
    coupon.usedBy = usedBy;
    
    return { 
      ok: true, 
      discountType: coupon.type,
      discountValue: coupon.value,
      message: '優惠券核銷成功' 
    };

  } catch (err) {
    console.error('[promo] redeem failed:', err);
    return { ok: false, error: '核銷失敗，請稍後再試' };
  }
}