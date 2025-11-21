// lib/lineFlex.js
import { computeTierBySum } from './utils.js';

// ✨ 旗艦版視覺主題定義
const THEME = {
  colors: {
    bg: '#F9F7F0',          // 宣紙白背景
    primary: '#5A7B68',     // 品牌主色 (茶綠)
    secondary: '#8FB79C',   // 輔助綠
    gold: '#B8860B',        // 尊爵金 (強調重點)
    text: '#2F4B3C',        // 深墨綠文字
    subText: '#7A8C82',     // 淺灰綠文字
    headerBg: '#2F4B3C',    // 標題背景
    footerBg: '#EFECE4'     // 底部背景
  },
  sizes: {
    title: 'xl',
    body: 'sm'
  }
};

/**
 * 🛠 通用卡片容器 (Header + Body + Footer)
 */
function createBaseBubble(title, contents, footerContents = null) {
  const bubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: THEME.colors.headerBg,
      paddingAll: '15px',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#FFFFFF', align: 'center' }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: THEME.colors.bg,
      paddingAll: '20px',
      contents: contents
    }
  };

  if (footerContents) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      backgroundColor: THEME.colors.footerBg,
      paddingAll: '15px',
      contents: footerContents
    };
  }

  return bubble;
}

// ==========================================================
// 1. 會員綁定邀請卡
// ==========================================================
export function buildBindInviteFlex(url) {
  return {
    type: 'flex',
    altText: '邀請您綁定會員',
    contents: createBaseBubble('會員權益綁定', [
      {
        type: 'text',
        text: '歡迎來到祥興茶行',
        weight: 'bold',
        size: 'lg',
        color: THEME.colors.text,
        align: 'center'
      },
      {
        type: 'text',
        text: '綁定 LINE 帳號，即時查詢訂單狀態、累積消費金額與專屬升等禮遇。',
        wrap: true,
        size: 'sm',
        color: THEME.colors.subText,
        margin: 'md',
        align: 'center',
        lineSpacing: '4px'
      },
      {
        type: 'button',
        style: 'primary',
        color: THEME.colors.primary,
        action: { type: 'uri', label: '立即綁定會員', uri: url },
        margin: 'xl',
        height: 'sm'
      }
    ])
  };
}

// ==========================================================
// 2. 綁定成功通知卡
// ==========================================================
export function buildBindSuccessFlex(phone, orderUrl) {
  return {
    type: 'flex',
    altText: '綁定成功通知',
    contents: createBaseBubble('綁定成功 🎉', [
      {
        type: 'text',
        text: phone ? `手機 ${phone}` : '您的帳號',
        size: 'md',
        color: THEME.colors.text,
        align: 'center',
        weight: 'bold'
      },
      {
        type: 'text',
        text: '已成功連結會員資料。您現在可以使用下方選單查詢各項服務。',
        wrap: true,
        size: 'sm',
        color: THEME.colors.subText,
        margin: 'md',
        align: 'center'
      },
      {
        type: 'separator',
        margin: 'lg',
        color: '#E5E7EB'
      },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'lg',
        spacing: 'md',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            color: THEME.colors.primary,
            action: { type: 'message', label: '📦 查訂單', text: '查訂單' },
            height: 'sm'
          },
          {
            type: 'button',
            style: 'secondary',
            color: THEME.colors.primary,
            action: { type: 'message', label: '💎 會員等級', text: '會員等級' },
            height: 'sm'
          }
        ]
      }
    ], [
      {
        type: 'button',
        style: 'link',
        color: THEME.colors.gold,
        action: { type: 'uri', label: '前往選購茶品 →', uri: orderUrl }
      }
    ])
  };
}

// ==========================================================
// 3. 會員等級卡
// ==========================================================
export function buildMemberTierFlex(member) {
  const name = member.name || '貴賓';
  const spend = Number(member.totals_sum || 0);
  const tierName = computeTierBySum(spend);
  const rules = getTierRules_();
  const { tierIndex, nextThreshold } = resolveTierFromSpend_(spend, rules);
  
  // 進度條邏輯
  const mkSeg = (active) => ({
    type: 'box', layout: 'vertical', height: '4px', flex: 1, cornerRadius: '2px',
    backgroundColor: active ? THEME.colors.gold : '#E5E7EB',
    margin: 'xs'
  });
  const bars = rules.map((_, i) => mkSeg(i <= tierIndex));

  const nextText = Number.isFinite(nextThreshold)
    ? `距離下一級還差 $${(nextThreshold - spend).toLocaleString('zh-TW')}`
    : '已達最高等級榮耀';

  return {
    type: 'flex',
    altText: `會員等級：${tierName}`,
    contents: createBaseBubble('會員等級', [
      {
        type: 'box', layout: 'vertical', alignItems: 'center',
        contents: [
          { type: 'text', text: tierName, size: '3xl', weight: 'bold', color: THEME.colors.gold },
          { type: 'text', text: `${name} 您好`, size: 'sm', color: THEME.colors.subText, margin: 'sm' }
        ]
      },
      {
        type: 'box', layout: 'vertical', margin: 'xl', backgroundColor: '#FFFFFF', cornerRadius: '8px', paddingAll: '12px',
        borderColor: '#E5E7EB', borderWidth: '1px',
        contents: [
          { type: 'text', text: '累積消費金額', size: 'xs', color: '#9CA3AF', align: 'center' },
          { type: 'text', text: `$${spend.toLocaleString('zh-TW')}`, size: 'xl', weight: 'bold', color: THEME.colors.text, align: 'center', margin: 'sm' }
        ]
      },
      {
        type: 'box', layout: 'vertical', margin: 'lg',
        contents: [
          { type: 'box', layout: 'horizontal', contents: bars },
          { type: 'text', text: nextText, size: 'xs', color: THEME.colors.gold, align: 'center', margin: 'md' }
        ]
      }
    ])
  };
}

// ==========================================================
// 4. 訂單摘要卡
// ==========================================================
export function buildOrderFlex(order) {
  const statusColor = {
    '處理中': '#C0A67B',
    '出貨中': THEME.colors.gold,
    '已完成': THEME.colors.primary
  }[order.status] || '#9CA3AF';

  return {
    type: 'flex',
    altText: '訂單狀態更新',
    contents: createBaseBubble('訂單摘要', [
      {
        type: 'box', layout: 'horizontal', justifyContent: 'space-between',
        contents: [
          { type: 'text', text: '訂購日期', size: 'xs', color: '#9CA3AF' },
          { type: 'text', text: order.dateText || '-', size: 'xs', color: THEME.colors.text, weight: 'bold' }
        ]
      },
      {
        type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md',
        contents: [
          { type: 'text', text: '訂單狀態', size: 'xs', color: '#9CA3AF' },
          { type: 'text', text: order.status, size: 'sm', color: statusColor, weight: 'bold' }
        ]
      },
      { type: 'separator', margin: 'lg', color: '#E5E7EB' },
      {
        type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
        contents: (order.summary || '').split('\n').map(item => ({
          type: 'text', text: item, size: 'sm', color: THEME.colors.text, wrap: true
        }))
      },
      { type: 'separator', margin: 'lg', color: '#E5E7EB' },
      {
        type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'lg',
        contents: [
          { type: 'text', text: '總金額', size: 'sm', color: THEME.colors.subText },
          { type: 'text', text: `$${Number(order.totalNum || 0).toLocaleString('zh-TW')}`, size: 'xl', weight: 'bold', color: THEME.colors.gold }
        ]
      }
    ])
  };
}

// ==========================================================
// 5. 🎁 升等贈禮通知卡 (New!)
// ==========================================================
export function buildGiftNotificationFlex(memberName, tier, gift) {
  return {
    type: 'flex',
    altText: '🎉 恭喜升等！獲得專屬好禮',
    contents: createBaseBubble('🎉 恭喜升等', [
      {
        type: 'text',
        text: `親愛的 ${memberName}，恭喜您升等為`,
        size: 'sm',
        color: THEME.colors.text,
        align: 'center',
        wrap: true
      },
      {
        type: 'text',
        text: `【${tier}】`,
        size: 'xl',
        weight: 'bold',
        color: THEME.colors.gold,
        align: 'center',
        margin: 'sm'
      },
      {
        type: 'box',
        layout: 'vertical',
        margin: 'xl',
        backgroundColor: '#FFF9EF', // 淡金背景
        cornerRadius: '12px',
        paddingAll: '16px',
        borderWidth: '1px',
        borderColor: '#FDE68A',
        contents: [
          { type: 'text', text: '獲得升等禮', size: 'xs', color: '#B45309', align: 'center', weight: 'bold' },
          { type: 'text', text: gift, size: 'lg', color: '#B45309', align: 'center', weight: 'bold', margin: 'sm' },
          { type: 'text', text: '我們將隨下一筆訂單或盡快為您寄出', size: 'xxs', color: '#D97706', align: 'center', margin: 'md', wrap: true }
        ]
      }
    ], [
      {
        type: 'text',
        text: '若需變更收件資料，請於 24 小時內回覆客服',
        size: 'xs',
        color: '#9CA3AF',
        align: 'center'
      }
    ])
  };
}

// --- Helper Functions ---
function getTierRules_() {
  return [
    { name: '一般', threshold: 0 },
    { name: '銀卡', threshold: 3000 },
    { name: '金卡', threshold: 8000 },
    { name: '白金', threshold: 15000 },
    { name: '黑鑽', threshold: 30000 },
  ];
}

function resolveTierFromSpend_(spend, rules) {
  let tierIndex = 0;
  for (let i = 0; i < rules.length; i++) {
    if (spend >= rules[i].threshold) tierIndex = i;
  }
  const nextThreshold = rules[tierIndex + 1] ? rules[tierIndex + 1].threshold : Infinity;
  return { tierIndex, nextThreshold };
}