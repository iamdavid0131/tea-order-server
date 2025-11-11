import express from "express";
import { getSheetsClient } from "../lib/sheets.js";
import { normalizePhoneTW } from "../lib/utils.js";
import { sendOrderNotification } from "../lib/notify.js";

const router = express.Router();

/**
 * 🧾 前端送出訂單：寫入 Google Sheets 的 Orders 表
 * ✅ 支援逐品項數量對應各欄位
 */
router.post("/submit", async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;

    // === 從前端接收資料 ===
    const {
      buyerName,
      buyerPhone,
      shippingMethod,
      storeCarrier,
      storeName,
      codAddress,
      promoCode,
      note,
      consent,
      paymentMethod,
      paymentStatus,
      paymentTxId,
      paymentTime,
      items = [],
      subtotal = 0,
      discount = 0,
      shippingFee = 0,
      total = 0,
      pricingPolicy = {},
    } = req.body;

    const now = new Date();
    const timestamp = now.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    const orderId = "O" + now.getTime();

    // === 取得 Orders 表的標題列（動態比對商品欄位） ===
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Orders!1:1",
    });
    const headers = headerRes.data.values[0];

    // ✅ 建立初始 row 物件，先放前半部固定欄位
    const rowMap = {
      Timestamp: timestamp,
      OrderID: orderId,
      BuyerName: buyerName || "",
      BuyerPhone: normalizePhoneTW(buyerPhone || ""),
      ShippingMethod: shippingMethod || "",
      StoreCarrier: storeCarrier || "",
      StoreName: storeName || "",
      CODAddress: codAddress || "",
      PromoCode: promoCode || "",
      Note: note || "",
      Consent: consent || "",
      PaymentMethod: paymentMethod || "",
      PaymentStatus: paymentStatus || "pending",
      PaymentTxId: paymentTxId || "",
      PaymentTime: paymentTime || "",
    };

    // ✅ 填入每個商品欄位
    // 預設每個商品欄位都填 0（避免空格錯位）
    headers.forEach((h) => {
      if (h.includes("_數量") || h.includes("_裝罐")) {
        rowMap[h] = 0;
      }
    });

    // ✅ 對應每個品項（名稱需精準對應 Sheet 欄位）
    for (const item of items) {
      const name = item.name?.trim() || "";
      const qty = Number(item.qty) || 0;
      const pack = item.pack || ""; // 若前端有「裝罐」資訊

      // 例：item.name = "茉莉窨茶"
      // → 找到 "茉莉窨茶_數量" 欄位並填值
      const qtyKey = `${name}_數量`;
      const packKey = `${name}_裝罐`;

      if (headers.includes(qtyKey)) rowMap[qtyKey] = qty;
      if (headers.includes(packKey)) rowMap[packKey] = pack ? 1 : 0;
    }

    // ✅ 填入金額與政策
    rowMap["PricingPolicy"] = JSON.stringify(pricingPolicy || {});
    rowMap["Subtotal"] = subtotal || 0;
    rowMap["Discount"] = discount || 0;
    rowMap["ShippingFee"] = shippingFee || 0;
    rowMap["Total"] = total || 0;
    rowMap["Status"] = "created";

    // === 根據 headers 順序組成 newRow
    const newRow = headers.map((h) => rowMap[h] ?? "");

    // === 寫入 Google Sheets ===
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Orders!A:AZ",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });

    console.log("✅ 新訂單已寫入 Google Sheets:", orderId);

    // === 傳送通知（可選） ===
    await sendOrderNotification({
      orderId,
      name: buyerName,
      phone: buyerPhone,
      total,
      items,
      method: shippingMethod,
      address: codAddress,
      storeName,
      storeCarrier,
    });

    res.json({ ok: true, orderId, msg: "訂單建立成功" });
  } catch (err) {
    console.error("[orders/submit] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
