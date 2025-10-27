// routes/member.js
import express from 'express';
import { recordOrderForMember } from '../lib/member.js';

const router = express.Router();

/**
 * 新訂單 → 更新會員資料 + 累積金額 + 檢查升等 + 推播
 * @body { phone, orderTotal, method, carrier, storeName, address, orderId }
 */
router.post('/order', async (req, res) => {
  try {
    const { phone, orderTotal, method, carrier, storeName, address, orderId } = req.body;
    if (!phone || !orderTotal) {
      return res.status(400).json({ ok: false, error: '缺少 phone 或 orderTotal' });
    }

    const result = await recordOrderForMember(phone, orderTotal, {
      method, carrier, storeName, address, orderId,
    });

    res.json({ ok: true, message: '會員資料已更新', data: result });
  } catch (err) {
    console.error('[Member API Error]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
