import express from 'express';
import fetch from 'node-fetch';
import { updateOrCreateBind } from '../lib/member.js';
import { pushLineMessage } from '../lib/line.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { code, state } = req.query;
  const redirectUri = `${process.env.APP_BASE_URL}/line-login`;

  if (!code) {
    const bindUrl = buildLineLoginBindUrl(process.env, state);
    return res.redirect(bindUrl);
  }

  try {
    // Step 1: 以 code 換取 id_token
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID,
        client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.id_token) throw new Error('LINE 授權失敗（沒有 id_token）');

    // Step 2: 驗證 id_token → 取得 userId
    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokenJson.id_token,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID,
      }),
    });
    const verifyJson = await verifyRes.json();
    const userId = verifyJson.sub;
    if (!userId) throw new Error('無法取得 userId');

    // Step 3: 寫入會員綁定資料
    const phoneRaw = state || '';
    const bind = await updateOrCreateBind(userId, phoneRaw);

    // Step 4: 發送綁定成功 Flex 卡
    const flexCard = buildBindSuccessFlex(phoneRaw, process.env.SHOP_ORDER_FORM_URL);
    await pushLineMessage(userId, {
      type: 'flex',
      altText: '綁定成功',
      contents: flexCard,
    });

    res.send('綁定完成！請回到 LINE 查看確認訊息。');
  } catch (err) {
    console.error('[line-login]', err);
    res.status(500).send('綁定失敗：' + err.message);
  }
});

/** 建立 LINE Login 授權連結 */
function buildLineLoginBindUrl(env, phone) {
  const redirect = encodeURIComponent(`${env.APP_BASE_URL}/line-login`);
  const state = encodeURIComponent(phone || '');
  return `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${env.LINE_LOGIN_CHANNEL_ID}&redirect_uri=${redirect}&state=${state}&scope=openid%20profile`;
}

/** 綁定成功 Flex 卡 */
function buildBindSuccessFlex(phone, orderUrl) {
  return {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#FAF8F5',
      paddingAll: '18px',
      contents: [
        {
          type: 'text',
          text: '綁定成功 🎉',
          size: 'xl',
          weight: 'bold',
          color: '#5C4832',
        },
        {
          type: 'text',
          text: phone ? `手機 ${phone} 已完成會員綁定。` : '會員綁定成功！',
          size: 'sm',
          color: '#6B7280',
          margin: 'sm',
        },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'lg',
          spacing: 'md',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#B38740',
              action: { type: 'message', label: '查訂單', text: '查訂單' },
            },
            {
              type: 'button',
              style: 'secondary',
              color: '#E5E7EB',
              action: { type: 'message', label: '會員等級', text: '會員等級' },
            },
          ],
        },
        {
          type: 'separator',
          margin: 'lg',
        },
        {
          type: 'text',
          text: '👉 點擊下方按鈕回購茶品',
          size: 'sm',
          color: '#9CA3AF',
          margin: 'md',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'link',
          color: '#5C4832',
          action: {
            type: 'uri',
            label: '前往訂購茶品',
            uri: orderUrl,
          },
        },
      ],
    },
    styles: {
      body: { backgroundColor: '#FAF8F5' },
      footer: { backgroundColor: '#F3F4F6' },
    },
  };
}

export default router;
