// lib/sheets.js
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { google } from 'googleapis';

const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const SPREADSHEET_ID = process.env.SHEET_ID;

// ✅ Global doc cache (避免每次都 loadInfo)
let cachedDoc = null;

/**
 * 取得 GoogleSpreadsheet Doc 實例
 */
export async function getDoc() {
  if (cachedDoc) return cachedDoc;

  if (!SPREADSHEET_ID) {
    throw new Error('❌ SHEET_ID 未設定於環境變數');
  }

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  console.log('📄 Google Sheet Loaded:', doc.title);
  cachedDoc = doc;
  return doc;
}

/**
 * Google Sheets API v4 用於批次讀取 (如 Products、Stock)
 */
export async function getSheetsClient() {
  try {
    const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
    const cleanKey = rawKey
      .replace(/^"|"$/g, '')
      .replace(/\\n/g, '\n');

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
    console.error('❌ getSheetsClient Error:', error);
    throw error;
  }
}
