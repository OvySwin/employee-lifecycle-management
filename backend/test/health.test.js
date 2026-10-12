import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
describe('health and readiness', () => {
  it('keeps liveness independent of database', async () => {
    const app = createApp(() => { throw new Error('private-secret'); });
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
  it('reports a successful database query', async () => {
    const response = await request(createApp(async () => {})).get('/ready');
    expect(response.status).toBe(200);
    expect(response.body.database).toBe('connected');
  });
  it('reports database failure without exposing credentials', async () => {
    const response = await request(createApp(async () => { throw new Error('private-secret'); })).get('/ready');
    expect(response.status).toBe(503);
    expect(response.text).not.toContain('private-secret');
  });
});

