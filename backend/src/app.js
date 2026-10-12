import express from 'express';
import { authRoutes } from './auth.js';
export function createApp(checkDatabase, database, authOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try { await checkDatabase(); res.json({ status: 'ready', database: 'connected' }); }
    catch { res.status(503).json({ status: 'not_ready', database: 'unavailable' }); }
  });
  if (database) app.use('/api', authRoutes(database,authOptions));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error,_req,res,_next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error:'Invalid JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error:'Request too large' });
    res.status(500).json({ error:'Request failed' });
  });
  return app;
}

