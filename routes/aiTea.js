// routes/aiTea.js
import express from "express";
import OpenAI from "openai";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { message, products } = req.body;
    const previous = req.body.previousTaste || null;

    // 1️⃣ 參數檢查
    if (!message || !products) {
      return res.status(400).json({ error: "缺少 message 或 products" });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_KEY,
    });

    // 2️⃣ AI Prompt
    const prompt = `
你是祥興茶行 AI 導購，請只回傳 JSON。

使用者需求：
${message}

過去口味偏好（可能不存在）：
${previous ? JSON.stringify(previous, null, 2) : "無"}

請務必只輸出 JSON，格式如下：

{
  "best": "茶品ID",
  "reason": "中文理由",
  "second": {
      "id": "茶品ID",
      "reason": "中文理由"
  }
}

若無法找到符合茶款，best 請回 null。
`;

    // 3️⃣ OpenAI call（加入 timeout）
    let completion;
    try {
      completion = await Promise.race([
        openai.responses.create({
          model: "gpt-4.1-mini",
          input: prompt,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("AI Timeout")), 8000)
        ),
      ]);
    } catch (err) {
      return res.json({
        error: "AI 無回應或超時",
        detail: err.message,
      });
    }

    // 4️⃣ 取得文本（多重 fallback）
    const text =
      completion?.output_text ||
      completion?.output ||
      completion?.response_text ||
      "";

    // 5️⃣ 從文字中擷取 JSON（防 AI 多餘字）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({
        error: "AI 未提供 JSON",
        raw: text,
      });
    }

    let json;
    try {
      json = JSON.parse(jsonMatch[0]);
    } catch {
      return res.json({
        error: "AI JSON 格式錯誤",
        raw: text,
      });
    }

    // 6️⃣ 防呆：best 一定要存在於產品列表
    const best = products.find((p) => p.id === json.best) || null;

    // 7️⃣ 防呆：second 可能是 string 也可能是 object
    let secondId = null;
    if (json.second) {
      secondId = typeof json.second === "string" ? json.second : json.second.id;
    }
    const second =
      products.find((p) => p.id === secondId) || null;

    // 8️⃣ 若 best 找不到 → 自動 fallback 為第一個商品
    const safeBest = best || products[0];

    // 9️⃣ second 若找不到 → 自動 fallback 為 best 以外的第一款
    const safeSecond =
      second ||
      products.find((p) => p.id !== safeBest.id) ||
      null;

    // 10️⃣ 最終安全回傳格式
    return res.json({
      best: safeBest.id,
      reason: json.reason || "茶品風味適合您的需求。",
      second: safeSecond
        ? {
            id: safeSecond.id,
            reason: json.second?.reason || "可作為另一款風味選擇。",
          }
        : null,
    });
  } catch (err) {
    console.error("AI 導購錯誤：", err);
    res.status(500).json({
      error: "伺服器錯誤",
      detail: err.message,
    });
  }
});

export default router;
