// lib/sheets.js
import { google } from 'googleapis';
import { GoogleSpreadsheet } from 'google-spreadsheet';

const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
const SHEET_ID = process.env.SHEET_ID;

/* =======================================================
   ✅ 用於批量讀取：Google Sheets REST API
   供 routes/config.js 使用
   ======================================================= */
export async function getSheetsClient() {
  try {
    const jwt = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth: jwt });
    console.log('✅ Sheets REST Client Ready');
    return sheets;
  } catch (err) {
    console.error('❌ 建立 Sheets REST Client 失敗:', err);
    throw new Error('Google Sheets 授權初始化失敗');
  }
}

/* =======================================================
   ✅ 用於 CRUD：google-spreadsheet
   供 Member / Orders 模組使用
   ======================================================= */
export async function getDoc() {
  if (!SHEET_ID) throw new Error('❌ SHEET_ID 未設定於環境變數');

  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n'),
    });

    await doc.loadInfo();
    console.log('✅ GoogleSpreadsheet Document loaded');
    return doc;

  } catch (err) {
    console.error('❌ getDoc() failed:', err);
    throw new Error('GoogleSpreadsheet 授權失敗');
  }
}
