// lib/lineGift.js
import { getSheetsClient } from './sheets.js';
import { linePush } from './line.js'; // 使用統一的 line.js
import { buildGiftNotificationFlex } from './lineFlex.js'; // 引入美美的卡片

const TIER_ORDER = ['銀卡', '金卡', '白金', '黑鑽'];
const TIER_GIFTS = {
  '銀卡': '茉莉窨茶 (袋裝)',
  '金卡': '阿里山烏龍 (精裝)',
  '白金': '斯馬庫斯烏龍 (禮盒)',
  '黑鑽': '福壽山烏龍 (頂級禮盒)',
};

function tierRank(tier) {
  return TIER_ORDER.indexOf(String(tier || '').trim());
}

async function hasGiftQueued(phone, tier) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'GiftQueue!A2:D',
  });
  const vals = res.data.values || [];
  // 假設欄位順序: ID, Phone, Name, Tier ...
  return vals.some(([, ph,, ti]) => String(ph) === String(phone) && String(ti) === tier);
}

async function enqueueTierGift(phone, memberName, tier, gift, orderId) {
  const sheets = await getSheetsClient();
  const id = 'G' + Date.now();
  const row = [id, phone, memberName, tier, gift, orderId, new Date().toISOString(), 'PENDING', ''];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: 'GiftQueue!A:I',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
  return id;
}

/**
 * 🏆 升等禮發放主邏輯
 */
export async function awardTierGiftOnUpgrade(prevTier, newTier, phone, memberName, userId, orderId) {
  const from = tierRank(prevTier);
  const to = tierRank(newTier);

  if (to <= from) return; // 沒升等

  const targetTier = TIER_ORDER[to];
  const gift = TIER_GIFTS[targetTier];
  if (!gift) return;

  // 避免重複發放
  if (await hasGiftQueued(phone, targetTier)) return;

  const qid = await enqueueTierGift(phone, memberName, targetTier, gift, orderId);

  // 1. 通知管理員 (純文字即可)
  const admin = process.env.LINE_ADMIN_USER_ID;
  if (admin) {
    await linePush(admin, {
      type: 'text',
      text: `🎁 [後台] 升等禮待出貨\nQueueID: ${qid}\n會員: ${memberName}\n等級: ${targetTier}\n贈品: ${gift}`
    });
  }

  // 2. 通知會員 (使用旗艦 Flex 卡片)
  if (userId) {
    const flexMsg = buildGiftNotificationFlex(memberName, targetTier, gift);
    await linePush(userId, flexMsg);
  }
}