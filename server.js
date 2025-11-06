// ===============================
// ☕ TeaOrder Server
// ===============================
import 'dotenv/config.js';
import express from 'express';
import cors from 'cors';

// === Routes ===
import configRouter from './routes/config.js';
import orderRouter from './routes/order.js';
import previewRouter from './routes/preview.js';
import storesRouter from './routes/stores.js';
import promoRouter from './routes/promo.js';
import lineRouter from './routes/line.js';
import memberRouter from './routes/member.js';
import lineLoginRouter from './routes/line-login.js';
import cleanupCouponsRouter from './routes/cleanupCoupons.js';

const app = express();

// === Middleware ===
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// === Routes ===
app.use('/api/config', configRouter);
app.use('/api/order', orderRouter);
app.use('/api/preview', previewRouter);
app.use('/api/stores', storesRouter);
app.use('/api/promo', promoRouter);
app.use('/api/line', lineRouter);
app.use('/api/member', memberRouter);
app.use('/api/line-login', lineLoginRouter);
app.use('/api/cleanup-coupons', cleanupCouponsRouter);


// === Root route ===
app.get('/', (_, res) => {
  const apiEndpoints = [
    { path: '/', method: 'GET', description: 'API documentation' },
    { path: '/api/health', method: 'GET', description: 'Health check endpoint' },
    { path: '/api/config', method: 'GET', description: 'Get server configuration' },
    { path: '/api/order', method: 'POST', description: 'Create a new order' },
    { path: '/api/preview', method: 'POST', description: 'Preview order details' },
    { path: '/api/stores', method: 'GET', description: 'Get store information' },
    { path: '/api/promo', method: 'GET,POST', description: 'Promotion management' },
    { path: '/api/line', method: 'POST', description: 'LINE webhook handler' },
    { path: '/api/member', method: 'GET,POST', description: 'Member management' },
    { path: '/api/line-login', method: 'GET,POST', description: 'LINE Login integration' },
    { path: '/api/cleanup-coupons', method: 'POST', description: 'Cleanup expired coupons' }
  ];

  res.json({
    message: '☕ 祥興茶行訂單後端服務已啟動',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: apiEndpoints,
    documentation: '請參考各端點文件以獲取詳細資訊'
  });
});

// === Health check (for Worker proxy) ===
app.get('/api/health', (_, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// === Start server ===
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 TeaOrder Server running on http://localhost:${port}`);
});
