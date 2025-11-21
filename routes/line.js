// routes/line.js
import express from 'express';
import { lineReply, verifyLineSignature, buildLineLoginBindUrl } from '../lib/line.js';
import { normalizePhoneTW } from '../lib/utils.js';
import { findMemberByLine, findMemberByPhone } from '../lib/member.js'; // 假設你有這個查詢函式
import { buildMemberTierFlex, buildOrderFlex, buildBindInviteFlex } from '../lib/lineFlex.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    if (!verifyLineSignature(req)) return res.status(403).send('Invalid signature');

    const events = req.body.events || [];
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        await handleTextMessage(event);
      }
    }
    res.send('OK');
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).send('Internal Server Error');
  }
});

async function handleTextMessage(event) {
  const { replyToken, source } = event;
  const userId = source.userId;
  const text = event.message.text.trim();

  // 1. 綁定指令
  if (/^綁定\s*/.test(text)) {
    // 產生綁定按鈕卡片
    const bindUrl = buildLineLoginBindUrl(); // 不帶參數，讓用戶自己去登入頁
    const flex = buildBindInviteFlex(bindUrl);
    return lineReply(replyToken, flex);
  }

  // 2. 查訂單
  if (/^(查訂單|查單)$/.test(text)) {
    const member = await findMemberByLine(userId);
    if (!member) {
      const bindUrl = buildLineLoginBindUrl();
      return lineReply(replyToken, buildBindInviteFlex(bindUrl));
    }

    // 這裡假設 findMemberByPhone 也會回傳最近一筆訂單資訊
    // 實際專案中可能需要獨立的 getOrder API
    // 這裡模擬資料結構
    const flex = buildOrderFlex({
      buyerName: member.name || '貴賓',
      dateText: member.lastOrderDate || '尚無訂單',
      summary: member.lastOrderSummary || '無近期訂單',
      totalNum: member.lastOrderTotal || 0,
      status: member.lastOrderStatus || '無'
    });
    return lineReply(replyToken, flex);
  }

  // 3. 會員等級
  if (/^(會員等級|等級)$/.test(text)) {
    const member = await findMemberByLine(userId);
    if (!member) {
      const bindUrl = buildLineLoginBindUrl();
      return lineReply(replyToken, buildBindInviteFlex(bindUrl));
    }

    const flex = buildMemberTierFlex({
      name: member.name,
      totals_sum: member.totalSpend
    });
    return lineReply(replyToken, flex);
  }

  // 4. Help
  if (/^(help|幫助|選單)$/i.test(text)) {
    return lineReply(replyToken, {
      type: 'text',
      text: '🍵 祥興茶行 服務指令：\n\n📱 輸入「綁定」：連結會員資料\n📦 輸入「查訂單」：查詢最近訂單\n💎 輸入「等級」：查看會員權益'
    });
  }
}

export default router;