import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';

describe('GET /api/health', () => {
  it('reports ok with the app name and a timestamp', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', app: 'pixelwhimsy' });
    expect(typeof res.body.timestamp).toBe('string');
  });
});
