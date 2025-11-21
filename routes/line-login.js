// routes/line-login.js
import express from 'express';
import fetch from 'node-fetch';
import { updateOrCreateBind } from '../lib/member.js';
import { linePush, buildLineLoginBindUrl } from '../lib/line.js';
import { buildBindSuccessFlex } from '../lib/lineFlex.js';

const router = express.Router();

// 接收 LINE Login Callback
// 網址通常是 /api/line-login/callback
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  const redirectUri = `${process.env.APP_BASE_URL}/api/line-login/callback`;

  if (!code) {
    return res.status(400).send('Missing code');
  }

  try {
    // 1. 換取 Token
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
    if (!tokenJson.id_token) throw new Error('Token exchange failed');

    // 2. 驗證並取得 Profile (userId)
    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokenJson.id_token,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID,
      }),
    });
    const profile = await verifyRes.json();
    const userId = profile.sub;
    
    // State 帶回來的可能是手機號碼 (如果在觸發綁定時有填)
    const phoneRaw = state || '';

    // 3. 寫入資料庫 (綁定)
    await updateOrCreateBind(userId, phoneRaw);

    // 4. 推送漂亮的高級卡片
    const flexMsg = buildBindSuccessFlex(phoneRaw, process.env.SHOP_ORDER_FORM_URL);
    await linePush(userId, flexMsg);

    // 5. 回應網頁
    res.send(`
      <div style="text-align:center; padding:50px; font-family:sans-serif;">
        <h1 style="color:#5A7B68;">綁定成功！</h1>
        <p>請回到 LINE 聊天室查看會員資訊。</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      </div>
    `);

  } catch (err) {
    console.error('[LineLogin] Error:', err);
    res.status(500).send('綁定失敗，請稍後再試。');
  }
});

export default router;