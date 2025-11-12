// routes/member.js
import express from 'express';
import { findMemberByPhone, recordOrderForMember } from '../lib/member.js';

const router = express.Router();
const frontendUrl = process.env.FRONTEND_URL || "https://tea-shop-frontend.onrender.com";


/**
 * 🔍 查詢會員資料 by phone
 * GET /api/member?phone=0912345678
 */
router.get('/', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) {
      return res.status(400).json({
        ok: false,
        data: null,
        error: '缺少 phone'
      });
    }

    const member = await findMemberByPhone(phone);

    if (!member) {
      return res.json({
        ok: true,
        exists: false,
        data: null,
        message: '查無此會員'
      });
    }

    let recentStores = [];
    let recentAddresses = [];
    try {
      recentStores = member.recent_stores
        ? JSON.parse(member.recent_stores)
        : [];
    } catch {
      recentStores = [];
    }
    try {
      recentAddresses = member.recent_addresses
        ? JSON.parse(member.recent_addresses)
        : [];
    } catch {
      recentAddresses = [];
    }


    res.json({
      ok: true,
      exists: true,
      data: {
        phone: member.phone,
        name: member.name || '',
        tier: member.tier || '',
        totals_sum: Number(member.totals_sum || 0),
        orders_count: Number(member.orders_count || 0),
        address: member.default_address || '',
        storeName: member.default_store_name || '',
        shipping: member.default_shipping_method || '',
        member_id: member.member_id || '',
        recentStores,
        recentAddresses,
      }
    });

  } catch (err) {
    console.error('[GET /api/member] Error:', err);
    res.status(500).json({
      ok: false,
      data: null,
      error: err.message
    });
  }
});

/**
 * 🧾 新訂單 → 更新累積金額 + 判斷升等 + LINE 推播
 * POST /api/member/order
 */
router.post('/order', async (req, res) => {
  try {
    const { phone, orderTotal, method, carrier, storeName, address, orderId } = req.body;

    if (!phone || !orderTotal) {
      return res.status(400).json({
        ok: false,
        data: null,
        error: '缺少 phone 或 orderTotal'
      });
    }

    const result = await recordOrderForMember(phone, orderTotal, {
      method, carrier, storeName, address, orderId,
    });

    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        data: null,
        error: result.error,
      });
    }

    res.json({
      ok: true,
      data: {
        created: result.created,
        newTier: result.newTier,
        newSum: result.newSum,
        orders_count: result.orders_count,
        phone: result.phone,
        member_id: result.member_id,
        orderTotal,
      },
      message: '會員資料已更新'
    });

  } catch (err) {
    console.error('[POST /api/member/order] Error:', err);
    res.status(500).json({
      ok: false,
      data: null,
      error: err.message
    });
  }
});

export default router;
