// lib/member.js
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { normalizePhoneTW, computeTierBySum } from './utils.js';
import { awardTierGiftOnUpgrade } from './lineGift.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

const SHEET_ID = process.env.GOOGLE_SHEETS_SHEET_ID;
const SHEET_NAME = 'Members';

/* --------------------------
   Google Sheet 初始化（新版 SDK）
--------------------------- */
async function getDoc() {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);

    // ✅ 新版授權方式：只傳入 email + private_key
    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n'),
    });

    await doc.loadInfo();
    console.log("✅ 已連線到 Google Sheet:", SHEET_ID);
    return doc;
  } catch (err) {
    console.error("❌ Google Sheet 初始化失敗:", err);
    throw new Error("Google Sheet 授權或載入失敗");
  }
}

/* --------------------------
   確保欄位完整性
--------------------------- */
async function ensureMemberCols(sheet) {
  const required = [
    'member_id', 'phone', 'name', 'tier', 'totals_sum',
    'orders_count', 'default_shipping_method', 'default_carrier',
    'default_store_name', 'default_address',
    'created_at', 'updated_at', 'lineUserId', 'lineLinkedAt'
  ];
  const headers = sheet.headerValues || [];
  let updated = false;

  for (const key of required) {
    if (!headers.includes(key)) {
      headers.push(key);
      updated = true;
    }
  }
  if (updated) await sheet.setHeaderRow(headers);
  return headers;
}

/* --------------------------
   查找會員
--------------------------- */
async function findMemberByPhone(phone) {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle[SHEET_NAME];
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const p = normalizePhoneTW(phone);
  return rows.find(r => normalizePhoneTW(r.phone) === p) || null;
}

/* --------------------------
   綁定 LINE 帳號
--------------------------- */
async function updateOrCreateBind(userId, phone) {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle[SHEET_NAME];
  await sheet.loadHeaderRow();
  await ensureMemberCols(sheet);

  const rows = await sheet.getRows();
  const normPhone = normalizePhoneTW(phone);
  const now = new Date().toISOString();

  let member = rows.find(r => r.lineUserId === userId);
  let existing = rows.find(r => normalizePhoneTW(r.phone) === normPhone);

  if (existing && existing.lineUserId && existing.lineUserId !== userId) {
    return { ok: false, reason: 'PHONE_BOUND_OTHER' };
  }

  // 如果已有相同 userId → 更新電話
  if (member) {
    member.phone = normPhone;
    member.lineLinkedAt = now;
    await member.save();
    return { ok: true, created: false, phone: normPhone };
  }

  // 如果有該電話 → 綁上 LINE ID
  if (existing) {
    existing.lineUserId = userId;
    existing.lineLinkedAt = now;
    await existing.save();
    return { ok: true, created: false, phone: normPhone };
  }

  // 新增會員
  await sheet.addRow({
    member_id: 'M' + Date.now(),
    phone: normPhone,
    name: '',
    tier: '',
    totals_sum: 0,
    orders_count: 0,
    default_shipping_method: '',
    default_carrier: '',
    default_store_name: '',
    default_address: '',
    created_at: now,
    updated_at: now,
    lineUserId: userId,
    lineLinkedAt: now,
  });

  return { ok: true, created: true, phone: normPhone };
}

/* --------------------------
   寫入訂單累積紀錄（升級觸發）
--------------------------- */
async function recordOrderForMember(phoneRaw, orderTotal, shipInfo = {}) {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle[SHEET_NAME];
  await sheet.loadHeaderRow();
  await ensureMemberCols(sheet);

  const rows = await sheet.getRows();
  const phone = normalizePhoneTW(phoneRaw);
  const row = rows.find(r => normalizePhoneTW(r.phone) === phone);

  const now = new Date().toISOString();
  let member = row;
  let created = false;

  if (!member) {
    // 若找不到會員，建立一筆新資料
    member = await sheet.addRow({
      member_id: 'M' + Date.now(),
      phone,
      name: '',
      tier: '',
      totals_sum: 0,
      orders_count: 0,
      default_shipping_method: '',
      default_carrier: '',
      default_store_name: '',
      default_address: '',
      created_at: now,
      updated_at: now,
      lineUserId: '',
      lineLinkedAt: '',
    });
    created = true;
  }

  const prevTier = member.tier || '';
  const prevSum = parseFloat(member.totals_sum || 0);
  const prevCnt = parseInt(member.orders_count || 0);

  const add = Math.max(0, Number(orderTotal || 0));
  const newSum = prevSum + add;
  const newCnt = prevCnt + 1;
  const newTier = computeTierBySum(newSum);

  member.totals_sum = newSum;
  member.orders_count = newCnt;
  member.updated_at = now;
  member.tier = newTier;

  member.default_shipping_method = shipInfo.method || member.default_shipping_method;
  member.default_carrier = shipInfo.carrier || member.default_carrier;
  member.default_store_name = shipInfo.storeName || member.default_store_name;
  member.default_address = shipInfo.address || member.default_address;

  await member.save();

  // 若有升等 → 發升等禮
  if (!created && newTier !== prevTier && member.lineUserId) {
    await awardTierGiftOnUpgrade(
      prevTier,
      newTier,
      phone,
      member.name || '',
      member.lineUserId,
      shipInfo.orderId
    );
  }

  return { ok: true, newTier, newSum };
}

/* --------------------------
   匯出
--------------------------- */
export { findMemberByPhone, updateOrCreateBind, recordOrderForMember, ensureMemberCols };
