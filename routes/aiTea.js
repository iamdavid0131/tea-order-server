// ============================================================
// ⭐ 祥興茶行 AI 導購（多輪對話旗艦版）Part 1
// ============================================================

import express from "express";
import OpenAI from "openai";
const router = express.Router();

// ============================================================
// 🧠 0. Session 系統（多輪導購的核心）
// ============================================================

/**
 * session 會包含：
 * {
 *   step: "ask_target" | "ask_budget" | "ask_flavor" | null,
 *   data: {
 *     target: null,   // 送誰？
 *     budget: null,   // 預算？
 *     flavor: null,   // 口味？
 *     ...可擴充
 *   }
 * }
 */
function initSession() {
  return {
    step: null,
    data: {}
  };
}


// ============================================================
// 🧰 1. 工具：中文 / 拼音 / 注音 / 英文縮寫 多重別名
// ============================================================

function buildAliasDict(products) {
  const dict = {};

  for (const p of products) {
    const id = p.id;
    const title = p.title;

    dict[id] = new Set();

    dict[id].add(title);

    // 去除冗字
    dict[id].add(title.replace(/[茶烏龍高山金萱翠玉四季春頂級福壽]/g, ""));

    // 前兩字
    dict[id].add(title.slice(0, 2));

    // 2 字切片
    for (let i = 0; i < title.length - 1; i++) {
      const seg = title.slice(i, i + 2);
      if (/^[一-龥]{2}$/.test(seg)) dict[id].add(seg);
    }

    // 3 字切片
    for (let i = 0; i < title.length - 2; i++) {
      const seg = title.slice(i, i + 3);
      if (/^[一-龥]{3}$/.test(seg)) dict[id].add(seg);
    }

    // 拼音
    const pinyin = toPinyin(title);
    dict[id].add(pinyin);
    dict[id].add(pinyin.replace(/\s+/g, ""));

    // 注音
    const bopomo = toBopomo(title);
    dict[id].add(bopomo.replace(/\s+/g, ""));

    // 英文縮寫
    const abbr = title
      .split("")
      .filter(c => c.charCodeAt(0) < 256)
      .map(c => c[0])
      .join("")
      .toUpperCase();
    if (abbr.length > 1) dict[id].add(abbr);

    // 常見錯字
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

  return { best, score: bestScore };
}


// ============================================================
// 🧠 3. Intent（多輪對話版本）
// ============================================================

async function classifyIntent(client, message) {
  const prompt = `
你是祥興茶行 AI 導購意圖分類器。

請根據使用者訊息判斷意圖。

可回傳：
- recommend          （要推薦茶）
- compare            （想比較兩款茶）
- brew               （問泡法）
- gift               （送禮）
- pairing            （搭餐）
- masterpick         （店長推薦）
- personality        （性格測驗）
- ask                （AI 要提問）
- continue           （使用者正在回答上一題）
- unknown

判斷規則：
1. 若訊息是「女生」「長輩」「500元」「清爽」→ 這是使用者回答問題 → 回傳 continue
2. 若使用者想送禮但資訊不足 → 回傳 ask
3. 若提到食物 → pairing
4. 若提到送禮 → gift
5. 若提到比較 → compare
6. 若提到泡法 → brew
7. 若提到“我很累/心情不好/今天放鬆” → personality
8. 其他 → recommend

使用者訊息：
${message}

請直接回傳字串，不要多餘文字。
`;

  const out = await client.responses.create({
    model: "gpt-4.1-mini",
    input: prompt
  });

  return out.output_text?.trim() || "unknown";
}

// ============================================================
// ⭐ 4. 解析使用者回答（多輪對話核心）
// ============================================================

function interpretAnswer(message) {
  const msg = message.trim();

  // 預算回答
  if (/^\$?\d+/.test(msg) || /500/.test(msg)) {
    return { type: "budget", value: msg };
  }

  // 對象回答
  const targets = ["長輩", "女生", "男性", "男生", "主管", "同事", "朋友", "客戶"];
  if (targets.includes(msg)) {
    return { type: "target", value: msg };
  }

  // 風味回答
  const flavors = ["清爽", "濃郁", "香氣", "花香", "果香", "奶香", "無糖", "厚實"];
  if (flavors.includes(msg)) {
    return { type: "flavor", value: msg };
  }

  return { type: "text", value: msg };
}



// ============================================================
// ⭐ 5. 多輪對話：送禮流程（Gift Flow）
// ============================================================

async function runGiftFlow(session, message, products, client) {
  const answer = interpretAnswer(message);

  // ---------- Step 1：詢問送給誰 ----------
  if (!session.step) {
    session.step = "ask_target";
    return {
      mode: "ask",
      ask: "想送給誰呢？",
      options: ["長輩", "女生", "主管", "同事", "朋友"]
    };
  }

  // 使用者回答送給誰
  if (session.step === "ask_target") {
    session.data.target = answer.value;
    session.step = "ask_budget";

    return {
      mode: "ask",
      ask: "了解！那預算大概在哪一區間呢？",
      options: ["500 以內", "500–1000", "1000–2000", "不限"]
    };
  }

  // ---------- Step 2：詢問預算 ----------
  if (session.step === "ask_budget") {
    session.data.budget = answer.value;
    session.step = "ask_flavor";

    return {
      mode: "ask",
      ask: "那對方平常喜歡什麼風味？",
      options: ["清爽", "花香", "果香", "濃郁", "不確定"]
    };
  }

  // ---------- Step 3：風味偏好 ----------
  if (session.step === "ask_flavor") {
    session.data.flavor = answer.value;

    // 進入最終推薦
    return runGiftRecommend(session.data, products);
  }
}



// ============================================================
// ⭐ 6. gift 推薦邏輯（依「對象 + 預算 + 風味」推茶）
// ============================================================

function runGiftRecommend(data, products) {
  const { target, budget, flavor } = data;

  //--- 定義送禮邏輯 ---//
  function findTea(filter) {
    return products.find(t => {
      if (filter.target && !filter.target.includes(target)) return false;
      if (filter.flavor && !filter.flavor.includes(flavor)) return false;
      if (filter.budget && !filter.budget.includes(budget)) return false;
      return true;
    });
  }

  // 針對不同對象選擇
  let tea =
    findTea({ target: ["主管", "長輩"] }) ||
    findTea({ flavor: ["花香"] }) ||
    findTea({ flavor: ["果香"] }) ||
    findTea({}) ||
    products[0];

  return {
    mode: "gift",
    tea: tea.id,
    summary: `依照「${target} / ${budget} / ${flavor}」條件，這款最合適。`,
    reason: `${tea.title} 的風味與定位最能符合你的送禮需求。`
  };
}



// ============================================================
// ⭐ 7. 多輪對話：搭餐流程（Pairing Flow）
// ============================================================

async function runPairingFlow(session, message, products, client) {
  const answer = interpretAnswer(message);

  // Step 1：詢問料理種類
  if (!session.step) {
    session.step = "ask_dish";
    return {
      mode: "ask",
      ask: "想搭配什麼料理呢？",
      options: ["烤鴨", "牛排", "火鍋", "壽司", "炸物", "甜點"]
    };
  }

  if (session.step === "ask_dish") {
    session.data.dish = answer.value;

    // Step 2：詢問偏好風味
    session.step = "ask_style";
    return {
      mode: "ask",
      ask: "了解，那你偏好什麼風味？",
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
  const { dish, style } = data;

  let tea;

  if (dish === "烤鴨") {
    tea = products.find(t => /美人|東方/.test(t.title)) ||
          products.find(t => /梨山/.test(t.title));
  } else if (dish === "牛排") {
    tea = products.find(t => /焙火|濃郁/.test(t.title)) ||
          products.find(t => /金萱/.test(t.title));
  } else if (dish === "火鍋") {
    tea = products.find(t => /清香|高山/.test(t.title));
  } else {
    tea = products[0];
  }

  if (!tea) tea = products[0];

  return {
    mode: "pairing",
    tea: tea.id,
    summary: `搭配「${dish}」，建議選擇 ${tea.title}。`,
    reason: `${tea.title} 的風味能中和 ${dish} 的特徵，特別適合 ${style} 風格需求。`
  };
}

// ============================================================
// ⭐ 9. 主路由：多輪對話總控（dispatcher）
// ============================================================

router.post("/", async (req, res) => {
  try {
    const { message, products, previousTaste, session: clientSession } = req.body;
    if (!message || !products) {
      return res.status(400).json({ error: "缺少 message 或 products" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

    // 如果前端有傳 session → 使用，不然初始化
    const session = clientSession || initSession();

    // -----------------------------------------
    // ❶ Intent 判斷（recommend/gift/pairing/...）
    // -----------------------------------------
    const intent = await classifyIntent(client, message);
    console.log("🔍 Intent =", intent);

    // -----------------------------------------
    // ❷ 使用者正在回答上一輪問題（continue）
    // -----------------------------------------
    if (intent === "continue") {
      if (session.flow === "gift") {
        const result = await runGiftFlow(session, message, products, client);
        return res.json({ ...result, session });
      }

      if (session.flow === "pairing") {
        const result = await runPairingFlow(session, message, products, client);
        return res.json({ ...result, session });
      }
    }

    // -----------------------------------------
    // ❸ flow = gift（開始多輪對話）
    // -----------------------------------------
    if (intent === "gift") {
      session.flow = "gift";
      session.step = null;

      const result = await runGiftFlow(session, message, products, client);
      return res.json({ ...result, session });
    }

    // -----------------------------------------
    // ❹ flow = pairing（搭餐多輪）
    // -----------------------------------------
    if (intent === "pairing") {
      session.flow = "pairing";
      session.step = null;

      const result = await runPairingFlow(session, message, products, client);
      return res.json({ ...result, session });
    }

    // -----------------------------------------
    // ❺ compare：如果找出 2 個茶 → 比較
    // -----------------------------------------
    if (intent === "compare") {
      const found = extractProductsFromMessage(message, products);
      if (found.length >= 2) {
        const a = found[0];
        const b = found[1];
        const result = await runCompareAI(a, b, message, previousTaste, client);
        return res.json({ ...result, session });
      }

      // 若只有一個 → fuzzy 補第二個
      const { best } = fuzzyMatchProduct(message, products);
      const second = products.find(p => p.id !== best.id) || products[0];

      const result = await runCompareAI(best, second, message, previousTaste, client);
      return res.json({ ...result, session });
    }

    // -----------------------------------------
    // ❻ brew（泡法）
    // -----------------------------------------
    if (intent === "brew") {
      const { best } = fuzzyMatchProduct(message, products);

      return res.json({
        mode: "brew",
        tea: best.id,
        brew: {
          hot: "90–95°C，浸泡 50–70 秒。",
          ice_bath: "熱沖後直接冰鎮 10 分鐘最佳。",
          cold_brew: "10g 茶葉加入 600ml 冷水，冷藏 6–8 小時。"
        },
        tips: "建議用軟水風味更乾淨。",
        session
      });
    }

    // -----------------------------------------
    // ❼ masterpick（店長推薦）
    // -----------------------------------------
    if (intent === "masterpick") {
      const { best } = fuzzyMatchProduct(message, products);

      return res.json({
        mode: "masterpick",
        best: best.id,
        reason: "依照你的描述，這款在風味、平衡感與香氣表現最符合你的需求。",
        session
      });
    }

    // -----------------------------------------
    // ❽ personality（性格測驗推薦）
    // -----------------------------------------
    if (intent === "personality") {
      const { best } = fuzzyMatchProduct(message, products);

      return res.json({
        mode: "personality",
        tea: best.id,
        summary: "你給人的感覺細膩、穩重又帶點內斂，因此最適合這款風味。",
        session
      });
    }

    // -----------------------------------------
    // ❾ recommend（單輪推薦）
    // -----------------------------------------
    if (intent === "recommend") {
      const { best } = fuzzyMatchProduct(message, products);

      // 隨機第二推薦（不要永遠同一個）
      const others = products.filter(p => p.id !== best.id);
      const second = others[Math.floor(Math.random() * others.length)];

      return res.json({
        mode: "recommend",
        best: { id: best.id, reason: "香氣乾淨，風味均衡。" },
        second: { id: second.id, reason: "風味特色與主推薦互補。" },
        session
      });
    }

    // -----------------------------------------
    // ❿ unknown（當作 recommend fallback）
    // -----------------------------------------
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
