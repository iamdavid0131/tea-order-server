import express from "express";
import fetch from "node-fetch";

const router = express.Router();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/* ============================================================
   📍 1️⃣ 使用者目前位置 → 搜尋附近超商
   GET /stores/near?lat=24.25&lng=120.53&brand=7-11&radius=1000
   ============================================================ */
router.get("/near", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const radius = req.query.radius || 1500;
    const brand = req.query.brand || "all";

    if (!lat || !lng) {
      return res.status(400).json({ ok: false, error: "缺少座標 lat/lng" });
    }
    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ ok: false, error: "缺少 GOOGLE_MAPS_API_KEY" });
    }

    // ✅ keyword + type 提高命中率
    let keyword = "便利商店";
    if (/7/i.test(brand)) keyword = "7-ELEVEN";
    if (/family/i.test(brand)) keyword = "全家 FamilyMart";

    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?keyword=${encodeURIComponent(
      keyword
    )}&location=${lat},${lng}&radius=${radius}&type=convenience_store&language=zh-TW&key=${GOOGLE_MAPS_API_KEY}`;

    const resNearby = await fetch(nearbyUrl);
    const json = await resNearby.json();

    let results = json.results || [];

    // 🔁 若 Nearby 無結果 → 自動 fallback 為 Text Search
    if (!results.length) {
      console.log("🔁 Nearby 無結果，改用 Text Search");
      const textUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
        keyword
      )}&location=${lat},${lng}&radius=${radius}&language=zh-TW&type=convenience_store&key=${GOOGLE_MAPS_API_KEY}`;
      const resText = await fetch(textUrl);
      const textData = await resText.json();
      results = textData.results || [];
    }

    if (!results.length) return res.json({ ok: false, stores: [] });

    const stores = results.map((p) => ({
      name: p.name,
      address: p.vicinity || p.formatted_address || "",
      placeId: p.place_id,
      lat: p.geometry?.location?.lat,
      lng: p.geometry?.location?.lng,
    }));

    res.json({ ok: true, stores });
  } catch (err) {
    console.error("[stores/near] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ============================================================
   📍 2️⃣ 搜尋「地標」附近的超商
   GET /stores/landmark?q=台北車站&radius=800
   ============================================================ */
router.get("/landmark", async (req, res) => {
  try {
    const q = req.query.q;
    const radius = req.query.radius || 800;
    const brand = req.query.brand || "all";

    if (!q)
      return res.status(400).json({ ok: false, error: "缺少 q" });
    if (!GOOGLE_MAPS_API_KEY)
      return res.status(500).json({ ok: false, error: "缺少 GOOGLE_MAPS_API_KEY" });

    // 1️⃣ 將地標轉成座標
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      q
    )}&language=zh-TW&key=${GOOGLE_MAPS_API_KEY}`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (!geoData.results?.length)
      return res.json({ ok: false, stores: [], error: "查無地標" });

    const { lat, lng } = geoData.results[0].geometry.location;

    // 2️⃣ 分別搜尋 7-ELEVEN 與全家，再合併結果
        // 根據品牌查詢
    let keywords = [];
    if (brand === "all") {
      keywords = ["7-ELEVEN", "全家 FamilyMart"];
    } else if (brand === "7-11") {
      keywords = ["7-ELEVEN"];
    } else if (brand === "familymart") {
      keywords = ["全家 FamilyMart"];
    }
    const allResults = [];

    for (const kw of keywords) {
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?keyword=${encodeURIComponent(
        kw
      )}&location=${lat},${lng}&radius=${radius}&type=convenience_store&language=zh-TW&key=${GOOGLE_MAPS_API_KEY}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (data.results?.length) {
        allResults.push(...data.results);
      }
    }

    if (!allResults.length) {
      return res.json({ ok: false, stores: [], lat, lng });
    }

    // 3️⃣ 整理回傳格式並去除重複店名
    const seen = new Set();
    const stores = allResults
      .map((p) => ({
        name: p.name,
        address: p.vicinity || "",
        placeId: p.place_id,
        lat: p.geometry?.location.lat,
        lng: p.geometry?.location.lng,
      }))
      .filter((s) => {
        const key = `${s.name}-${s.address}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    // 4️⃣ 回傳結果
    console.log(`[landmark] ${q} 周圍找到 ${stores.length} 間店`);
    res.json({ ok: true, lat, lng, stores });

  } catch (err) {
    console.error("[stores/landmark] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


/* ============================================================
   📍 3️⃣ 查詢單一門市詳細資料
   GET /stores/detail?placeId=xxxxx
   ============================================================ */
router.get("/detail", async (req, res) => {
  try {
    const placeId = req.query.placeId;
    if (!placeId)
      return res.status(400).json({ ok: false, error: "缺少 placeId" });

    const endpoint = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry,opening_hours,formatted_phone_number&language=zh-TW&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(endpoint);
    const json = await response.json();

    if (!json.result)
      return res.json({ ok: false, error: "查無詳細資料" });

    const p = json.result;
    const store = {
      name: p.name,
      address: p.formatted_address,
      phone: p.formatted_phone_number || "",
      lat: p.geometry?.location?.lat,
      lng: p.geometry?.location?.lng,
      openNow: p.opening_hours?.open_now || null,
      weekdayText: p.opening_hours?.weekday_text || [],
    };

    res.json({ ok: true, store });
  } catch (err) {
    console.error("[stores/detail] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
