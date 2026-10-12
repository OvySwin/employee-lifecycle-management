import express from 'express';
export function createApp(checkDatabase) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try { await checkDatabase(); res.json({ status: 'ready', database: 'connected' }); }
    catch { res.status(503).json({ status: 'not_ready', database: 'unavailable' }); }
  });
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

