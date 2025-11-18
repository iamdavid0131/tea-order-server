import express from "express";
import ecpay_payment from "ecpay_aio_nodejs";
import { getSheetsClient } from "../lib/sheets.js";
import { normalizePhoneTW } from "../lib/utils.js";
import { sendOrderNotification } from "../lib/notify.js";
import querystring from "querystring";
import { recordOrderForMember } from "../lib/member.js";
import { sanitizeItemName } from "../lib/utils.js";

const router = express.Router();

/**
 * 🧾 前端送出訂單：寫入 Google Sheets 的 Orders 表
 * ✅ 支援逐品項數量對應各欄位 + 綠界 Server-to-Server 線上支付
 */
router.post("/submit", async (req, res) => {
  try {
    // 如果使用 form POST，要這樣解析
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

    // === 逐品項填入 ===
    for (const item of order.items || []) {
      const name = item.name?.trim() || "";
      const qty = Number(item.qty) || 0;
      const pack = item.pack ? 1 : 0;

      if (headers.includes(`${name}_數量`))
        rowMap[`${name}_數量`] = qty;

      if (headers.includes(`${name}_裝罐`))
        rowMap[`${name}_裝罐`] = pack;
    }

    // === 金額 ===
    rowMap["PricingPolicy"] = JSON.stringify(order.pricingPolicy || {});
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
    // 🔥🔥 線上支付：由後端直接送 HTML 表單 → 瀏覽器 auto-submit
    // =====================================================
    if (order.paymentMethod !== "cod") {
      const ecpay = new ecpay_payment({
        operationMode: "Test",
        MercProfile: {
          MerchantID: process.env.ECPAY_MERCHANT_ID,
          HashKey: process.env.ECPAY_HASH_KEY,
          HashIV: process.env.ECPAY_HASH_IV,
        },
        IgnorePayment: [],
        isProjectContractor: false,
      });

      const base_param = {
        MerchantTradeNo: String(orderId),
        MerchantTradeDate: now.toLocaleString("zh-TW", { hour12: false }),
        TotalAmount: String(order.total),
        TradeDesc: "Hsianghsing Tea Order",
        ItemName:
          order.items.map((i) => sanitizeItemName(i.name)).join("#") ||
          "Tea_Product",

        ReturnURL: process.env.ECPAY_RETURN_URL,
        ClientBackURL: `${process.env.ECPAY_CLIENT_BACK_URL}?paid=1&orderId=${orderId}&total=${order.total}`,
        ChoosePayment: "ALL",
      };
      console.log("🌏 ClientBackURL =", process.env.ECPAY_CLIENT_BACK_URL);
      console.log("🌏 ReturnURL =", process.env.ECPAY_RETURN_URL);
      console.log("🧾 ECPay base_param =", base_param);

      const htmlForm = ecpay.payment_client.aio_check_out_all(base_param);

      const fixedHtml = htmlForm.replace(
        /action="[^"]*"/,
        `action="https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5"`
      );

      console.log("⚡ 直接跳綠界付款頁面");

      // 🔥🔥 讓瀏覽器直接打開綠界（不用前端 fetch）
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

    return res.redirect(
  `${process.env.ECPAY_CLIENT_BACK_URL}?paid=1&orderId=${orderId}&total=${order.total}`
);
  } catch (err) {
    console.error("[order/submit] error:", err);
    res.status(500).send("錯誤：" + err.message);
  }
});


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
