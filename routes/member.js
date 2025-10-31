import express from 'express';
import { findMemberByPhone, recordOrderForMember } from '../lib/member.js';

const router = express.Router();

/**
 * 📞 查詢會員資料 by phone
 * GET /api/member?phone=0912345678
 */
router.get('/', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ ok: false, error: '缺少 phone' });

    const member = await findMemberByPhone(phone);
    if (!member) {
      return res.json({ ok: false, message: '查無此會員' });
    }

    res.json({
      ok: true,
      data: {
        phone: member.phone,
        name: member.name || '',
        tier: member.tier || '',
        address: member.default_address || '',
        storeName: member.default_store_name || '',
        shipping: member.default_shipping_method || '',
      },
    });
  } catch (err) {
    console.error('[Member GET Error]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 🧾 新訂單 → 更新會員資料 + 累積金額 + 檢查升等 + 推播
 * POST /api/member/order
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
