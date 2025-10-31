// lib/member.js
import { normalizePhoneTW, computeTierBySum } from './utils.js';
import { awardTierGiftOnUpgrade } from './lineGift.js';
import { getDoc } from './sheets.js';

/* --------------------------
   常數設定
--------------------------- */
const SHEET_NAME = 'Members';

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

  if (updated) {
    await sheet.setHeaderRow(headers);
    console.log('🧩 Member Sheet 欄位已自動補齊');
  }

  return headers;
}

/* --------------------------
   查找會員（依電話）
--------------------------- */
export async function findMemberByPhone(phone) {
  try {
    console.log('🔍 查找會員:', phone);
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle[SHEET_NAME];
    if (!sheet) throw new Error(`找不到工作表 "${SHEET_NAME}"`);

    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    const p = normalizePhoneTW(phone);
    const found = rows.find(r => normalizePhoneTW(r.phone) === p) || null;

    console.log(found ? '✅ 找到會員' : '⚠️ 找不到會員');
    return found;
  } catch (err) {
    console.error('❌ findMemberByPhone 錯誤:', err);
    throw new Error('Google Sheet 授權或載入失敗');
  }
}

/* --------------------------
   綁定 LINE 帳號
--------------------------- */
export async function updateOrCreateBind(userId, phone) {
  try {
    console.log(`🔗 綁定 LINE 帳號 ${userId} <-> ${phone}`);
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

    if (member) {
      member.phone = normPhone;
      member.lineLinkedAt = now;
      await member.save();
      return { ok: true, created: false, phone: normPhone };
    }

    if (existing) {
      existing.lineUserId = userId;
      existing.lineLinkedAt = now;
      await existing.save();
      return { ok: true, created: false, phone: normPhone };
    }

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
  } catch (err) {
    console.error('❌ updateOrCreateBind 錯誤:', err);
    return { ok: false, error: err.message };
  }
}

/* --------------------------
   寫入訂單累積紀錄 + 檢查升等
--------------------------- */
export async function recordOrderForMember(phoneRaw, orderTotal, shipInfo = {}) {
  try {
    console.log('🧾 累積訂單紀錄:', phoneRaw, orderTotal);
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle[SHEET_NAME];
    await sheet.loadHeaderRow();
    await ensureMemberCols(sheet);

    const rows = await sheet.getRows();
    const phone = normalizePhoneTW(phoneRaw);
    const now = new Date().toISOString();
    let member = rows.find(r => normalizePhoneTW(r.phone) === phone);
    let created = false;

    if (!member) {
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
  } catch (err) {
    console.error('❌ recordOrderForMember 錯誤:', err);
    return { ok: false, error: err.message };
  }
}
