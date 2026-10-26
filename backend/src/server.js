import pg from 'pg';
import { createApp } from './app.js';
import { processNotificationBatch } from './notification-worker.js';
const pool = new pg.Pool({ connectionTimeoutMillis: 2000, max: 5 });
pool.on('error', () => console.error('Database connection error'));
const secure = process.env.NODE_ENV === 'production';
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
if (secure && !origin.startsWith('https://')) throw new Error('Production requires APP_ORIGIN with HTTPS');
const app = createApp(() => pool.query('SELECT 1'), pool, { origin,secure });
const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('API started'));
const notificationTimer = setInterval(()=>{
  processNotificationBatch(pool).catch(()=>console.error('Notification delivery batch failed'));
},60000);
notificationTimer.unref();
async function shutdown() {
  clearInterval(notificationTimer);
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

