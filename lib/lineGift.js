// lib/lineGift.js
import fetch from 'node-fetch';
import { getSheetsClient } from './sheets.js';

const TIER_ORDER = ['銀卡', '金卡', '白金', '黑鑽'];

/**
 * 升等贈禮清單（實體）
 * 可以改成讀取 Sheet 或 JSON 配置
 */
const TIER_GIFTS = {
  '銀卡': '茉莉窨茶',
  '金卡': '阿里山烏龍',
  '白金': '斯馬庫斯烏龍',
  '黑鑽': '福壽山烏龍',
};

/**
 * 回傳等級排名
 */
function tierRank(tier) {
  const i = TIER_ORDER.indexOf(String(tier || '').trim());
  return i < 0 ? -1 : i;
}

/**
 * 寫入一筆 GiftQueue 佇列（待出貨升等禮）
 */
async function enqueueTierGift(phone, memberName, tier, gift, orderId) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const id = 'G' + Date.now();
  const now = new Date().toISOString();

  const row = [
    id, phone, memberName, tier, gift, orderId, now, 'PENDING', ''
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'GiftQueue!A:I',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return id;
}

/**
 * 檢查該會員在該等級是否已有升等禮排程
 */
async function hasGiftQueued(phone, tier) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'GiftQueue!A2:E',
  });
  const vals = res.data.values || [];
  return vals.some(([, ph,, ti]) => String(ph) === phone && String(ti) === tier);
}

/**
 * 發送 LINE 推播訊息
 */
async function pushLineMessage(userId, message) {
  if (!userId || !process.env.LINE_CHANNEL_TOKEN) return;
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [typeof message === 'string' ? { type: 'text', text: message } : message],
    }),
  });
}

/**
 * 🏆 核心功能：升等禮發放
 * 檢查從舊等級 → 新等級是否需要贈禮
 * - 寫入 GiftQueue
 * - 通知管理員
 * - 通知會員
 */
async function awardTierGiftOnUpgrade(prevTier, newTier, phone, memberName, userId, orderId) {
  const from = tierRank(prevTier);
  const to = tierRank(newTier);

  if (to <= from) return; // 沒升等就跳過

  const targetTier = TIER_ORDER[to];
  const gift = TIER_GIFTS[targetTier];
  if (!gift) return;

  // 避免重複派禮
  if (await hasGiftQueued(phone, targetTier)) return;

  const qid = await enqueueTierGift(phone, memberName, targetTier, gift, orderId);

  // 通知管理員
  const admin = process.env.LINE_ADMIN_USER_ID;
  if (admin) {
    await pushLineMessage(admin, {
      type: 'text',
      text: `🎁 升等贈禮待出貨\nQueueID: ${qid}\n會員：${memberName || '（未填）'}（${phone}）\n等級：${targetTier}\n贈品：${gift}`,
    });
  }

  // 通知會員
  if (userId) {
    await pushLineMessage(userId, {
      type: 'text',
      text: `🎉 恭喜升等【${targetTier}】！\n我們將寄出升等贈禮：${gift}\n若需變更收件資料，請於 24 小時內回覆客服。`,
    });
  }
}

export { awardTierGiftOnUpgrade, pushLineMessage };
