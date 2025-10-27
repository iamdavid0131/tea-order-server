import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * 🔍 查詢門市（依使用者輸入的關鍵字與位置）
 * GET /stores/search?q=梧棲7-11&lat=24.254&lng=120.529
 */
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const lat = req.query.lat;
    const lng = req.query.lng;

    if (!q) return res.status(400).json({ ok: false, error: '缺少查詢關鍵字 q' });
    if (!GOOGLE_MAPS_API_KEY) return res.status(500).json({ ok: false, error: '缺少 GOOGLE_MAPS_API_KEY' });

    // Google Places Nearby Search or Text Search
    const endpoint = lat && lng
      ? `https://maps.googleapis.com/maps/api/place/nearbysearch/json?keyword=${encodeURIComponent(q)}&location=${lat},${lng}&radius=3000&key=${GOOGLE_MAPS_API_KEY}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(endpoint);
    const json = await response.json();

    if (!json.results) return res.json({ ok: false, error: '查無資料' });

    const stores = json.results.slice(0, 10).map(p => ({
      name: p.name,
      address: p.formatted_address || (p.vicinity || ''),
      placeId: p.place_id,
      lat: p.geometry?.location?.lat,
      lng: p.geometry?.location?.lng,
      icon: p.icon,
      rating: p.rating || null,
      types: p.types || [],
    }));

    res.json({ ok: true, stores });
  } catch (err) {
    console.error('[stores/search] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 📍 查詢單一門市詳細資料
 * GET /stores/detail?placeId=xxxxx
 */
router.get('/detail', async (req, res) => {
  try {
    const placeId = req.query.placeId;
    if (!placeId) return res.status(400).json({ ok: false, error: '缺少 placeId' });

    const endpoint = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry,opening_hours,formatted_phone_number&language=zh-TW&key=${GOOGLE_API_KEY}`;
    const response = await fetch(endpoint);
    const json = await response.json();

    if (!json.result) return res.json({ ok: false, error: '查無詳細資料' });

    const p = json.result;
    const store = {
      name: p.name,
      address: p.formatted_address,
      phone: p.formatted_phone_number || '',
      lat: p.geometry?.location?.lat,
      lng: p.geometry?.location?.lng,
      openNow: p.opening_hours?.open_now || null,
      weekdayText: p.opening_hours?.weekday_text || [],
    };

    res.json({ ok: true, store });
  } catch (err) {
    console.error('[stores/detail] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
