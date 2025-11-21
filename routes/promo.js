import express from 'express';
import { createCoupon, checkCoupon, redeemCoupon } from '../lib/promo.js';

const router = express.Router();

/**
 * [Admin] 建立新優惠券
 * POST /api/promo
 * Body: { type, value, minSpend, expiresInDays, note }
 */
router.post('/', async (req, res) => {
  try {
    const { type, value } = req.body;
    if (!type || !value) return res.status(400).json({ ok: false, error: '缺少必要參數' });

    const result = await createCoupon(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 查詢/驗證優惠券 (前端結帳頁面使用)
 * GET /api/promo/:code?cartTotal=1000
 */
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const cartTotal = Number(req.query.cartTotal) || 0;

    if (!code) return res.status(400).json({ ok: false, error: '請輸入代碼' });

    const result = await checkCoupon(code, cartTotal);
    
    if (!result.ok) {
      // 這裡回傳 200 但 ok: false，讓前端可以優雅處理錯誤訊息
      return res.json(result); 
    }

    // 只回傳前端需要的安全資訊
    const { type, value, minSpend, note } = result.data;
    res.json({
      ok: true,
      data: { code, type, value, minSpend, note }
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 核銷優惠券 (訂單成立後呼叫)
 * POST /api/promo/:code/redeem
 * Body: { usedBy: 'User123' }
 */
router.post('/:code/redeem', async (req, res) => {
  try {
    const { code } = req.params;
    const { usedBy } = req.body;

    const result = await redeemCoupon(code, usedBy);
    
    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;