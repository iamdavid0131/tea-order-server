import express from 'express';
import { lineReply, verifyLineSignature } from '../lib/line.js';
import { normalizePhoneTW } from '../lib/utils.js';
import { findMemberByLine } from '../lib/member.js';
import { getRecentOrderByPhone } from '../lib/sheets.js';
import { buildMemberTierFlex, buildOrderFlex } from '../lib/lineFlex.js';

const router = express.Router();

// === Webhook 主入口 ===
router.post('/webhook', async (req, res) => {
  try {
    if (!verifyLineSignature(req)) return res.status(403).send('Invalid signature');

    const events = req.body.events || [];
    for (const event of events) await handleEvent(event);

    res.send('OK');
  } catch (err) {
    console.error('LINE webhook error:', err);
    res.status(500).send('Internal Server Error');
  }
});

async function handleEvent(event) {
  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;

  // === 文字訊息 ===
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text.trim();

    // 🔹 綁定手機
    if (/^綁定\s*/.test(text)) {
      const phoneRaw = text.replace(/^綁定\s*/, '').trim();
      const phone = normalizePhoneTW(phoneRaw);
      if (!/^09\d{8}$/.test(phone)) {
        return lineReply(replyToken, { type: 'text', text: '❌ 請輸入正確格式：09xxxxxxxx' });
      }

      // 更新會員資料
      const result = await findMemberByLine(userId, phone, true);
      return lineReply(replyToken, { type: 'text', text: result.message });
    }

    // 🔹 查訂單
    if (/^(查訂單|查单|查订单|查單)$/.test(text)) {
      const member = await findMemberByLine(userId);
      if (!member) return lineReply(replyToken, { type: 'text', text: '請先輸入「綁定 09xxxxxxxx」完成綁定。' });

      const phone = normalizePhoneTW(member.phone);
      const order = await getRecentOrderByPhone(phone);
      if (!order) return lineReply(replyToken, { type: 'text', text: '找不到您的訂單紀錄。' });

      const flex = buildOrderFlex({
        buyerName: member.name || '貴賓',
        dateText: order.date,
        summary: order.summary,
        totalNum: order.total,
        status: order.status,
      });
      return lineReply(replyToken, flex);
    }

    // 🔹 會員等級
    if (/^(會員等級|會員|等級|会员等级)$/.test(text)) {
      const member = await getMemberByLineId(userId);
      if (!member) return lineReply(replyToken, { type: 'text', text: '請先綁定手機後查詢會員等級。' });

      const flex = buildMemberTierFlex({
        name: member.name || '會員',
        totals_sum: Number(member.totalSpend || 0),
      });
      return lineReply(replyToken, flex);
    }

    // 🔹 幫助說明
    if (/^(help|幫助|指令|菜单)$/i.test(text)) {
      return lineReply(replyToken, {
        type: 'text',
        text: '📱 綁定 09xxxxxxxx\n📦 查訂單\n💎 會員等級\n❓ help（顯示說明）',
      });
    }

    // 其他訊息
    return lineReply(replyToken, { type: 'text', text: '我不太懂這個指令，您可以輸入「help」看看。' });
  }
}

export default router;
