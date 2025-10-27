// 預覽相關路由
import express from 'express';
import { calcShipping } from '../lib/utils.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { items = [], shippingMethod = 'store', promoCode = '' } = req.body;

    const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
    let discount = 0;

    // 優惠碼邏輯（可自行擴充）
    if (promoCode && promoCode.toLowerCase() === 'tea10') {
      discount = Math.round(subtotal * 0.1);
    }

    const totalAfterDiscount = subtotal - discount;
    const shipping = calcShipping(totalAfterDiscount, shippingMethod);
    const total = totalAfterDiscount + shipping;

    res.json({
      ok: true,
      data: { subtotal, discount, totalAfterDiscount, shipping, total },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
