// lib/lineFlex.js
// --------------------------------------
// LINE Flex 訊息模板
// 將原 GAS Flex 卡結構轉為 Node.js 可用
// --------------------------------------

import { computeTierBySum } from './utils.js';

// === 會員等級卡 ===
function buildMemberTierFlex(member) {
  const name = member.name || '會員';
  const spend = Number(member.totals_sum || 0);
  const tierName = computeTierBySum(spend);
  const rules = getTierRules_();
  const { tierIndex, nextThreshold } = resolveTierFromSpend_(spend, rules);
  const style = rules[tierIndex].style;
  const hasNext = Number.isFinite(nextThreshold);
  const needMore = hasNext ? Math.max(0, nextThreshold - spend) : 0;
  const nextText = hasNext
    ? `距離「${rules[tierIndex + 1].name}」還差：$${needMore.toLocaleString('zh-TW')}`
    : '已達最高等級 🎉';

  const mkSeg = (active, first) => ({
    type: 'box',
    layout: 'vertical',
    height: '6px',
    flex: 1,
    backgroundColor: active ? style.brand : style.accent,
    cornerRadius: '3px',
    margin: first ? undefined : 'sm',
    contents: [{ type: 'filler' }],
  });
  const bars = rules.map((_, i) => mkSeg(i <= tierIndex, i === 0));

  const bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: style.bg,
      paddingAll: '18px',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          justifyContent: 'space-between',
          contents: [
            { type: 'text', text: '會員等級', size: 'lg', weight: 'bold', color: style.brand },
            { type: 'text', text: `${style.badge} ${tierName}`, size: 'md', weight: 'bold', color: style.brand },
          ],
        },
        { type: 'text', text: `${name} 貴賓您好`, size: 'sm', color: style.sub, margin: 'xs' },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          contents: [
            { type: 'text', text: '累積消費', size: 'sm', color: style.sub },
            { type: 'text', text: `$${spend.toLocaleString('zh-TW')}`, size: 'xl', weight: 'bold', color: style.brand },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          contents: [
            { type: 'text', text: '等級進度', size: 'sm', color: style.sub },
            { type: 'box', layout: 'horizontal', margin: 'sm', contents: bars },
            { type: 'text', text: nextText, size: 'xs', color: style.brand, align: 'end', margin: 'xs', wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '等級門檻', size: 'sm', color: style.sub },
            ...rules.map((r, i) => ({
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: r.name,
                  size: 'sm',
                  color: i <= tierIndex ? style.brand : '#6b7280',
                  weight: i <= tierIndex ? 'bold' : 'regular',
                  flex: 3,
                },
                {
                  type: 'text',
                  text: `$${r.threshold.toLocaleString('zh-TW')}`,
                  size: 'sm',
                  color: '#6b7280',
                  align: 'end',
                  flex: 5,
                },
              ],
            })),
          ],
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `會員等級：${tierName}`,
    contents: bubble,
  };
}

// === 訂單摘要卡 ===
function buildOrderFlex(order) {
  const brand = '#5C4832';
  const sub = '#8D7B69';
  const bg = '#FAF8F5';
  const light = '#E6E0D6';
  const status = order.status || '處理中';
  const progressMap = {
    處理中: { step: 1, color: '#C0A67B', label: '處理中' },
    出貨中: { step: 2, color: '#B38740', label: '出貨中' },
    已完成: { step: 3, color: '#7A5C2E', label: '已完成' },
  };
  const p = progressMap[status] || progressMap['處理中'];
  const mkSeg = (active, first) => ({
    type: 'box',
    layout: 'vertical',
    height: '6px',
    flex: 1,
    backgroundColor: active ? p.color : light,
    cornerRadius: '3px',
    margin: first ? undefined : 'sm',
    contents: [{ type: 'filler' }],
  });
  const bars = [mkSeg(p.step >= 1, true), mkSeg(p.step >= 2, false), mkSeg(p.step >= 3, false)];
  const buyer = order.buyerName || '親愛的顧客';
  const dt = order.dateText || '';
  const summary = order.summary || '（無品項資料）';
  const money = `$${Number(order.totalNum || 0).toLocaleString('zh-TW')}`;
  const stTxt = p.label;

  const bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: bg,
      paddingAll: '18px',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: brand,
          cornerRadius: '12px',
          paddingAll: '12px',
          contents: [
            { type: 'text', text: '訂單摘要', weight: 'bold', size: 'lg', color: '#FFFFFF' },
            { type: 'text', text: `${buyer} 貴賓您好`, size: 'sm', color: '#F5EFE6', margin: 'xs' },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          contents: [
            { type: 'text', text: '訂購日期', size: 'sm', color: sub },
            { type: 'text', text: dt, size: 'md', weight: 'bold', color: '#2B2B2B', wrap: true, margin: 'xs' },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          contents: [
            { type: 'text', text: '訂單狀態', size: 'sm', color: sub },
            { type: 'box', layout: 'horizontal', margin: 'sm', contents: bars },
            { type: 'text', text: stTxt, align: 'end', size: 'xs', color: brand, margin: 'xs' },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          margin: 'md',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: '品項：', size: 'sm', color: sub, margin: 'none' },
                ...summary.split('\n').map((line) => ({
                  type: 'text',
                  text: line,
                  size: 'sm',
                  color: '#2B2B2B',
                  wrap: true,
                  margin: 'xs',
                })),
              ],
            },
            {
              type: 'box',
              layout: 'baseline',
              contents: [
                { type: 'text', text: '金額：', flex: 2, size: 'sm', color: sub },
                { type: 'text', text: money, flex: 6, size: 'sm', color: brand, weight: 'bold' },
              ],
            },
          ],
        },
      ],
    },
    styles: { body: { backgroundColor: bg } },
  };

  return { type: 'flex', altText: '查訂單結果', contents: bubble };
}

// === 等級門檻設定 ===
function getTierRules_() {
  return [
    { name: '一般', threshold: 0, style: { brand: '#5C4832', sub: '#8D7B69', bg: '#FAF8F5', accent: '#C0A67B', badge: '🥉' } },
    { name: '銀卡', threshold: 3000, style: { brand: '#6B7280', sub: '#9CA3AF', bg: '#F8FAFC', accent: '#C7CDD6', badge: '🥈' } },
    { name: '金卡', threshold: 8000, style: { brand: '#B38740', sub: '#C6A56A', bg: '#FFF9EF', accent: '#E3C88B', badge: '🥇' } },
    { name: '白金', threshold: 15000, style: { brand: '#64748B', sub: '#94A3B8', bg: '#F1F5F9', accent: '#C8D3E0', badge: '🏆' } },
    { name: '黑鑽', threshold: 30000, style: { brand: '#111827', sub: '#6B7280', bg: '#F3F4F6', accent: '#9CA3AF', badge: '💎' } },
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

export { buildMemberTierFlex, buildOrderFlex };
