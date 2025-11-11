import express from "express";
import ecpay_payment from "ecpay_aio_nodejs";
import { getSheetsClient } from "../lib/sheets.js";
import { normalizePhoneTW } from "../lib/utils.js";
import { sendOrderNotification } from "../lib/notify.js";

const router = express.Router();

/**
 * 🧾 前端送出訂單：寫入 Google Sheets 的 Orders 表
 * ✅ 支援逐品項數量對應各欄位 + 綠界線上支付整合
 */
router.post("/submit", async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;
    const order = req.body;

    const now = new Date();
    const timestamp = now.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    const orderId = "O" + now.getTime();

    // === 取得表頭 ===
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Orders!1:1",
    });
    const headers = headerRes.data.values[0];

    // === 建立欄位對應 Map ===
    const rowMap = {
      Timestamp: timestamp,
      OrderID: orderId,
      BuyerName: order.buyerName || "",
      BuyerPhone: normalizePhoneTW(order.buyerPhone || ""),
      ShippingMethod: order.shippingMethod || "",
      StoreCarrier: order.storeCarrier || "",
      StoreName: order.storeName || "",
      CODAddress: order.codAddress || "",
      PromoCode: order.promoCode || "",
      Note: order.note || "",
      Consent: order.consent || "",
      PaymentMethod: order.paymentMethod || "",
      PaymentStatus: order.paymentStatus || "pending",
      PaymentTxId: order.paymentTxId || "",
      PaymentTime: order.paymentTime || "",
    };

    // === 初始化所有商品欄位為 0 ===
    headers.forEach((h) => {
      if (h.includes("_數量") || h.includes("_裝罐")) rowMap[h] = 0;
    });

    // === 依品項名稱填入對應數量與裝罐 ===
    for (const item of order.items || []) {
      const name = item.name?.trim() || "";
      const qty = Number(item.qty) || 0;
      const pack = item.pack ? 1 : 0;
      const qtyKey = `${name}_數量`;
      const packKey = `${name}_裝罐`;

      if (headers.includes(qtyKey)) rowMap[qtyKey] = qty;
      if (headers.includes(packKey)) rowMap[packKey] = pack;
    }

    // === 加上金額區 ===
    rowMap["PricingPolicy"] = JSON.stringify(order.pricingPolicy || {});
    rowMap["Subtotal"] = order.subtotal || 0;
    rowMap["Discount"] = order.discount || 0;
    rowMap["ShippingFee"] = order.shippingFee || 0;
    rowMap["Total"] = order.total || 0;
    rowMap["Status"] = "created";

    // === 組成 row ===
    const newRow = headers.map((h) => rowMap[h] ?? "");

    // === 寫入 Google Sheets ===
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Orders!A:AZ",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });

    // === 若為線上支付（非貨到付款） → 建立綠界交易 ===
    if (order.paymentMethod && order.paymentMethod !== "cod") {
      const ecpay = new ecpay_payment({
        operationMode: "Test", // ⚠️ 上線請改 "Production"
        merchantID: process.env.ECPAY_MERCHANT_ID,
        hashKey: process.env.ECPAY_HASH_KEY,
        hashIV: process.env.ECPAY_HASH_IV,
      });

      const base_param = {
        MerchantTradeNo: orderId,
        MerchantTradeDate: now.toLocaleString("zh-TW", { hour12: false }),
        TotalAmount: order.total,
        TradeDesc: "祥興茶行訂單",
        ItemName: order.items.map((i) => i.name || "").join("#") || "茶葉商品",
        ReturnURL: process.env.ECPAY_RETURN_URL,
        ClientBackURL: process.env.ECPAY_CLIENT_BACK_URL,
        ChoosePayment: "ALL",
      };

      const htmlForm = ecpay.payment_client.aio_check_out_all(base_param);
      console.log("✅ 綠界表單已產生：", orderId);
      return res.json({ ok: true, orderId, paymentForm: htmlForm });
    }

    // === 若為貨到付款 → 傳送通知 & 回傳成功 ===
    await sendOrderNotification({
      orderId,
      name: order.buyerName,
      phone: order.buyerPhone,
      total: order.total,
      items: order.items,
      method: order.shippingMethod,
      address: order.codAddress,
      storeName: order.storeName,
      storeCarrier: order.storeCarrier,
    });

    res.json({ ok: true, orderId });
  } catch (err) {
    console.error("[order/submit] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 💰 綠界回傳付款結果
 */
router.post("/payment/callback", async (req, res) => {
  try {
    const { MerchantTradeNo, RtnCode, TradeNo, PaymentDate } = req.body;
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;

    const status = RtnCode === "1" ? "paid" : "failed";

    const ordersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Orders!A:AZ",
    });
    const rows = ordersRes.data.values || [];
    const header = rows[0];
    const idx = rows.findIndex((r) => r[1] === MerchantTradeNo);

    if (idx > 0) {
      const row = rows[idx];
      row[header.indexOf("PaymentStatus")] = status;
      row[header.indexOf("PaymentTxId")] = TradeNo;
      row[header.indexOf("PaymentTime")] = PaymentDate;

      const range = `Orders!A${idx + 1}:AZ${idx + 1}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });
    }

    console.log(`✅ 綠界付款結果回傳：${MerchantTradeNo} (${status})`);
    res.send("1|OK");
  } catch (err) {
    console.error("[payment/callback] error:", err);
    res.status(500).send("0|Error");
  }
});

export default router;
