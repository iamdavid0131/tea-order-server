import express from "express";
import ecpay_payment from "ecpay_aio_nodejs";
import { getSheetsClient } from "../lib/sheets.js";
import { normalizePhoneTW } from "../lib/utils.js";
import { sendOrderNotification } from "../lib/notify.js";
import fetch from "node-fetch";

const router = express.Router();

// 🤫 隱藏版商品定義 (Backend Source of Truth)
const SECRET_PRODUCT = {
  id: "secret_888",
  title: "👑 傳奇・80年代老凍頂",
  price: 8800
};

// 綠界商品名稱限制 (移除特殊符號)
function sanitizeItemName(name) {
  return name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9 ]/g, "").substring(0, 20);
}

/**
 * 🧾 前端送出訂單
 */
router.post("/submit", async (req, res) => {
  try {
    const order = req.body.orderJSON
      ? JSON.parse(req.body.orderJSON)
      : req.body;

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;

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
      PaymentStatus: "pending",
      PaymentTxId: "",
      PaymentTime: "",
    };

    // === 初始化商品欄位 ===
    headers.forEach((h) => {
      if (h.includes("_數量") || h.includes("_裝罐")) rowMap[h] = 0;
    });

    // === 逐品項填入 (含隱藏版處理) ===
    for (const item of order.items || []) {
      let name = item.name?.trim() || "";
      const qty = Number(item.qty) || 0;
      const pack = item.pack ? 1 : 0;

      // 🔥 關鍵修正：如果是隱藏商品，確保名稱正確，不然無法對應欄位
      if (item.id === SECRET_PRODUCT.id) {
        name = SECRET_PRODUCT.title;
      }

      // 嘗試對應 Google Sheet 欄位 (例如 "阿里山金萱_數量")
      // 注意：你的 Sheet 欄位名稱必須跟這裡的 name 一致
      if (headers.includes(`${name}_數量`)) {
        rowMap[`${name}_數量`] = qty;
      } else {
        // 如果 Sheet 沒這欄位 (例如隱藏商品還沒開欄位)，你可以選擇記錄在 Note 裡
        if (item.id === SECRET_PRODUCT.id) {
           rowMap["Note"] += ` [隱藏版:${name} x${qty}]`;
        }
      }

      if (headers.includes(`${name}_裝罐`))
        rowMap[`${name}_裝罐`] = pack;
    }

    // === 金額 ===
    rowMap["Subtotal"] = order.subtotal || 0;
    rowMap["Discount"] = order.discount || 0;
    rowMap["ShippingFee"] = order.shippingFee || 0;
    rowMap["Total"] = order.total || 0;
    rowMap["Status"] = "created";

    const newRow = headers.map((h) => rowMap[h] ?? "");

    // === 寫入 Google Sheets ===
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Orders!A:AZ",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });

    // =====================================================
    // 🧮 庫存扣除
    // =====================================================
    const stockItems = (order.items || []).map(it => ({
      productId: it.productId || it.id,
      qty: Number(it.qty) || 0
    }));

    // 忽略隱藏版商品的庫存檢查 (因為它不在庫存表裡)
    const validStockItems = stockItems.filter(i => i.productId !== SECRET_PRODUCT.id);

    if (validStockItems.length > 0) {
        const stockRes = await fetch(`${process.env.SERVER_URL}/api/stock/deduct`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: validStockItems })
        }).then(r => r.json());

        if (!stockRes.ok) {
          console.error("❌ 庫存不足：", stockRes);
          return res.status(400).json({
            ok: false,
            error: stockRes.message || "庫存不足，無法建立訂單"
          });
        }
    }

    // =====================================================
    // 🔥🔥 線上支付：由後端直接送 HTML 表單
    // =====================================================
    if (order.paymentMethod !== "cod") {
      const ecpay = new ecpay_payment({
        operationMode: "Test", // 正式環境記得改 Production
        MercProfile: {
          MerchantID: process.env.ECPAY_MERCHANT_ID,
          HashKey: process.env.ECPAY_HASH_KEY,
          HashIV: process.env.ECPAY_HASH_IV,
        },
        IgnorePayment: [],
        isProjectContractor: false,
      });

      // 產生綠界商品名稱字串
      const itemNameStr = order.items.map((i) => {
          if (i.id === SECRET_PRODUCT.id) return "Hidden_Tea_Special"; // 隱藏版用代號，避免亂碼
          return sanitizeItemName(i.name);
      }).join("#");

      const base_param = {
        MerchantTradeNo: String(orderId),
        MerchantTradeDate: now.toLocaleString("zh-TW", { hour12: false }),
        TotalAmount: String(order.total),
        TradeDesc: "Hsianghsing Tea Order",
        ItemName: itemNameStr || "Tea_Product",
        ReturnURL: process.env.ECPAY_RETURN_URL,
        ClientBackURL: `${process.env.ECPAY_CLIENT_BACK_URL}?paid=1&orderId=${orderId}&total=${order.total}`,
        ChoosePayment: "ALL",
      };

      const htmlForm = ecpay.payment_client.aio_check_out_all(base_param);
      // 修正綠界測試網址 (如果有需要)
      const fixedHtml = htmlForm.replace(
        /action="[^"]*"/,
        `action="https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5"`
      );

      return res.send(fixedHtml);
    }

    // =====================================================
    // 🟢 貨到付款
    // =====================================================
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

    // 🔥🔥 重定向回前端成功頁面
    return res.redirect(
      `${process.env.ECPAY_CLIENT_BACK_URL}?paid=1&orderId=${orderId}&total=${order.total}`
    );

  } catch (err) {
    console.error("[order/submit] error:", err);
    res.status(500).send("錯誤：" + err.message);
  }
});

// ... (payment/callback 維持原樣) ...
/**
 * 💰 綠界回傳付款結果
 */
router.post("/payment/callback", async (req, res) => {
    try {
      const { MerchantTradeNo, RtnCode, TradeNo, PaymentDate, PaymentTypeChargeFee } = req.body;
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
        row[header.indexOf("PaymentTypeChargeFee")] = PaymentTypeChargeFee || "";
  
  
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