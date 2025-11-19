// routes/stock.js
import express from "express";
import { getSheetsClient } from "../lib/sheets.js";

const router = express.Router();

/* =========================================================
   GET /api/stock
   回傳 { productId: stock }
========================================================= */
router.get("/", async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Stock!A2:C",
    });

    const rows = resp.data.values || [];
    const stockMap = {};

    rows.forEach(([pid, title, qty]) => {
      stockMap[pid] = Number(qty || 0);
    });

    res.json({ ok: true, stock: stockMap });

  } catch (err) {
    console.error("❌ GET /api/stock error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   POST /api/stock/deduct
   body: { items: [{ productId, qty }] }
========================================================= */
router.post("/deduct", async (req, res) => {
  try {
    const { items = [] } = req.body;

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID;

    // 1) 讀取現有庫存
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Stock!A2:C",
    });

    const rows = r.data.values || [];

    const stockMap = {};
    rows.forEach(([pid, title, qty]) => {
      stockMap[pid] = Number(qty || 0);
    });

    // 2) 檢查不足
    for (const item of items) {
      if (stockMap[item.productId] < item.qty) {
        return res.json({
          ok: false,
          message: `${item.productId} 庫存不足，目前剩 ${stockMap[item.productId]} 件`,
        });
      }
    }

    // 3) 扣庫存
    const updated = rows.map(([pid, title, qty]) => {
      const used = items.find((i) => i.productId === pid);
      if (used) {
        return [pid, title, Number(qty || 0) - used.qty];
      }
      return [pid, title, Number(qty || 0)];
    });

    // 4) 寫回 Google Sheets
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Stock!A2",
      valueInputOption: "RAW",
      resource: { values: updated },
    });

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ POST /api/stock/deduct error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
