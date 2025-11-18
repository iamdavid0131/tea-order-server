// ============================================================
// ⭐ 祥興茶行 AI 導購（旗艦版 Intent + Fuzzy + Fallback）
// ============================================================

import express from "express";
import OpenAI from "openai";
const router = express.Router();

// ------------------------------------------------------------
// 工具：中文 / 拼音 / 注音 / 英文縮寫 多重別名
// ------------------------------------------------------------
function buildAliasDict(products) {
  const dict = {};

  for (const p of products) {
    const id = p.id;
    const title = p.title;

    dict[id] = new Set();

    // ① 原名
    dict[id].add(title);

    // ② 去掉常見茶字
    dict[id].add(title.replace(/[茶烏龍高山金萱翠玉四季春]/g, ""));

    // ③ 俗稱：前兩字
    dict[id].add(title.slice(0, 2));

    // ④ 拼音
    const pinyin = toPinyin(title);
    dict[id].add(pinyin);
    dict[id].add(pinyin.replace(/\s+/g, ""));

    // ⑤ 注音
    const bopomo = toBopomo(title);
    dict[id].add(bopomo.replace(/\s+/g, ""));

    // ⑥ 英文縮寫
    const abbr = title
      .split("")
      .filter((c) => c.charCodeAt(0) < 256)
      .map((c) => c[0])
      .join("")
      .toUpperCase();
    if (abbr.length > 1) dict[id].add(abbr);

    // ⑦ 錯字
    const typoMap = {
      "貴花": "桂花",
      "阿里珊": "阿里山",
      "森山": "梨山",
    };
    for (const k in typoMap) dict[id].add(k);
  }

  return dict;
}

function toPinyin(str) {
  const map = {
    "梨": "li", "山": "shan",
    "桂": "gui", "花": "hua",
    "阿": "a", "里": "li",
    "東": "dong", "方": "fang", "美": "mei", "人": "ren",
    "金": "jin", "萱": "xuan",
    "翠": "cui", "玉": "yu",
  };
  return str.split("").map((ch) => map[ch] || "").join(" ");
}

function toBopomo(str) {
  const map = {
    "梨": "ㄌㄧ", "山": "ㄕㄢ",
    "桂": "ㄍㄨㄟ", "花": "ㄏㄨㄚ",
    "東": "ㄉㄨㄥ", "方": "ㄈㄤ"
  };
  return str.split("").map((ch) => map[ch] || "").join(" ");
}

// ------------------------------------------------------------
// Fuzzy：強化茶品模糊比對
// ------------------------------------------------------------
function fuzzyMatchProduct(message, products) {
  const aliasDict = buildAliasDict(products);
  const cleaned = message.toLowerCase().replace(/\s+/g, "");

  let best = null;
  let bestScore = 0;

  for (const p of products) {
    for (const alias of aliasDict[p.id]) {
      const a = alias.toLowerCase().replace(/\s+/g, "");
      if (!a) continue;

      let score = 0;

      if (cleaned === a) score = 5;
      else if (cleaned.includes(a)) score = 4;
      else if (a.includes(cleaned)) score = 3;
      else if (cleaned.startsWith(a)) score = 2;
      else if (a.startsWith(cleaned)) score = 2;

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  return { best, score: bestScore };
}

// ------------------------------------------------------------
// AI 意圖分類器（最重要）
// ------------------------------------------------------------
async function classifyIntent(client, message) {
  const prompt = `
你是祥興茶行 AI 導購意圖分類器，請判斷使用者想做什麼。

只能回傳以下字串之一：
- recommend
- compare
- brew
- gift
- masterpick
- personality
- unknown

使用者訊息：
${message}

請直接回傳字串，不要其他文字。
`;

  const out = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  return out.output_text?.trim() || "unknown";
}

// ------------------------------------------------------------
// 安全解析 JSON
// ------------------------------------------------------------
function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// ⭐ 主路由（旗艦版 AI）
// ------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const { message, products, previousTaste } = req.body;
    if (!message || !products)
      return res.status(400).json({ error: "缺少 message 或 products" });

    const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

    // ❶ Intent
    const intent = await classifyIntent(client, message);
    console.log("🔍 Intent =", intent);

    // ❷ Fuzzy 搜尋（作為推薦、泡法、送禮等基礎）
    const { best, score } = fuzzyMatchProduct(message, products);

    // 如果找不到 → 返回 not_found
    if (!best || score < 2) {
      return res.json({
        mode: "not_found",
        message: "目前找不到符合描述的茶款，我可以推薦最接近的風味。",
        suggest: null,
      });
    }

    // ------------------------------------------------------------
    // 🧠 AI 生成 JSON（根據 Intent）
    // ------------------------------------------------------------
    const prompt = `
你是祥興茶行 AI 導購。
使用者訊息：${message}
意圖：${intent}

最匹配的茶品：${best.title}（ID：${best.id}）

使用者口味偏好（可能為 null）：
${previousTaste ? JSON.stringify(previousTaste, null, 2) : "無"}

【請回傳純 JSON，不要其他文字】

不同 intent 請輸出不同格式：

=== recommend ===
{
  "mode": "recommend",
  "best": { "id": "${best.id}", "reason": "..." },
  "second": { "id": "次推薦 ID", "reason": "..." }
}

=== compare ===
{
  "mode": "compare",
  "a": "ID",
  "b": "ID",
  "compare": {
     "aroma": "...",
     "body": "...",
     "roast": "...",
     "price": "...",
     "summary": "..."
  }
}

=== brew ===
{
  "mode": "brew",
  "tea": "${best.id}",
  "brew": {
    "hot": "...",
    "ice_bath": "...",
    "cold_brew": "..."
  },
  "tips": "..."
}

=== gift ===
{
  "mode": "gift",
  "best": "ID",
  "reason": "..."
}

=== masterpick ===
{
  "mode": "masterpick",
  "best": "ID",
  "reason": "..."
}

=== personality ===
### Intent = personality：

你是「祥興茶行 茶品性格測驗 AI」。

你要根據使用者的描述（可能是情緒、最近狀態、心情、個性）  
推薦一款最符合他性格或當下狀態的茶。

請在輸出時加入：

{
  "mode": "personality",
  "tea": "茶品ID",
  "summary": "茶與性格的對應描述，例如：你是一位溫柔但內斂的人……"
}

`;

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const raw = completion.output_text || "";
    const json = safeJSON(raw);

    if (!json) {
      return res.json({
        mode: "error",
        raw,
        message: "AI 回傳格式錯誤（不是有效 JSON）",
      });
    }

    return res.json(json);

  } catch (err) {
    console.error("AI 導購錯誤：", err);
    return res.status(500).json({
      mode: "error",
      detail: err.message,
    });
  }
});

export default router;
