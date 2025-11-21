import nodemailer from 'nodemailer';
import { format } from 'date-fns-tz';
import { linePush } from './line.js'; // 👈 引用統一的推播函式
import { buildOrderFlex } from './lineFlex.js'; // 👈 引用旗艦卡片生成器

/**
 * 📨 發送訂單通知給管理員
 */
export async function sendOrderNotification(order) {
  const { orderId, name, phone, total, items, method, address, storeName, storeCarrier, note } = order;

  // === 1️⃣ 資料格式化 ===
  const now = format(new Date(), 'yyyy/MM/dd HH:mm', { timeZone: 'Asia/Taipei' });
  
  // 處理品項清單字串
  const itemList = Array.isArray(items)
    ? items.map(i => `${i.name || i.title || '商品'} x${i.qty}`).join('\n')
    : '(無品項資料)';

  const totalText = `NT$${Number(total || 0).toLocaleString('zh-TW')}`;
  
  // 處理物流資訊字串
  const deliveryInfo = method === 'store'
    ? `🏪 [${storeCarrier?.toUpperCase()}] ${storeName}`
    : `🏠 ${address}`;

  // === 2️⃣ 產生詳細文字報告 (Email 與 LINE 備份用) ===
  const summaryText = `
🔥 新訂單通知 (${orderId})
────────────────
👤 顧客：${name} (${phone})
💰 金額：${totalText}
🚚 方式：${method === 'store' ? '超商取貨' : '宅配'}
📍 地址：${deliveryInfo}
📝 備註：${note || '無'}
────────────────
📦 訂購品項：
${itemList}
────────────────
🕒 時間：${now}
  `.trim();

  // === 3️⃣ 發送 LINE 通知 (旗艦雙重奏) ===
  try {
    const adminId = process.env.LINE_ADMIN_USER_ID;

    if (adminId) {
      // A. 製作精美的訂單 Flex 卡片
      const flexMsg = buildOrderFlex({
        buyerName: name,      // 顯示顧客姓名
        dateText: now,        // 下單時間
        summary: itemList,    // 商品清單
        totalNum: total,      // 總金額
        status: '新訂單'       // 強制顯示狀態為「新訂單」
      });

      // B. 準備詳細文字訊息 (包含地址、備註等卡片塞不下的資訊)
      const detailMsg = {
        type: 'text',
        text: `📍 出貨資訊：\n${deliveryInfo}\n\n📝 備註：\n${note || '無'}`
      };

      // C. 一次推送兩則 (卡片 + 詳細資訊)
      await linePush(adminId, [flexMsg, detailMsg]);
      console.log('[notify] LINE 通知已發送 (Flex + Text)');
    }
  } catch (err) {
    console.error('[notify] LINE 通知失敗:', err.message);
  }

  // === 4️⃣ 發送 Email 通知 (維持原樣，僅做防呆) ===
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

      await transporter.sendMail({
        from: `"祥興茶業 自動通知" <${smtpUser}>`,
        to: adminMail,
        subject: `🔥 新訂單 ${orderId} - ${name}`,
        text: summaryText, // Email 使用純文字版報告
      });

      console.log('[notify] Email 已寄出');
    }
  } catch (err) {
    console.error('[notify] Email 通知失敗:', err.message);
  }

  return { ok: true };
}