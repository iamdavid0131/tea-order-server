// routes/promo.js
import express from 'express';
import { createCoupon, getCoupon, markCouponUsed } from '../lib/promo.js';

const router = express.Router();

// 建立新優惠券
router.post('/', async (req, res) => {
  try {
    const data = await createCoupon(req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 查詢優惠券
router.get('/:code', async (req, res) => {
  try {
    const coupon = await getCoupon(req.params.code);
    if (!coupon) return res.status(404).json({ ok: false, error: 'Coupon not found' });
    res.json({ ok: true, data: coupon });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 標記已使用
router.post('/:code/use', async (req, res) => {
  try {
    const result = await markCouponUsed(req.params.code, req.body.usedBy);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
