// 共用工具函數

// 產生訂單編號
function genOrderId() {
  const now = new Date();
  return `T${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 900 + 100)}`;
}

// 計算運費
function calcShipping(total, method) {
  const FREE_SHIPPING_THRESHOLD = Number(process.env.FREE_SHIPPING_THRESHOLD || 1000);
  const BASE_SHIPPING_FEE = Number(process.env.BASE_SHIPPING_FEE || 60);
  const COD_FEE = Number(process.env.COD_SHIP_FEE || 100);
  const COD_FREE_THRESHOLD = Number(process.env.COD_FREE_SHIPPING_THRESHOLD || 2000);

  let shipFee = 0;
  if (method === 'store') {
    shipFee = total >= FREE_SHIPPING_THRESHOLD ? 0 : BASE_SHIPPING_FEE;
  } else if (method === 'cod') {
    shipFee = total >= COD_FREE_THRESHOLD ? 0 : BASE_SHIPPING_FEE + COD_FEE;
  }
  return shipFee;
}

// 手機號正規化（台灣格式）
function normalizePhoneTW(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/[^\d]/g, '');
  if (p.startsWith('886')) p = '0' + p.slice(3);
  return p;
}

// 依累積金額計算會員等級
function computeTierBySum(sum) {
  sum = Number(sum) || 0;
  if (sum >= 30000) return '黑鑽';
  if (sum >= 15000) return '白金';
  if (sum >= 8000) return '金卡';
  if (sum >= 3000) return '銀卡';
  return '';
}

function sanitizeItemName(name) {
  return name
    .replace(/[^\w\s#-]/g, "")  // 移除無效字元（emoji、符號）
    .replace(/\s+/g, "_")       // 空白轉底線
    .substring(0, 50);          // 長度限制
}


// ✅ 一次輸出所有工具函數
export { genOrderId, calcShipping, normalizePhoneTW, computeTierBySum, sanitizeItemName };
