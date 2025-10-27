import express from 'express';
import { getSheetsClient } from '../lib/sheets.js';
import { normalizePhoneTW, computeTierBySum } from '../lib/utils.js';
import { awardTierGiftOnUpgrade } from '../lib/lineGift.js';
import { sendOrderNotification } from '../lib/notify.js';

const router = express.Router();

/**
 * 每筆訂單建立後，從 Orders 表更新 Members 的累積資料
 */
router.post('/sync', async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;

    // 讀取最新一筆未同步的訂單
    const ordersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Orders!A2:AZ', // 足夠覆蓋所有欄位
    });
    const orders = ordersRes.data.values || [];
    if (!orders.length) return res.json({ ok: true, msg: '無訂單資料' });

    // 假設每次同步「最新一筆訂單」
    const lastOrder = orders[orders.length - 1];
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Orders!1:1',
    });
    const headers = headerRes.data.values[0];

    const get = key => lastOrder[headers.indexOf(key)] || '';

    const orderId = get('OrderID');
    const name = get('BuyerName');
    const phone = normalizePhoneTW(get('BuyerPhone'));
    const method = get('ShippingMethod');
    const storeCarrier = get('StoreCarrier');
    const storeName = get('StoreName');
    const address = get('CODAddress');
    const total = Number(get('Total') || 0);

    if (!phone || !total) {
      return res.status(400).json({ ok: false, error: '缺少 BuyerPhone 或 Total 欄位' });
    }

    // === 讀取 Members 表 ===
    const memRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Members!A2:N',
    });
    const members = memRes.data.values || [];

    const nowIso = new Date().toISOString();
    const phoneNorm = normalizePhoneTW(phone);

    // === 找會員 ===
    let foundIdx = -1;
    for (let i = 0; i < members.length; i++) {
      const p = normalizePhoneTW(members[i][1] || '');
      if (p === phoneNorm) {
        foundIdx = i;
        break;
      }
    }

    if (foundIdx >= 0) {
      // === 更新既有會員 ===
      const m = members[foundIdx];
      const prevTier = m[3];
      const prevSum = Number(m[4] || 0);
      const prevCount = Number(m[5] || 0);
      const newSum = prevSum + total;
      const newCount = prevCount + 1;
      const newTier = computeTierBySum(newSum);

      m[3] = newTier;
      m[4] = newSum;
      m[5] = newCount;
      m[6] = method;
      m[7] = storeCarrier;
      m[8] = storeName;
      m[9] = address;
      m[11] = nowIso; // updated_at

      const range = `Members!A${foundIdx + 2}:N${foundIdx + 2}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [m] },
      });

      // 升等贈禮
      const userId = m[12];
      const memberName = m[2];
      await awardTierGiftOnUpgrade(prevTier, newTier, phone, memberName, userId, orderId);
    } else {
      // === 新會員 ===
      const memberId = 'M' + Date.now();
      const tier = computeTierBySum(total);
      const newRow = [
        memberId,
        phoneNorm,
        '',
        tier,
        total,
        1,
        method,
        storeCarrier,
        storeName,
        address,
        nowIso,
        nowIso,
        '',
        '',
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Members!A:N',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
    }

    // === 新增：發送通知 ===
    await sendOrderNotification({
      orderId,
      name,
      phone,
      total,
      items: [], // 可從表中擷取實際品項
      method,
      address,
      storeName,
      storeCarrier,
    });

    res.json({ ok: true, orderId, total });
  } catch (err) {
    console.error('[orders/sync] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
