// lib/line.js
import crypto from 'crypto';
import fetch from 'node-fetch';

const LINE_API = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN = process.env.LINE_CHANNEL_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// === Reply ===
async function lineReply(replyToken, messages) {
  if (!replyToken || !ACCESS_TOKEN) return;
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
}

// === Push ===
async function linePush(userId, messages) {
  if (!userId || !ACCESS_TOKEN) return;
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
}

// === Verify Signature ===
function verifyLineSignature(req) {
  if (!CHANNEL_SECRET) return true; // 若沒設定就跳過
  const signature = req.headers['x-line-signature'];
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64');
  return hash === signature;
}

// === 建立 LINE Login 綁定連結 ===
function buildLineLoginBindUrl(phone = '') {
  const base = process.env.APP_BASE_URL || 'https://example.com';
  const redirect = encodeURIComponent(`${base}/api/line-login`);
  const state = encodeURIComponent(phone || '');
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  return `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirect}&state=${state}&scope=openid%20profile`;
}

// === 回覆綁定卡片 Flex ===
async function replyBindCardFlex(replyToken, phone = '') {
  const url = buildLineLoginBindUrl(phone);
  const bubble = buildBindFlexBubble(phone, url);
  return lineReply(replyToken, {
    type: 'flex',
    altText: '會員綁定',
    contents: bubble,
  });
}

// === 綁定提示 Flex 卡 ===
function buildBindFlexBubble(phone, url) {
  return {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#FAF8F5',
      paddingAll: '18px',
      contents: [
        { type: 'text', text: '會員綁定', size: 'xl', weight: 'bold', color: '#5C4832' },
        {
          type: 'text',
          text: '點擊下方按鈕以授權綁定 LINE 帳號與會員資料。',
          wrap: true,
          size: 'sm',
          color: '#6B7280',
          margin: 'sm',
        },
        phone && {
          type: 'text',
          text: `電話：${phone}`,
          size: 'sm',
          color: '#9CA3AF',
          margin: 'sm',
        },
        {
          type: 'button',
          style: 'primary',
          color: '#B38740',
          action: { type: 'uri', label: '立即綁定', uri: url },
          margin: 'lg',
        },
      ].filter(Boolean),
    },
  };
}

export {
  lineReply,
  linePush as pushLineMessage,
  verifyLineSignature,
  buildLineLoginBindUrl,
  replyBindCardFlex,
};
