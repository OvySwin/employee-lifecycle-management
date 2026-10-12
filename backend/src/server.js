import pg from 'pg';
import { createApp } from './app.js';
const pool = new pg.Pool({ connectionTimeoutMillis: 2000, max: 5 });
pool.on('error', () => console.error('Database connection error'));
const app = createApp(() => pool.query('SELECT 1'));
const server = app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Development API started'));
async function shutdown() { server.close(async () => { await pool.end(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

