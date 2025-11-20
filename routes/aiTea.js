// ============================================================
// ⭐ 祥興茶行 AI 導購 — 旗艦完整修正版 (Smart Flow v3.1)
// ============================================================

import express from "express";
import OpenAI from "openai";
const router = express.Router();

  // 🤫 隱藏版商品資料 (官網列表沒有的)
  const HIDDEN_PRODUCT = {
    id: "secret_888",
    title: "👑 傳奇・80年代老凍頂",
    price: 8800,
    tags: "老饕限定 | 封存40年 | 數量稀少",
    desc: "這不是普通的茶，這是時光的味道。阿興師爺爺留下來的壓箱寶，只有真正的行家才懂。入口即化的陳年梅香，市面無售。"
  };

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
// 🛠️ 1-1. 全局資訊萃取 + 自動口味側寫
async function extractEntities(client, message, currentData) {
  // 取得目前的側寫標籤 (如果有的話)
  const currentTags = currentData.tags || [];

  const prompt = `
  使用者正在與茶行 AI 對話。
  使用者最新訊息：「${message}」
  
  請執行兩個任務：
  
  【任務 A：更新基本資訊】(若未提到回傳 null)
  1. target (對象)
  2. budget (預算)
  3. purpose (送禮/自飲)
  4. dish (搭配料理)

  【任務 B：口味特徵側寫 (Profiling)】
  請根據這句話，判斷使用者的口味偏好，回傳一個標籤陣列 (tags)。
  - 若提到 "怕澀" -> 加 "喜甜/滑順"
  - 若提到 "剛吃飽" -> 加 "解膩"
  - 若提到 "喜歡重口味" -> 加 "喜焙火"
  - 若提到 "喜歡清淡" -> 加 "喜高山/清香"
  - 若無明顯偏好，回傳空陣列 []
  
  回傳 JSON:
  {
    "target": "...", "budget": "...", "purpose": "...", "dish": "...",
    "new_tags": ["喜甜", "喜焙火"] 
  }
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
    
    const res = JSON.parse(completion.choices[0].message.content);
    
    // 邏輯：將新標籤合併到舊標籤，並去重 (Set)
    const mergedTags = [...new Set([...currentTags, ...(res.new_tags || [])])];

    return {
      ...res,
      tags: mergedTags // 更新後的標籤庫
    };
  } catch (e) {
    return {};
  }
}

// 🛠️ 1-2. 意圖判斷
async function classifyIntent(client, message, session) {
  const msg = message.trim();
  // 🔥【規則 1】純數字、預算區間 -> continue
  if (/^\$?\d+(-\d+)?\s*$/.test(msg)) return "continue";



  const prompt = `
  你是祥興茶行的店長。請判斷客人的意圖。
  
  【當前對話狀態】
  - 目前流程 (Flow): ${session.flow || "無 (剛開始)"}
  - 上一步驟 (Step): ${session.step || "無"}
  - 已知資訊: ${JSON.stringify(session.data)}
  
  【客人最新訊息】
  「${msg}」

  【判斷邏輯】
  1. 如果客人的訊息是在 **回答上一步驟的問題** (例如剛問送禮自飲，客人回"自己喝") -> 絕對是 "continue"。
  2. 如果客人 **明顯想換話題** (例如正在問口味，突然問"怎麼泡") -> 才是 "brew" / "gift" / "pairing" 等。
  3. 若無法判斷，傾向維持當前流程。

  【分類選項】
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
// 🍽️ 搭餐流程 (中醫食補版)
async function runPairingFlow(session, products, client) {
  const d = session.data;

  if (!d.dish) {
    return {
      mode: "ask",
      ask: "想搭配什麼料理呢？阿興師可以用中醫食補的角度幫您配茶喔！（例如：大閘蟹、麻辣鍋、月餅...）",
      options: ["大餐/解膩", "甜點", "海鮮/壽司", "炸物"]
    };
  }

  // 呼叫 AI 做中醫分析
  return await recommendTCMTea(client, d.dish, products);
}

// 🧠 中醫食補推薦核心
async function recommendTCMTea(client, dish, products) {
  const prompt = `
  你是精通中醫食療的茶師「阿興師」。
  客人想吃：「${dish}」。

  請執行以下思考步驟：
  1. 分析「${dish}」的中醫屬性（寒涼、燥熱、油膩、甜膩）。
  2. 根據「陰陽調和」原理，挑選一款最能平衡身體的茶。
     - 寒涼食物 (如蟹、生魚片) -> 配 溫熱性茶 (紅茶、重焙火烏龍、東方美人)。
     - 燥熱食物 (如炸雞、麻辣鍋) -> 配 涼性茶 (清香烏龍、高山茶、綠茶)。
     - 油膩 -> 配 分解脂肪強的茶 (凍頂烏龍、高山茶)。
     - 甜膩 -> 配 爽口解甜的茶 (紅茶、蜜香)。
  
  可選茶品清單：
  ${products.map(p => `${p.id}:${p.title}(${p.tags})`).join(", ")}

  請回傳 JSON:
  {
    "tea_id": "選中的產品ID",
    "food_nature": "食物屬性(例如：屬於寒性食物)",
    "tea_nature": "茶屬性(例如：具有溫補暖胃的效果)",
    "reason": "30字內的推薦理由，請用中醫/養生角度解釋為什麼這樣搭 (例如：螃蟹性寒，這款紅玉紅茶能暖胃驅寒，避免腸胃不適)。"
  }
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

    const res = JSON.parse(completion.choices[0].message.content);
    const tea = products.find(p => p.id === res.tea_id) || products[0];

    return {
      mode: "pairing",
      tea: tea.id,
      summary: `搭配「${dish}」的養生首選`, // 標題
      reason: res.reason // 這裡會顯示中醫的理由
    };

  } catch (e) {
    console.error("TCM Error", e);
    // 兜底：如果 AI 失敗，用簡單邏輯
    const tea = products[0];
    return {
      mode: "pairing",
      tea: tea.id,
      summary: `搭配「${dish}」的推薦`,
      reason: "這款茶風味獨特，非常適合搭配餐點享用。"
    };
  }
}

// 📸 視覺搭餐核心 (GPT-4o-mini Vision)
async function recommendTeaByImage(client, base64Image, products) {
  const prompt = `
  這是一張客人正在吃的食物照片。
  請扮演「祥興茶行阿興師」，以中醫食療與風味平衡的角度：
  
  1. 觀察照片中的食物（是什麼？看起來油膩嗎？是甜點還是大餐？屬性是寒涼還是燥熱？）。
  2. 從下方茶品清單中，挑選 **1 款** 最適合搭配的茶。
  3. 給出推薦理由。
  
  可選茶品：
  ${products.map(p => `${p.id}:${p.title}(${p.tags})`).join(", ")}

  請回傳 JSON:
  {
    "food_detected": "偵測到的食物名稱 (例如：麻辣鍋)",
    "tea_id": "推薦的產品ID",
    "reason": "30-50字的推薦理由 (例如：這鍋看起來紅通通的，屬於燥熱油膩，建議搭配凍頂烏龍來去油解膩...)"
  }
  `;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: base64Image } } // 👈 GPT-4o-mini 支援直接吃 Base64
          ],
        },
      ],
      max_tokens: 500,
    });

    // 解析 JSON (有時候模型會包在 ```json ... ``` 裡，做個簡單處理)
    let content = response.choices[0].message.content;
    content = content.replace(/```json|```/g, "").trim();
    const res = JSON.parse(content);

    const tea = products.find(p => p.id === res.tea_id) || products[0];

    return {
      mode: "pairing", // 重用前端的搭餐 UI
      tea: tea.id,
      summary: `👁️ 阿興師看到你在吃「${res.food_detected}」！`,
      reason: res.reason
    };

  } catch (e) {
    console.error("Vision Error:", e);
    return {
      mode: "recommend",
      best: { id: products[0].id, reason: "這張照片看起來太美味了，阿興師一時看餓了...不如先來杯招牌茶解解饞？" }
    };
  }
}

// 🕵️ 隱藏菜單流程
async function runSecretFlow(session, client) {
  // 清除狀態，避免卡住
  session.flow = null;
  session.step = null;

  return {
    mode: "masterpick", // 借用店長推薦的 UI，或者你可以新增一個 secret mode
    best: HIDDEN_PRODUCT.id,
    // 這裡我們手動組裝一個 fake product 物件傳給前端，因為它不在 config.js 的列表裡
    // 但為了簡單起見，我們直接回傳內容，前端通常只認 ID
    // ⚠️ 重要技巧：我們把整顆物件塞進去，前端需要支援 (等下會改前端)
    tea_data: HIDDEN_PRODUCT, 
    reason: "噓...小聲點。既然你是內行人，我才把這罐從後面拿出來。這是爺爺留下來的 80 年代老茶，喝一泡少一泡，別讓太多人知道..."
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
    // 🔥 順便生成茶籤
    const soulText = await generateSoulText(client, tea, data);
    return { mode: "personality", tea: tea.id, summary: res.analysis, card_text: soulText };
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

// 💌 生成靈魂茶籤文案
async function generateSoulText(client, tea, userState) {
  const prompt = `
  你是祥興茶行的阿興師。
  客人剛選了：${tea.title}
  客人的狀態/需求：${JSON.stringify(userState)}

  請寫一段「心靈茶籤」送給他。
  要求：
  1. 字數 30 字以內，短小精悍，像現代詩或俳句。
  2. 語氣溫暖、療癒、富有哲理。
  3. 結合茶的特性（例如：金萱的奶香代表溫柔、鐵觀音的焙火代表歷練）。
  4. 不要任何解釋，只回傳那段話。

  範例：「生活不必時時刻刻發光。這杯金萱的溫柔奶香，允許你暫時卸下堅強。」
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });
    return completion.choices[0].message.content.replace(/"/g, "").trim();
  } catch (e) {
    return "茶香是時間的禮物，願這杯茶溫暖你的心。";
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
  const best = scored[0];

  const soulText = await generateSoulText(client, best, data);
  scored.sort((a, b) => b.score - a.score);
  const reason = await generatePersuasiveReason(client, scored[0], data);
  return {
    mode: mode === "gift" ? "gift" : "recommend",
    best: { id: best.id, reason },
    second: scored[1] ? { id: scored[1].id, reason: "另一種選擇" } : null,
    card_text: soulText // 👈 新增這個欄位
  };
}

// ============================================================
// 🕹️ 3. Main Router
// ============================================================

router.post("/", async (req, res) => {
  try {
   // 👈 記得解構 image
    const { message, image, products, session: clientSession } = req.body; 
    const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });
    let session = clientSession ?? initSession();

    // 🔥 強制介入：如果有圖片，直接走視覺流程，不跑下面的文字邏輯
    if (image) {
      console.log("📸 收到圖片，啟動阿興師之眼...");
      const result = await recommendTeaByImage(client, image, products);
      
      // 設定一下 session 狀態，讓對話看起來自然
      session.flow = "pairing";
      session.data.dish = "圖片食物"; // 標記一下
      
      return res.json({ ...result, session });
    }

    // 🚀 優化：只有「不在」性格測驗流程時，才去萃取資訊 (省錢 + 避免誤判)
    if (session.flow !== "personality") {
      const extracted = await extractEntities(client, message, session.data);
      // ✅【修正寫法】智慧合併：只有當新資料「有東西」時，才更新 Session
      Object.entries(extracted).forEach(([key, value]) => {
        // 只有當 value 不是 null, undefined, 或是空字串時，才更新
        if (value !== null && value !== undefined && value !== "") {
          session.data[key] = value;
        }
      });
      console.log("📝 資訊更新:", session.data);
    }

    // 3. 判斷意圖 (傳入 session，讓 AI 知道上下文)
    let intent = await classifyIntent(client, message, session);

    // 🕵️【新增】彩蛋攔截邏輯
    // 條件 1: 關鍵字觸發
    if (message.includes("隱藏") || message.includes("私房") || message.includes("厲害的")) {
       console.log("🕵️ 觸發隱藏菜單！");
       const result = await runSecretFlow(session, client);
       // 特殊處理：因為前端 products 列表裡沒這項，我們得讓前端知道這是特例
       return res.json({ ...result, session, isSecret: true });
    }
    
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