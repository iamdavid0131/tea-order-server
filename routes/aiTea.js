// routes/aiTea.js
import express from "express";
import OpenAI from "openai";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { message, products } = req.body;
    if (!message || !products) {
      return res.status(400).json({ error: "缺少 message 或 products" });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_KEY,
    });
    const previous = req.body.previousTaste;
    const prompt = `
    你是祥興茶行 AI 導購。
    如果有 past preference，請優先考慮：

    使用者口味偏好（可能存在或不存在）：
    ${previous ? JSON.stringify(previous, null, 2) : "無資料"}

    目前使用者需求：
    ${message}

    請務必輸出 JSON：
    {
    "best": "茶品ID",
    "reason": "中文理由…",
    "second": {
        "id": "ID",
        "reason": "簡短理由"
    }
    }
    `;

    const completion = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const text =
      completion.output_text || completion.output || completion.response_text;

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.json({
        error: "AI 回傳格式錯誤",
        raw: text,
      });
    }

    return res.json(json);
  } catch (err) {
    console.error("AI 導購錯誤：", err);
    res.status(500).json({ error: "伺服器錯誤", detail: err.message });
  }
});

export default router;
