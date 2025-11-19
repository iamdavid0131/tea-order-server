// ============================================================
// ⭐ 祥興茶行 AI 導購（多輪對話旗艦版）Part 1 — gpt-4.1-small 版本
// ============================================================

import express from "express";
import OpenAI from "openai";
const router = express.Router();

// ============================================================
// 🧠 0. Session 系統（多輪導購核心）
// ============================================================

function initSession() {
  return {
    flow: null,
    step: null,
    data: {}
  };
}

// ============================================================
// 🧰 1. 工具：中文/拼音/注音/縮寫 多重別名
// ============================================================

function buildAliasDict(products) {
  const dict = {};

  for (const p of products) {
    const id = p.id;
    const title = p.title;

    dict[id] = new Set();

    dict[id].add(title);
    dict[id].add(title.replace(/[茶烏龍高山金萱翠玉四季春頂級福壽]/g, ""));
    dict[id].add(title.slice(0, 2));

    for (let i = 0; i < title.length - 1; i++) {
      const seg = title.slice(i, i + 2);
      if (/^[一-龥]{2}$/.test(seg)) dict[id].add(seg);
    }

    for (let i = 0; i < title.length - 2; i++) {
      const seg = title.slice(i, i + 3);
      if (/^[一-龥]{3}$/.test(seg)) dict[id].add(seg);
    }

    const pinyin = toPinyin(title);
    dict[id].add(pinyin);
    dict[id].add(pinyin.replace(/\s+/g, ""));

    const bopomo = toBopomo(title);
    dict[id].add(bopomo.replace(/\s+/g, ""));

    const abbr = title
      .split("")
      .filter(c => c.charCodeAt(0) < 256)
      .map(c => c[0])
      .join("")
      .toUpperCase();

    if (abbr.length > 1) dict[id].add(abbr);

    const typoMap = {
      "貴花": "桂花",
      "阿里珊": "阿里山",
      "森山": "梨山"
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
  return str.split("").map(ch => map[ch] || "").join(" ");
}

function toBopomo(str) {
  const map = {
    "梨": "ㄌㄧ", "山": "ㄕㄢ",
    "桂": "ㄍㄨㄟ", "花": "ㄏㄨㄚ",
    "東": "ㄉㄨㄥ", "方": "ㄈㄤ",
  };
  return str.split("").map(ch => map[ch] || "").join(" ");
}

// ============================================================
// 🔍 2. Fuzzy：模糊比對
// ============================================================

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

  return { best: best || products[0], score: bestScore };
}

// ============================================================
// 🧠 3. Intent 分類（small 版）
// ============================================================

async function classifyIntent(client, message) {
  const prompt = `
你是祥興茶行 AI 導購意圖分類器。

請只依照「字面關鍵字」判斷，不要推測、不猜用意。

規則：
1. 若訊息屬於預算/風味/對象（例如: 2000、清爽、女生、長輩…）
   → 回傳 "continue"

2. 若包含：
   ["送禮", "禮物", "送茶"]
   → 回傳 "gift"

3. 若包含食物：
   ["雞","鴨","牛排","牛肉","火鍋","壽司","麵","飯","炸","甜點"]
   → 回傳 "pairing"

4. 若包含：
   ["比較","差別","哪個好"]
   → 回傳 "compare"

5. 若包含：
   ["泡法","怎麼泡","沖法"]
   → 回傳 "brew"

6. 若包含：
   ["推薦","想喝"]
   → 回傳 "recommend"

7. 其他全部 → 回傳 "recommend"

請只回傳分類字串，不要解釋。
訊息：${message}
`;

  const out = await client.responses.create({
    model: "gpt-4.1-small",
    input: prompt
  });

  const result = out.output_text?.trim()?.toLowerCase();
  return ["recommend", "compare", "brew", "gift", "pairing", "continue"]
    .includes(result)
    ? result
    : "recommend";
}

// ============================================================
// ⭐ 4. 解析使用者回答
// ============================================================

function interpretAnswer(message) {
  const msg = message.trim();

  if (/^\$?\d+/.test(msg)) {
    return { type: "budget", value: msg };
  }

  const targets = ["長輩", "女生", "男性", "男生", "主管", "同事", "朋友", "客戶"];
  if (targets.includes(msg)) {
    return { type: "target", value: msg };
  }

  const flavors = ["清爽", "濃郁", "香氣", "花香", "果香", "奶香", "無糖", "厚實"];
  if (flavors.includes(msg)) {
    return { type: "flavor", value: msg };
  }

  return { type: "text", value: msg };
}

// ============================================================
// ⭐ 5. Gift Flow（多輪送禮流程）
// ============================================================

async function runGiftFlow(session, message, products, client) {
  const answer = interpretAnswer(message);

  if (!session.step) {
    session.step = "ask_target";
    return {
      mode: "ask",
      ask: "想送給誰呢？",
      options: ["長輩", "女生", "主管", "同事", "朋友"]
    };
  }

  if (session.step === "ask_target") {
    session.data.target = answer.value;
    session.step = "ask_budget";

    return {
      mode: "ask",
      ask: "了解！那預算大概在哪一區間呢？",
      options: ["500 以內", "500–1000", "1000–2000", "不限"]
    };
  }

  if (session.step === "ask_budget") {
    session.data.budget = answer.value;
    session.step = "ask_flavor";

    return {
      mode: "ask",
      ask: "那對方平常喜歡什麼風味？",
      options: ["清爽", "花香", "果香", "濃郁", "不確定"]
    };
  }

  if (session.step === "ask_flavor") {
    session.data.flavor = answer.value;
    return runGiftRecommend(session.data, products);
  }
}

// ============================================================
// ⭐ 6. Gift Recommend Core
// ============================================================

function runGiftRecommend(data, products) {
  const { target, budget, flavor } = data;

  function findTea(filter) {
    return products.find(t => {
      if (filter.target && !filter.target.includes(target)) return false;
      if (filter.flavor && !filter.flavor.includes(flavor)) return false;
      if (filter.budget && !filter.budget.includes(budget)) return false;
      return true;
    });
  }

  let tea =
    findTea({ target: ["主管", "長輩"] }) ||
    findTea({ flavor: ["花香"] }) ||
    findTea({ flavor: ["果香"] }) ||
    findTea({}) ||
    products[0];

  return {
    mode: "gift",
    tea: tea.id,
    summary: `依照「${target} / ${budget} / ${flavor}」，這款最適合。`,
    reason: `${tea.title} 的風味最能符合你的送禮目的。`
  };
}

// ============================================================
// ⭐ 7. Pairing Flow（搭餐流程）
// ============================================================

async function runPairingFlow(session, message, products, client) {
  const answer = interpretAnswer(message);

  if (!session.step && detectDish(message)) {
    session.step = "ask_style";
    session.data.dish = message;

    return {
      mode: "ask",
      ask: `了解～${message} 想搭什麼風味的茶？`,
      options: ["清爽", "解膩", "香氣強", "果香", "不確定"]
    };
  }

  if (!session.step) {
    session.step = "ask_dish";
    return {
      mode: "ask",
      ask: "想搭配什麼料理呢？",
      options: ["烤鴨", "牛排", "火鍋", "壽司", "炸物", "甜點"]
    };
  }

  if (session.step === "ask_dish") {
    session.data.dish = message;
    session.step = "ask_style";

    return {
      mode: "ask",
      ask: `了解～${message} 想搭什麼風味的茶？`,
      options: ["清爽", "解膩", "香氣強", "果香", "不確定"]
    };
  }

  if (session.step === "ask_style") {
    session.data.style = answer.value;
    return runPairingRecommend(session.data, products);
  }
}
// ============================================================
// ⭐ 8. Pairing 推薦邏輯
// ============================================================

function runPairingRecommend(data, products) {
  const dish = data.dish;

  let tea = null;

  const warm = /(雞|薑母鴨|羊肉|燉|湯)/;
  const heavy = /(牛排|牛肉|燉肉|漢堡|披薩|焗烤|奶油)/;
  const fresh = /(壽司|生魚|沙拉|輕食)/;
  const spicy = /(麻辣|辣|川味|韓式)/;
  const fried = /(炸|酥|脆|唐揚|薯條)/;
  const sweet = /(甜|蛋糕|餅乾|甜點|可麗餅)/;
  const hotpot = /(鍋|火鍋|涮|煲)/;

  if (warm.test(dish)) {
    tea = products.find(t => /紅茶|蜜香|美人/.test(t.title));
  } else if (heavy.test(dish)) {
    tea = products.find(t => /濃|焙火|金萱|凍頂/.test(t.title));
  } else if (fresh.test(dish)) {
    tea = products.find(t => /清香|高山|梨山|阿里/.test(t.title));
  } else if (spicy.test(dish)) {
    tea = products.find(t => /清爽|翠玉|四季春/.test(t.title));
  } else if (fried.test(dish)) {
    tea = products.find(t => /清爽|翠玉/.test(t.title));
  } else if (sweet.test(dish)) {
    tea = products.find(t => /桂花|茉莉/.test(t.title));
  } else if (hotpot.test(dish)) {
    tea = products.find(t => /高山|金萱|清香/.test(t.title));
  }

  if (!tea) tea = products[0];

  return {
    mode: "pairing",
    tea: tea.id,
    summary: `搭配「${dish}」時，建議選擇 ${tea.title}。`,
    reason: `${tea.title} 的風味能平衡「${dish}」的料理特性。`
  };
}

// ============================================================
// 🔥 料理偵測器
// ============================================================

function detectDish(message) {
  const m = message.replace(/\s+/g, "");

  if (/搭餐|搭配|配茶|想搭|要搭/.test(m)) return false;

  return /(麻油雞|雞肉|雞腿|烤鴨|牛排|牛肉|豬排|豬肉|壽司|魚|蝦|蟹|炸雞|炸物|甜點|蛋糕|餅乾|披薩|火鍋|鍋|湯|煲|炒飯|炒麵)/.test(
    m
  );
}

// ============================================================
// 🧩 從訊息中抓出有提到的茶款（給 compare 用）
// ============================================================
function extractProductsFromMessage(message, products) {
  const msg = message.replace(/\s+/g, "");

  return products.filter(p => {
    const full = p.title.replace(/\s+/g, "");
    const short2 = p.title.slice(0, 2);
    const trimmed = p.title.replace(/[茶烏龍高山金萱翠玉四季春頂級福壽]/g, "");

    return (
      msg.includes(full) ||
      msg.includes(short2) ||
      (trimmed && msg.includes(trimmed))
    );
  });
}

// ============================================================
// ⭐ 9. Compare（比較兩款茶）
// ============================================================

async function runCompareAI(a, b, message, previousTaste, client) {
  const prompt = `
你是祥興茶行的專業茶師，請比較以下兩款茶：

A: ${a.title}
B: ${b.title}

使用者訊息：${message}

請以以下結構回覆 JSON（不要多餘文字）:
{
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
    model: "gpt-4.1-small",
    input: prompt
  });

  return JSON.parse(out.output_text);
}

// ============================================================
// ⭐ 10. 多輪泡法（Brew Flow）
// ============================================================

async function runBrewFlow(session, message, products) {
  const { best } = fuzzyMatchProduct(message, products);

  if (!session.step) {
    session.step = "ask_which";
    return {
      mode: "ask",
      ask: "想查哪一款茶的泡法呢？",
      options: products.map(p => p.title.slice(0, 4))
    };
  }

  if (session.step === "ask_which") {
    const { best } = fuzzyMatchProduct(message, products);

    session.step = null;
    session.flow = null;

    return {
      mode: "brew",
      tea: best.id,
      brew: {
        hot: "90–95°C，浸泡 50–70 秒。",
        ice_bath: "熱沖後直接冰鎮 10 分鐘最佳。",
        cold_brew: "10g 茶葉加入 600ml 冷水，冷藏 6–8 小時。"
      },
      tips: "建議使用軟水風味更乾淨。"
    };
  }
}

// ============================================================
// ⭐ 11. Recommend Flow（一般推薦多輪）
// ============================================================

async function runRecommendFlow(session, message, products) {
  const answer = interpretAnswer(message);

  if (!session.step) {
    session.step = "ask_purpose";

    return {
      mode: "ask",
      ask: "這次是自己喝，還是要送禮呢？😊",
      options: ["自己喝", "送禮"]
    };
  }

  if (session.step === "ask_purpose") {
    if (/送禮/.test(message)) {
      session.flow = "gift";
      session.step = null;
      return await runGiftFlow(session, message, products);
    }

    session.data.purpose = "自己喝";
    session.step = "ask_flavor";

    return {
      mode: "ask",
      ask: "那你平常喜歡什麼風味呢？",
      options: ["清爽", "花香", "果香", "濃郁", "不確定"]
    };
  }

  if (session.step === "ask_flavor") {
    session.data.flavor = answer.value || message.trim();

    const result = runRecommendCore(session.data, products);
    return result;
  }
}

// ============================================================
// ⭐ 12. Recommend 核心邏輯
// ============================================================

function runRecommendCore(data, products) {
  const { budget, flavor } = data;

  const scored = products.map(p => {
    let score = 0;

    if (budget) {
      const num = parseInt(budget.replace(/[^\d]/g, ""), 10);
      if (p.price && p.price <= num) score += 3;
      if (p.price && p.price <= num + 200) score += 1;
    }

    if (/清爽|清香/.test(flavor) && /清香|翠玉|四季春|高山/.test(p.title))
      score += 3;
    if (/花香/.test(flavor) && /桂花|茉莉/.test(p.title)) score += 3;
    if (/果香/.test(flavor) && /蜜香|美人/.test(p.title)) score += 3;
    if (/濃郁|厚/.test(flavor) && /焙火|濃香|紅茶|凍頂/.test(p.title)) score += 3;

    return { ...p, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0] || products[0];
  const second = scored[1] || products[1];

  const reasons = [];
  if (budget) reasons.push(`符合你設定的「${budget}」預算`);
  if (flavor) reasons.push(`風味偏向你喜歡的「${flavor}」`);

  return {
    mode: "recommend",
    best: {
      id: best.id,
      reason: reasons.join("，")
    },
    second: {
      id: second.id,
      reason: "另一個互補風味的選擇"
    }
  };
}

// ============================================================
// ⭐ 13. 主路由（dispatcher）
// ============================================================

router.post("/", async (req, res) => {
  try {
    const { message, products, previousTaste, session: clientSession } = req.body;

    if (!message || !products) {
      return res.status(400).json({ error: "缺少 message 或 products" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

    // session init
    const session = clientSession ?? initSession();

    const intent = await classifyIntent(client, message);

    console.log("🔍 Intent =", intent);

    // ⛔ 料理 → 直接進 pairing flow
    if (!session.flow && detectDish(message)) {
      session.flow = "pairing";
      session.step = null;

      const result = await runPairingFlow(session, message, products, client);
      return res.json({ ...result, session });
    }

    // 🔄 回答上一輪
    if (
      intent === "continue" ||
      (session.flow === "gift" && intent === "gift") ||
      (session.flow === "pairing" && intent === "pairing") ||
      (session.flow === "brew" && intent === "brew") ||
      (session.flow === "recommend" && intent === "recommend")
    ) {
      if (session.flow === "gift") {
        const result = await runGiftFlow(session, message, products, client);
        return res.json({ ...result, session });
      }

      if (session.flow === "pairing") {
        const result = await runPairingFlow(session, message, products, client);
        return res.json({ ...result, session });
      }

      if (session.flow === "brew") {
        const result = await runBrewFlow(session, message, products);
        return res.json({ ...result, session });
      }

      if (session.flow === "recommend") {
        const result = await runRecommendFlow(session, message, products);
        return res.json({ ...result, session });
      }
    }

    // 🚀 啟動 Gift
    if (intent === "gift") {
      session.flow = "gift";
      session.step = null;

      const result = await runGiftFlow(session, message, products, client);
      return res.json({ ...result, session });
    }

    // 🚀 啟動 Pairing
    if (intent === "pairing") {
      session.flow = "pairing";
      session.step = null;

      const result = await runPairingFlow(session, message, products, client);
      return res.json({ ...result, session });
    }

    // 🚀 比較
    if (intent === "compare") {
      const found = extractProductsFromMessage(message, products);

      if (found.length >= 2) {
        const a = found[0];
        const b = found[1];
        const result = await runCompareAI(
          a,
          b,
          message,
          previousTaste,
          client
        );
        return res.json({ ...result, session });
      }

      const { best } = fuzzyMatchProduct(message, products);
      const second =
        products.find(p => p.id !== best.id) || products[0];

      const result = await runCompareAI(
        best,
        second,
        message,
        previousTaste,
        client
      );
      return res.json({ ...result, session });
    }

    // 🚀 啟動 Brew（改成多輪）
    if (intent === "brew") {
      session.flow = "brew";
      session.step = null;

      const result = await runBrewFlow(session, message, products);
      return res.json({ ...result, session });
    }

    // 🚀 啟動 Recommend（新版多輪）
    if (intent === "recommend") {
      session.flow = "recommend";
      session.step = null;

      const result = await runRecommendFlow(session, message, products);
      return res.json({ ...result, session });
    }

    // fallback
    const { best } = fuzzyMatchProduct(message, products);

    return res.json({
      mode: "recommend",
      best: { id: best.id, reason: "依你的描述，這款最接近。" },
      session
    });
  } catch (err) {
    console.error("AI 導購錯誤：", err);

    return res.status(500).json({
      mode: "error",
      detail: err.message
    });
  }
});

export default router;
