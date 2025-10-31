import { GoogleSpreadsheet } from 'google-spreadsheet';
import { google } from 'googleapis';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

const SHEET_ID = process.env.GOOGLE_SHEETS_SHEET_ID;

// 初始化 Google Sheets
async function getDoc() {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  return doc;
}

// 取得會員資料（可自動綁定）
async function getMemberByLineId(userId, phone = '', autoBind = false) {
  const doc = await getDoc();
  const sh = doc.sheetsByTitle['Members'];
  const rows = await sh.getRows();

  let member = rows.find(r => r.lineUserId === userId);
  if (!member && phone) member = rows.find(r => r.phone === phone);

  if (member && autoBind && !member.lineUserId) {
    member.lineUserId = userId;
    member.save();
    return { ok: true, message: `✅ 成功綁定 ${member.phone}` };
  }

  if (!member && autoBind) {
    await sh.addRow({
      member_id: 'M' + Date.now(),
      phone,
      lineUserId: userId,
      created_at: new Date().toISOString(),
    });
    return { ok: true, message: `✅ 已建立新會員並綁定 ${phone}` };
  }

  return member || null;
}

// 查詢最近一筆訂單
async function getRecentOrderByPhone(phone) {
  const doc = await getDoc();
  const sh = doc.sheetsByTitle['Orders'];
  const rows = await sh.getRows();

  const filtered = rows
    .filter(r => r.BuyerPhone?.replace(/^'/, '') === phone)
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

  if (!filtered.length) return null;

  const o = filtered[0];
  const items = Object.keys(o)
    .filter(k => k.endsWith('_數量') && Number(o[k]) > 0)
    .map(k => `${k.replace(/_數量$/, '')} x${o[k]}`)
    .join('\n');

  return {
    date: o.Timestamp,
    total: Number(o.Total || 0),
    status: o.Status || '處理中',
    summary: items,
  };
}

// 取得 Google Sheets API 客戶端
async function getSheetsClient() {
  try {
    if (!process.env.GOOGLE_CLIENT_EMAIL) {
      throw new Error('GOOGLE_CLIENT_EMAIL is not set in environment variables');
    }
    if (!process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('GOOGLE_PRIVATE_KEY is not set in environment variables');
    }
    if (!process.env.SHEET_ID) {
      throw new Error('SHEET_ID is not set in environment variables');
    }

    const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
    const cleanKey = rawKey
      .replace(/^"|"$/g, '') // 去掉開頭結尾引號
      .replace(/\\n/g, '\n'); // 還原換行

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: cleanKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
  } catch (error) {
    console.error('Error in getSheetsClient:', error.message);
    if (error.message.includes('invalid_grant')) {
      console.error('Authentication failed. Please check your service account credentials and ensure they are valid.');
    } else if (error.message.includes('no such file or directory')) {
      console.error('Service account key file not found. Please check the path to your service account key file.');
    } else if (error.message.includes('invalid_scope')) {
      console.error('Invalid OAuth2 scope. Make sure the required scopes are enabled in the Google Cloud Console.');
    }
    throw error; // Re-throw the error to be handled by the caller
  }
}

export { getMemberByLineId, getRecentOrderByPhone, getSheetsClient, getDoc };
