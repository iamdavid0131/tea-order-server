import express from "express";
import ecpay_payment from "ecpay_aio_nodejs";
import { getSheetsClient } from "../lib/sheets.js";
import { normalizePhoneTW } from "../lib/utils.js";
import { sendOrderNotification } from "../lib/notify.js";
import fetch from "node-fetch";
import { linePush } from "../lib/line.js";
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

    // 忽略隱藏版商品的庫存檢查
    const validStockItems = stockItems.filter(i => i.productId !== "secret_888");

    if (validStockItems.length > 0) {
        // 🔥【關鍵修正】定義伺服器網址
        // 如果環境變數沒設定，就自動用 Render 的預設網址，或 localhost
        const baseUrl = process.env.SERVER_URL || "https://tea-order-server.onrender.com"; // 👈 請確認這是你的 Render 網址
        
        console.log(`📦 呼叫庫存 API: ${baseUrl}/api/stock/deduct`);

        const stockRes = await fetch(`${baseUrl}/api/stock/deduct`, {
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
    // 📨 發送「新訂單」通知 (無論付款方式為何，先通知)
    // =====================================================
    try {
      // 判斷付款狀態文字
      const isCOD = order.paymentMethod === "cod";
      const statusTitle = isCOD ? "🟢 貨到付款 (請安排出貨)" : "🟡 線上支付 (等待付款中)";
      
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
        note: order.note,
        // 稍微修改一下傳進去的標題或備註，讓管理員知道狀態
        statusRaw: statusTitle
      });
      console.log("📨 訂單通知已發送");
    } catch (e) {
      console.error("通知發送失敗", e);
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
        // 🔥【新增】如果付款成功，發送 LINE 通知給管理員
      if (status === "paid") {
        const adminId = process.env.LINE_ADMIN_USER_ID;
        // 從 Sheet 裡抓出買家姓名 (在第 C 欄，索引 2) 和金額 (在第 AZ 前面幾欄，假設你知道位置)
        // 或者簡單一點，只通知訂單號
        const buyerName = rows[idx][2] || "顧客"; 
        const totalAmount = rows[idx][rows[0].indexOf("Total")] || "0";

        if (adminId) {
          await linePush(adminId, {
            type: "bubble", // 簡單的小卡片
            size: "kilo",
            body: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#f0fff4", // 淡綠底
              borderColor: "#48bb78",
              borderWidth: "2px",
              cornerRadius: "12px",
              paddingAll: "16px",
              contents: [
                { type: "text", text: "💰 付款成功確認", weight: "bold", color: "#2f855a", size: "md" },
                { type: "separator", margin: "md" },
                { type: "text", text: `訂單：${MerchantTradeNo}`, size: "sm", margin: "md" },
                { type: "text", text: `買家：${buyerName}`, size: "sm", margin: "xs" },
                { type: "text", text: `金額：$${Number(totalAmount).toLocaleString()}`, size: "lg", weight: "bold", color: "#b8860b", margin: "sm" }
              ]
            }
          });
          console.log("📨 付款成功通知已發送");
        }
      }

        
        
      }
  
      console.log(`✅ 綠界付款結果回傳：${MerchantTradeNo} (${status})`);
      res.send("1|OK");
    } catch (err) {
      console.error("[payment/callback] error:", err);
      res.status(500).send("0|Error");
    }
  });

export default router;