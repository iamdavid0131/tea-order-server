// lib/member.js
import { normalizePhoneTW, computeTierBySum } from './utils.js';
import { awardTierGiftOnUpgrade } from './lineGift.js';
import { getDoc } from './sheets.js';

const SHEET_NAME = 'Members';

/**
 * 📌 讀取 Sheet + 自動建立欄位 + 建立 phone & lineUser 快取索引
 */
async function loadMembersSheet() {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle[SHEET_NAME];
  if (!sheet) throw new Error(`找不到工作表 "${SHEET_NAME}"`);

  // ✅ 自動偵測 header 起始列
  let headers;
  try {
    await sheet.loadHeaderRow(1);
    headers = sheet.headerValues;
    if (!headers.includes('phone')) {
      throw new Error('Wrong header row');
    }
  } catch (e) {
    console.warn('⚠️ Header not in row 1, fallback to row 2');
    await sheet.loadHeaderRow(2);
  }

  await ensureMemberCols(sheet);
  const rows = await sheet.getRows();

  // ✅ 快取
  const phoneIndex = {};
  const lineIndex = {};

  for (const r of rows) {
    const p = r.phone || r['phone'] || r._rawData?.[1]; // ✅ RAW fallback
    if (p) phoneIndex[normalizePhoneTW(p)] = r;
    if (r.lineUserId) lineIndex[r.lineUserId] = r;
  }

  return { sheet, rows, phoneIndex, lineIndex };
}

/**
 * ✅ 自動補齊缺少欄位
 */
async function ensureMemberCols(sheet) {
  const required = [
    'member_id', 'phone', 'name', 'tier', 'totals_sum',
    'orders_count', 'default_shipping_method', 'default_carrier',
    'default_store_name', 'default_address',
    'created_at', 'updated_at', 'lineUserId', 'lineLinkedAt'
  ];

  const headers = [...sheet.headerValues]; // ✅ 保留原順序
  let changed = false;

  // ✅ 只補缺少欄位，不改現有欄位位置
  for (const h of required) {
    if (!headers.includes(h)) {
      headers.push(h);
      changed = true;
    }
  }

  if (changed) {
    await sheet.setHeaderRow(headers);
    console.log('🧩 Members Sheet 欄位補齊並保留原順序 ✅');
  }
}


/**
 * 🔍 查找會員（依電話，無則回 null）
 * ✅ 支援 09xxxx 與 +8869xxxx 格式
 */
export async function findMemberByPhone(phone) {
  try {
    const norm = normalizePhoneTW(phone);
    const { rows, phoneIndex } = await loadMembersSheet();

    let row = phoneIndex[norm];

    if (!row) {
      row = rows.find(r =>
        r.phone === phone ||
        normalizePhoneTW(r.phone) === norm
      );
    }

    if (!row) return null;

    return formatMember(row);

  } catch (err) {
    console.error('❌ findMemberByPhone error', { phone }, err);
    throw err;
  }
}



/**
 * 🔍 查找會員（LINE UserID）
 */
export async function findMemberByLine(userId) {
  const { lineIndex } = await loadMembersSheet();
  return lineIndex[userId] || null;
}

/**
 * 🔗 綁定 LINE 與電話（自動建新會員）
 */
export async function updateOrCreateBind(userId, phone) {
  try {
    const now = new Date().toISOString();
    const norm = normalizePhoneTW(phone);

    const { sheet, phoneIndex, lineIndex } = await loadMembersSheet();

    const byPhone = phoneIndex[norm] || null;
    const byLine = lineIndex[userId] || null;

    // 📌 已存在但綁不同 LINE
    if (byPhone && byPhone.lineUserId && byPhone.lineUserId !== userId) {
      return { ok: false, reason: 'PHONE_BOUND_OTHER' };
    }

    // ✅ LINE 已綁，但未填電話 → 更新
    if (byLine) {
      byLine.phone = norm;
      byLine.lineLinkedAt = now;
      await byLine.save();
      return { ok: true, created: false, member_id: byLine.member_id };
    }

    // ✅ 電話已存在，但未綁 LINE → 補綁
    if (byPhone) {
      byPhone.lineUserId = userId;
      byPhone.lineLinkedAt = now;
      await byPhone.save();
      return { ok: true, created: false, member_id: byPhone.member_id };
    }

    // ✅ 新會員
    const newRow = await sheet.addRow({
      member_id: 'M' + Date.now(),
      phone: norm,
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

    return { ok: true, created: true, member_id: newRow.member_id };

  } catch (err) {
    console.error('❌ updateOrCreateBind error:', { userId, phone }, err);
    return { ok: false, error: err.message };
  }
}

/**
 * 🧾 訂單累積 + 升等判斷 + 發禮物（自動建新會員）
 */
export async function recordOrderForMember(phoneRaw, orderTotal, shipInfo = {}) {
  try {
    const now = new Date().toISOString();
    const phone = normalizePhoneTW(phoneRaw);
    const { sheet, phoneIndex } = await loadMembersSheet();

    let member = phoneIndex[phone];
    const created = !member;

    // ⬆️ 新會員先建
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
    }

    const prevTier = String(member.tier || '');
    const prevSum = Number(member.totals_sum || 0);
    const prevCnt = Number(member.orders_count || 0);

    const add = Math.max(0, Number(orderTotal));
    const newSum = prevSum + add;
    const newCnt = prevCnt + 1;
    const newTier = computeTierBySum(newSum);

    // 🔄 更新資料
    member.updated_at = now;
    member.totals_sum = newSum;
    member.orders_count = newCnt;
    member.tier = newTier;

    member.default_shipping_method = shipInfo.method || member.default_shipping_method;
    member.default_carrier = shipInfo.carrier || member.default_carrier;
    member.default_store_name = shipInfo.storeName || member.default_store_name;
    member.default_address = shipInfo.address || member.default_address;

    await member.save();

    // 🎁 若升等且有 LINE 綁定 → 發放升級禮
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

    return {
      ok: true,
      created,
      newTier,
      newSum,
      orders_count: newCnt,
      member_id: member.member_id,
      phone
    };

  } catch (err) {
    console.error('❌ recordOrderForMember error:', { phoneRaw }, err);
    return { ok: false, error: err.message };
  }
}

function formatMember(row) {
  if (!row) return null;
  return {
    member_id: row.member_id || '',
    phone: row.phone || row._rawData?.[1] || '',
    name: row.name || '',
    tier: row.tier || '',
    totals_sum: Number(row.totals_sum || 0),
    orders_count: Number(row.orders_count || 0),
    default_shipping_method: row.default_shipping_method || '',
    default_carrier: row.default_carrier || '',
    default_store_name: row.default_store_name || '',
    default_address: row.default_address || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    lineUserId: row.lineUserId || '',
    lineLinkedAt: row.lineLinkedAt || '',
  };
}
