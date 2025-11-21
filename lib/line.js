// lib/line.js
import crypto from 'crypto';
import fetch from 'node-fetch';

const LINE_API = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN = process.env.LINE_CHANNEL_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// === Reply API ===
async function lineReply(replyToken, messages) {
  if (!replyToken || !ACCESS_TOKEN) return;
  try {
    const res = await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: Array.isArray(messages) ? messages : [messages],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('LINE Reply Error:', text);
    }
  } catch (err) {
    console.error('LINE Reply Network Error:', err);
  }
}

// === Push API ===
async function linePush(userId, messages) {
  if (!userId || !ACCESS_TOKEN) return;
  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: Array.isArray(messages) ? messages : [messages],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('LINE Push Error:', text);
    }
  } catch (err) {
    console.error('LINE Push Network Error:', err);
  }
}

// === Verify Signature ===
function verifyLineSignature(req) {
  if (!CHANNEL_SECRET) return true; 
  const signature = req.headers['x-line-signature'];
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64');
  return hash === signature;
}

// === Build Login URL (Auth) ===
function buildLineLoginBindUrl(phone = '') {
  const base = process.env.APP_BASE_URL || 'https://example.com';
  // 修正 Callback 路徑
  const redirect = encodeURIComponent(`${base}/api/line-login/callback`);
  const state = encodeURIComponent(phone || '');
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  return `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirect}&state=${state}&scope=openid%20profile`;
}

export {
  lineReply,
  linePush, // 統一命名 export
  verifyLineSignature,
  buildLineLoginBindUrl,
};