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

    // ② 去除常見茶字
    const cleaned = title.replace(/[茶烏龍高山金萱翠玉四季春頂級福壽]/g, "");
    dict[id].add(cleaned);

    // ③ 前兩字（常用）
    dict[id].add(title.slice(0, 2));

    // ④ 2 字子片段：只收有意義的
    for (let i = 0; i < title.length - 1; i++) {
      const slice2 = title.slice(i, i + 2);

      // 過濾無意義詞
      if (slice2.length === 2 && /[一-龥]{2}/.test(slice2)) {
        dict[id].add(slice2);
      }
    }

    // ⑤ 3 字子片段：同樣過濾
    for (let i = 0; i < title.length - 2; i++) {
      const slice3 = title.slice(i, i + 3);

      if (slice3.length === 3 && /[一-龥]{3}/.test(slice3)) {
        dict[id].add(slice3);
      }
    }

    // ⑥ 拼音
    const pinyin = toPinyin(title);
    dict[id].add(pinyin);
    dict[id].add(pinyin.replace(/\s+/g, ""));

    // ⑦ 注音
    const bopomo = toBopomo(title);
    dict[id].add(bopomo.replace(/\s+/g, ""));

    // ⑧ 英文縮寫
    const abbr = title
      .split("")
      .filter((c) => c.charCodeAt(0) < 256)
      .map((c) => c[0])
      .join("")
      .toUpperCase();
    if (abbr.length > 1) dict[id].add(abbr);

    // ⑨ 常見錯字
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
    "東": "ㄉㄨㄥ", "方": "ㄈㄤ",
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
// AI 意圖分類器
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
// 提取茶品
// ------------------------------------------------------------
function extractProductsFromMessage(message, products) {
  const aliasDict = buildAliasDict(products);
  const cleaned = message.toLowerCase();

  const found = [];

  for (const p of products) {
    for (const alias of aliasDict[p.id]) {
      const a = alias.toLowerCase();
      if (!a) continue;

      if (cleaned.includes(a)) {
        found.push(p);
        break;
      }
    }
  }

  return found;
}

// ------------------------------------------------------------
// 比較茶品
// ------------------------------------------------------------
async function runCompareAI(a, b, message, previousTaste, client) {
  const prompt = `
你是祥興茶行的專業茶品比較 AI。
使用者想比較：
1. ${a.title}
2. ${b.title}

請根據香氣、厚度、焙火、價格、風味差異清楚比較兩款茶。

輸出格式（純 JSON）：
{
  "mode": "compare",
  "a": "${a.id}",
  "b": "${b.id}",
  "compare": {
    "aroma": "...",
    "body": "...",
    "roast": "...",
    "price": "...",
    "summary": "..."
  }
}
`;

  const out = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

let raw = out.output_text || "";

// 移除 GPT 可能加的 ```json ``` 包裝
raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();

const json = safeJSON(raw);

if (!json || !json.compare) {
  return {
    mode: "compare",
    a: a.id,
    b: b.id,
    compare: {
      aroma: "兩款茶皆具高山氣息，香氣層次不同。",
      body: "以厚度而言，${a.title} 與 ${b.title} 皆有飽滿茶韻。",
      roast: "焙火皆偏輕，保留原始茶香。",
      price: "價格區間類似。",
      summary: "AI 回覆格式異常，因此提供基本比較摘要。"
    }
  };
}

return json;
}



// ------------------------------------------------------------
// ⭐ 主路由（修正版完整流程）
// ------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const { message, products, previousTaste } = req.body;
    if (!message || !products)
      return res.status(400).json({ error: "缺少 message 或 products" });

    const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

    // ❶ Intent：一定要先做
    const intent = await classifyIntent(client, message);
    console.log("🔍 Intent =", intent);

    const foundProducts = extractProductsFromMessage(message, products);

    // compare 模式：如果 user 說明兩款 → 直接用
    if (intent === "compare" && foundProducts.length >= 2) {
      const a = foundProducts[0];
      const b = foundProducts[1];

      console.log("🔍 使用者指定比較：", a.title, b.title);

      // ⭐⭐⭐ 關鍵修正：確保 await runCompareAI 並且 return res.json() ⭐⭐⭐
      const compareResult = await runCompareAI(a, b, message, previousTaste, client);
      return res.json(compareResult); 
    } 

    // ❷ fuzzy：只有 recommend / compare 需要擋
    const { best, score } = fuzzyMatchProduct(message, products);

    const needFuzzy =
      intent === "recommend" ||
      intent === "compare";

    if (needFuzzy && (!best || score < 2)) {
      return res.json({
        mode: "not_found",
        message: "目前找不到符合描述的茶款。",
      });
    }

    // ⭐ brew / gift / masterpick / personality：找不到也 OK
    const finalBest = best || products[0]; // fallback

    // ------------------------------------------------------------
    // ❸ AI 生成 JSON
    // ------------------------------------------------------------
    const prompt = `
你是祥興茶行 AI 導購。
使用者訊息：${message}
意圖：${intent}

最匹配的茶品：${finalBest.title}（ID：${finalBest.id}）

使用者口味偏好（可能為 null）：
${previousTaste ? JSON.stringify(previousTaste, null, 2) : "無"}

【請回傳純 JSON，不要其他文字】

=== recommend ===
{
  "mode": "recommend",
  "best": { "id": "${finalBest.id}", "reason": "..." },
  "second": { "id": "次推薦 ID", "reason": "..." }
}

=== compare ===
{
   "mode": "compare",
  "a": "${finalBest.id}",
  "b": "另一款適合比較的茶品 ID",
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
  "tea": "${finalBest.id}",
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
  "best": "${finalBest.id}",
  "reason": "..."
}

=== masterpick ===
{
  "mode": "masterpick",
  "best": "${finalBest.id}",
  "reason": "..."
}

=== personality ===
{
  "mode": "personality",
  "tea": "${finalBest.id}",
  "summary": "茶與性格的對應描述"
}

=== pairing ===
{
  "mode": "pairing",
  "tea": "ID",
  "reason": "推薦原因（為何適合搭配此料理）"
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
