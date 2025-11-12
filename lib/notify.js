import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import { getSheetsClient } from './sheets.js';
import { format } from 'date-fns-tz';

/**
 * 📨 發送訂單通知給管理員 + 顧客
 * - 寄 Email
 * - 發 LINE
 */
export async function sendOrderNotification(order) {
  const { orderId, name, phone, total, items, method, address, storeName, storeCarrier } = order;

  // --- 1️⃣ 組成訂單摘要 ---
  const itemList = Array.isArray(items)
    ? items.map(i => `${i.name || i.title || '(未命名商品)'} x${i.qty || 0}`).join('\n')
  : '(無品項資料)';
  const totalText = `NT$${Number(total || 0).toLocaleString('zh-TW')}`;
  const now = format(new Date(), 'yyyy/MM/dd HH:mm', { timeZone: 'Asia/Taipei' });

  const summary = `
📦 新訂單通知
────────────────────
🧾 訂單編號：${orderId}
👤 顧客姓名：${name || '(未填)'}
📱 聯絡電話：${phone || '(未填)'}
🚚 出貨方式：${method || '(未選)'}
🏪 門市：${storeCarrier || ''} ${storeName || ''}
🏠 地址：${address || ''}
💰 訂單金額：${totalText}
────────────────────
📦 品項：
${itemList}
────────────────────
🕒 下單時間：${now}
  `.trim();

  // --- 2️⃣ 發送 LINE 通知 ---
  try {
    const adminId = process.env.LINE_ADMIN_USER_ID;
    const token = process.env.LINE_CHANNEL_TOKEN;

    if (adminId && token) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: adminId,
          messages: [{ type: 'text', text: summary }],
        }),
      });
    }
  } catch (err) {
    console.error('[notify] LINE 通知失敗:', err.message);
  }

  // --- 3️⃣ 發送 Email 通知（可選） ---
  try {
    const adminMail = process.env.ADMIN_EMAIL;
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (adminMail && smtpHost && smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: 465,
        secure: true,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: `"祥興茶業 訂單通知" <${smtpUser}>`,
        to: adminMail,
        subject: `🧾 新訂單 ${orderId} (${name || phone})`,
        text: summary,
      });

      console.log('[notify] Email 已寄出');
    }
  } catch (err) {
    console.error('[notify] Email 通知失敗:', err.message);
  }

  return { ok: true };
}
