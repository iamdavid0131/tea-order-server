// ============================================================
// ⭐ 祥興茶行 AI 導購 — 旗艦完整修正版 (Smart Flow v3.1)
// ============================================================

import express from "express";
import OpenAI from "openai";
const router = express.Router();

// ============================================================
// 🧠 0. Session 系統
// ============================================================
function initSession() {
  return {
    flow: null,   // gift, recommend, pairing, personality...
    step: null,   // step status
    data: {}      // budget, target, flavor...
  };
}

// ============================================================
// 🔍 工具：模糊比對產品
// ============================================================
function findProductInMessage(message, products) {
  const msg = message.replace(/\s+/g, "").toLowerCase();
  
  let bestMatch = null;
  let maxScore = 0;

  products.forEach(p => {
    let score = 0;
    const title = p.title.replace(/\s+/g, "").toLowerCase();
    
    if (msg.includes(title)) score += 10;
    else if (msg.includes(title.replace(/茶|精選|頂級/g, ""))) score += 5;
    else if (msg.includes(title.substring(0, 2))) score += 2;

    if (score > maxScore) {
      maxScore = score;
      bestMatch = p;
    }
  });

  return maxScore >= 2 ? bestMatch : null;
}

// ============================================================
// 🧠 1. LLM 核心大腦
// ============================================================

// 🛠️ 1-1. 全局資訊萃取
async function extractEntities(client, message, currentData) {
  const prompt = `
  使用者正在與茶行 AI 對話。
  目前的已知資訊：${JSON.stringify(currentData)}
  使用者的最新訊息：「${message}」

  請更新或萃取以下資訊（若未提到回傳 null）：
  1. target (對象)
  2. budget (預算數字)
  3. flavor (口味)
  4. purpose (送禮/自飲)
  5. dish (搭配料理名稱，如牛排、甜點)

  回傳 JSON。
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "只回傳 JSON" },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (e) {
    return {};
  }
}

// 🛠️ 1-2. 意圖判斷
async function classifyIntent(client, message) {
  const msg = message.trim();
  if (/^\$?\d+(-\d+)?\s*$/.test(msg)) return "continue";

  const prompt = `
  你是祥興茶行的店長。判斷客人的意圖。
  訊息：「${msg}」

  分類：
  1. personality (測驗、心理測驗、性格茶、玩遊戲)
  2. gift (送禮)
  3. pairing (搭餐)
  4. brew (泡法)
  5. compare (比較)
  6. recommend (推薦)
  7. continue (補充資訊、回答問題、純數字)

  只回傳一個英文單字。
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });
    const res = completion.choices[0].message.content.trim().toLowerCase();
    const valid = ["gift", "pairing", "brew", "compare", "recommend", "continue", "personality"];
    return valid.includes(res) ? res : "recommend"; 
  } catch (e) {
    return "recommend";
  }
}

// 🛠️ 1-3. 生成有溫度的推薦理由
async function generatePersuasiveReason(client, tea, userNeeds) {
  const prompt = `
  你是祥興茶行第三代傳人「阿興師」。
  客人需求：${JSON.stringify(userNeeds)}
  推薦茶款：${tea.title} (描述：${tea.desc || tea.tags})

  請用 30 字以內，溫暖專業的口吻，告訴客人為什麼這款茶適合他。
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });
    return completion.choices[0].message.content;
  } catch (e) {
    return `這款${tea.title}非常適合您的需求，風味絕佳！`;
  }
}

// ============================================================
// 🌊 2. Flows (流程邏輯)
// ============================================================

// 🍵 智慧泡法流程
async function runBrewFlow(session, message, products) {
  const matchedTea = findProductInMessage(message, products);

  if (!matchedTea) {
    session.step = "ask_which";
    return {
      mode: "ask",
      ask: "請問您想了解哪一款茶的沖泡方式呢？",
      options: products.slice(0, 5).map(p => p.title)
    };
  }

  const title = matchedTea.title;
  let temp = "95-100°C";
  let time = "50-60秒";

  if (title.includes("綠") || title.includes("碧螺春")) {
    temp = "80-85°C"; time = "40-50秒";
  } else if (title.includes("東方美人") || title.includes("紅茶")) {
    temp = "90-95°C"; time = "40-50秒";
  }

  session.step = null; 
  session.flow = null;

  return {
    mode: "brew",
    tea: matchedTea.id,
    brew: {
      hot: `水溫 ${temp}，第一泡浸泡 ${time}。`,
      ice_bath: "熱泡後倒入冰塊杯中，瞬間降溫鎖住香氣。",
      cold_brew: "1:50 比例冷泡，冷藏 6-8 小時。"
    },
    tips: `阿興師建議：${title.includes("高山") ? "第一泡可以溫潤泡(倒掉)讓茶葉舒展。" : "使用瓷器沖泡最能聚香。"}`
  };
}

// 🎁 送禮流程
async function runGiftFlow(session, products, client) {
  const d = session.data;

  if (!d.target) {
    session.step = "ask_target";
    return { mode: "ask", ask: "請問是想送給誰呢？", options: ["長輩", "主管/客戶", "朋友", "女生"] };
  }
  if (!d.budget) {
    session.step = "ask_budget";
    return { mode: "ask", ask: `送給${d.target}的預算大約是？`, options: ["500元內", "500-1000元", "1000-2000元", "預算不限"] };
  }
  if (!d.flavor) {
    session.step = "ask_flavor";
    return { mode: "ask", ask: "對方有偏好的口味嗎？", options: ["清爽花香", "濃郁焙火", "不確定/請推薦"] };
  }
  return await runProductRecommendation("gift", d, products, client);
}

// 🍵 一般推薦流程
async function runRecommendFlow(session, products, client) {
  const d = session.data;

  if (!d.purpose) {
    session.step = "ask_purpose";
    return { mode: "ask", ask: "這次是自己喝，還是要送禮呢？😊", options: ["自己喝", "送禮"] };
  }
  if (d.purpose.includes("送禮")) {
    session.flow = "gift"; 
    return runGiftFlow(session, products, client);
  }
  if (!d.flavor) {
    session.step = "ask_flavor";
    return { mode: "ask", ask: "您平常比較喜歡什麼樣的風味？", options: ["清爽/高山氣", "花香/烏龍", "濃郁/焙火", "蜜香/紅茶"] };
  }
  return await runProductRecommendation("self", d, products, client);
}

// 🍽️ 搭餐流程
async function runPairingFlow(session, products, client) {
  const d = session.data;

  if (!d.dish) {
    return {
      mode: "ask",
      ask: "今晚想搭配什麼料理呢？（例如：牛排、壽司、甜點...）",
      options: ["油膩大餐", "精緻甜點", "海鮮/壽司", "炸物"]
    };
  }
  
  // 簡單搭餐邏輯 (輔助)
  let tag = "清香";
  if (/牛|豬|炸|膩/.test(d.dish)) tag = "焙火";
  if (/甜|糕|餅/.test(d.dish)) tag = "紅茶";
  if (/魚|鮮|生/.test(d.dish)) tag = "清香";

  const tea = products.find(p => p.tags?.includes(tag) || p.title.includes(tag)) || products[0];
  const reason = await generatePersuasiveReason(client, tea, { ...d, flavor: tag });

  return {
    mode: "pairing",
    tea: tea.id,
    summary: `搭配「${d.dish}」的最佳選擇`,
    reason: reason
  };
}

// 🎭 性格測驗流程
async function runPersonalityFlow(session, message, products, client) {
  if (!session.step) {
    session.step = "q1";
    return { mode: "ask", ask: "🌿 放假的時候，你喜歡哪種充電方式？", options: ["往戶外跑/爬山", "在家追劇/睡覺", "找朋友聚餐", "咖啡廳看書"] };
  }
  if (session.step === "q1") {
    session.data.p_q1 = message; session.step = "q2";
    return { mode: "ask", ask: "壓力大時，你第一直覺會想？", options: ["大吃一頓", "獨處聽音樂", "找人訴苦", "去運動流汗"] };
  }
  if (session.step === "q2") {
    session.data.p_q2 = message; session.step = "q3";
    return { mode: "ask", ask: "如果你是一種天氣，你覺得是？", options: ["午後陽光", "秋日微風", "雨後霧氣", "夏日艷陽"] };
  }
  if (session.step === "q3") {
    session.data.p_q3 = message;
    return await generatePersonalityResult(session.data, products, client);
  }
}

async function generatePersonalityResult(data, products, client) {
  const prompt = `
  我是祥興茶行阿興師。客人性格測驗答案：
  1.放假:${data.p_q1} 2.壓力:${data.p_q2} 3.天氣:${data.p_q3}
  請從清單挑選一款最符合他性格的茶：
  ${products.map(p => `${p.id}:${p.title}(${p.tags})`).join(", ")}
  
  回傳 JSON: {"tea_id": "...", "analysis": "50字冷讀術解析"}
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });
    const res = JSON.parse(completion.choices[0].message.content);
    const tea = products.find(p => p.id === res.tea_id) || products[0];
    return { mode: "personality", tea: tea.id, summary: res.analysis };
  } catch(e) {
    return { mode: "personality", tea: products[0].id, summary: "你是一個溫暖的人，這款茶很適合你。" };
  }
}

// ⚖️ 比較功能 (補上這個缺失的函式！)
async function runCompareAI(a, b, message, client) {
  const prompt = `
  請比較 A:${a.title} 和 B:${b.title}。
  使用者問：${message}
  
  回傳 JSON:
  {
    "a": "${a.id}", "b": "${b.id}",
    "compare": {
      "aroma": "A的香氣vsB的香氣",
      "body": "口感厚度比較",
      "roast": "焙火程度比較",
      "price": "價格比較",
      "summary": "一句話總結差異"
    }
  }
  `;
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });
    return { mode: "compare", ...JSON.parse(completion.choices[0].message.content) };
  } catch (e) {
    return { mode: "error", detail: "比較功能忙碌中" };
  }
}

// 🔍 推薦核心 (共用)
async function runProductRecommendation(mode, data, products, client) {
  const { target, budget, flavor } = data;
  const scored = products.map(p => {
    let score = 0;
    const text = (p.title + p.tags).toLowerCase();
    if (flavor && text.includes(flavor.replace("不確定", ""))) score += 5;
    const budgetNum = parseInt((budget || "9999").replace(/[^\d]/g, ""));
    if (p.price <= budgetNum) score += 3;
    if (mode === "gift" && target?.includes("長輩") && (text.includes("高山")||text.includes("烏龍"))) score += 3;
    return { ...p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const reason = await generatePersuasiveReason(client, scored[0], data);
  return { mode: mode === "gift"?"gift":"recommend", best: { id: scored[0].id, reason }, second: scored[1]?{ id: scored[1].id, reason: "另一種選擇" }:null };
}

// ============================================================
// 🕹️ 3. Main Router
// ============================================================

router.post("/", async (req, res) => {
  try {
    const { message, products, session: clientSession } = req.body;
    const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });
    let session = clientSession ?? initSession();

    // 🚀 優化：只有「不在」性格測驗流程時，才去萃取資訊 (省錢 + 避免誤判)
    if (session.flow !== "personality") {
      const extracted = await extractEntities(client, message, session.data);
      session.data = { ...session.data, ...extracted };
      console.log("📝 資訊更新:", session.data);
    }

    // 判斷意圖
    let intent = await classifyIntent(client, message);
    
    // 意圖切換邏輯
    if (intent !== "continue" && intent !== "recommend") {
      session.flow = intent;
      session.step = null;
    } else if (!session.flow) {
      session.flow = "recommend";
    }

    console.log(`🚀 Flow: ${session.flow} (Intent: ${intent})`);

    let result;
    switch (session.flow) {
      case "personality":
        result = await runPersonalityFlow(session, message, products, client);
        break;
      case "gift":
        result = await runGiftFlow(session, products, client);
        break;
      case "pairing":
        result = await runPairingFlow(session, products, client);
        break;
      case "brew":
        result = await runBrewFlow(session, message, products);
        break;
      case "compare":
        // 簡易抓取兩個商品 (若要更精準可用 extractProductsFromMessage，但此處簡單處理即可)
        const found = products.filter(p => message.includes(p.title.slice(0,2)));
        const a = found[0] || products[0];
        const b = found[1] || products[1];
        result = await runCompareAI(a, b, message, client);
        break;
      case "recommend":
      default:
        result = await runRecommendFlow(session, products, client);
        break;
    }

    res.json({ ...result, session });

  } catch (err) {
    console.error("Error:", err);
    res.status(200).json({ 
      mode: "recommend", 
      best: { id: products[0].id, reason: "阿興師現在有點忙，但我私心推薦這款招牌好茶！" },
      session 
    });
  }
});

export default router;