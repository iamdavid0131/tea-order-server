// lib/sheets.js
import { google } from 'googleapis';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
const SHEET_ID = process.env.SHEET_ID;

/* --------------------------
   ✅ 建立 Google Sheets API 用戶端
--------------------------- */
export async function getSheetsClient() {
  try {
    const jwt = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth: jwt });
    console.log('✅ 已成功建立 Sheets Client');
    return sheets;
  } catch (err) {
    console.error('❌ 建立 Sheets Client 失敗:', err);
    throw new Error('Google Sheets 授權初始化失敗');
  }
}
