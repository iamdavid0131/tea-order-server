/* --------------------------
   ✅ 初始化 Google Sheet (新版 SDK)
--------------------------- */
async function getDoc() {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);

    // 🧩 改成新版授權格式，只傳 client_email + private_key
    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n'),
    });

    await doc.loadInfo();
    console.log("✅ 已成功連線到 Google Sheet:", SHEET_ID);
    return doc;
  } catch (err) {
    console.error("❌ Google Sheet 初始化失敗:", err);
    throw new Error("Google Sheet 授權或載入失敗");
  }
}
