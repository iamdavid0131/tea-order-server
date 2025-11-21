import nodemailer from 'nodemailer';
import { format } from 'date-fns-tz';
import { linePush } from './line.js';
import { buildOrderFlex } from './lineFlex.js';

export async function sendOrderNotification(order) {
  // statusRaw 是我們剛剛在 order.js 傳進來的 "🟢 貨到付款" 或 "🟡 線上支付"
  const { orderId, name, phone, total, items, method, address, storeName, storeCarrier, note, statusRaw } = order;

  const now = format(new Date(), 'yyyy/MM/dd HH:mm', { timeZone: 'Asia/Taipei' });
  
  const itemList = Array.isArray(items)
    ? items.map(i => `${i.name || i.title || '商品'} x${i.qty}`).join('\n')
    : '(無品項資料)';

  const totalText = `NT$${Number(total || 0).toLocaleString('zh-TW')}`;
  
  const deliveryInfo = method === 'store'
    ? `🏪 [${storeCarrier?.toUpperCase()}] ${storeName}`
    : `🏠 ${address}`;

  // 顯示用標題 (如果沒有 statusRaw 就用預設值)
  const displayStatus = statusRaw || '新訂單';

  // === LINE 通知 ===
  try {
    const adminId = process.env.LINE_ADMIN_USER_ID;

    if (adminId) {
      // 1. 訂單卡片 (利用 buildOrderFlex，並把狀態塞進去)
      const flexMsg = buildOrderFlex({
        buyerName: name,
        dateText: now,
        summary: itemList,
        totalNum: total,
        // 🔥 這裡會讓卡片右上角顯示 "貨到付款" 或 "待付款"
        status: displayStatus 
      });

      // 2. 詳細資訊 (加上明顯的 Emoji 標題)
      const detailMsg = {
        type: 'text',
        text: `📄 詳細出貨資訊\n\n狀態：${displayStatus}\n\n📍 地址/門市：\n${deliveryInfo}\n\n📱 電話：${phone}\n\n📝 備註：\n${note || '無'}`
      };

      await linePush(adminId, [flexMsg, detailMsg]);
    }
  } catch (err) {
    console.error('[notify] LINE 通知失敗:', err.message);
  }

  // === Email 通知 ===
  try {
    const adminMail = process.env.ADMIN_EMAIL;
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (adminMail && smtpHost && smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        host: smtpHost, port: 465, secure: true,
        auth: { user: smtpUser, pass: smtpPass },
      });

      const summaryText = `
${displayStatus}
訂單編號：${orderId}
顧客：${name} (${phone})
金額：${totalText}
地址：${deliveryInfo}
備註：${note || '無'}
----------------
${itemList}
      `.trim();

      await transporter.sendMail({
        from: `"祥興茶業" <${smtpUser}>`,
        to: adminMail,
        subject: `[${displayStatus}] 訂單 ${orderId}`,
        text: summaryText,
      });
      console.log('[notify] Email 已寄出');
    }
  } catch (err) {
    console.error('[notify] Email 通知失敗:', err.message);
  }

  return { ok: true };
}