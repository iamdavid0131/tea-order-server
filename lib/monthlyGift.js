// lib/monthlyGift.js
const { getSheetsClient } = require('./sheets');
const { pushLineMessage } = require('./line');
const { createCoupon } = require('./promo'); // 產生優惠券用

// 不同會員等級每月禮遇
const MONTHLY_TIER_COUPONS = {
  銀卡: { type: 'percent', value: 5, minSpend: 600, expiresInDays: 30, note: '銀卡會員專屬 95 折' },
  金卡: { type: 'percent', value: 10, minSpend: 800, expiresInDays: 30, note: '金卡會員專屬 9 折' },
  白金: { type: 'fixed', value: 150, minSpend: 1000, expiresInDays: 30, note: '白金會員滿千折 150 元' },
  黑鑽: { type: 'fixed', value: 300, minSpend: 1500, expiresInDays: 45, note: '黑鑽會員滿千五折 300 元' },
};

async function sendMonthlyCoupons() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;

  // 讀取 Members
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Members!A2:N',
  });
  const rows = res.data.values || [];

  for (const r of rows) {
    const [id, phone, name, tier, , , , , , , , , lineUserId] = r;
    if (!tier || !lineUserId) continue;

    const reward = MONTHLY_TIER_COUPONS[tier];
    if (!reward) continue;

    // 生成優惠券
    const coupon = await createCoupon({
      type: reward.type,
      value: reward.value,
      minSpend: reward.minSpend,
      expiresInDays: reward.expiresInDays,
      note: reward.note,
      perUserId: lineUserId,
    });

    // 推播通知
    await pushLineMessage(lineUserId, {
      type: 'text',
      text: `🎁 ${tier}會員專屬 ${reward.note}\n優惠碼：${coupon.code}\n限期至 ${coupon.expireDate}\n立即前往 ${process.env.SHOP_ORDER_FORM_URL}`,
    });
  }

  console.log('✅ 月度優惠券已發送完畢');
}

module.exports = { sendMonthlyCoupons };
