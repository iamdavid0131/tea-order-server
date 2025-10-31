// lib/sheets.js
import { google } from 'googleapis';
import { GoogleSpreadsheet } from 'google-spreadsheet';

const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
const SHEET_ID = process.env.SHEET_ID;

/* =======================================================
 ✅ for Batch Reads: Google Sheets REST API
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
 ✅ for CRUD: google-spreadsheet (v4+)
 新版 **不支援 useServiceAccountAuth**
 ======================================================= */
export async function getDoc() {
  if (!SHEET_ID) throw new Error('❌ SHEET_ID 未設定於環境變數');

  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);

    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    await doc.useOAuth2Client(auth); // ✅ v4+ 正確寫法
    await doc.loadInfo();

    console.log('✅ GoogleSpreadsheet Document loaded');
    return doc;

  } catch (err) {
    console.error('❌ getDoc() failed:', err);
    throw new Error('GoogleSpreadsheet 授權失敗');
  }
}
