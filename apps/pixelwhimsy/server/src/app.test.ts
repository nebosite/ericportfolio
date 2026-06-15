import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createApp, initDb } from './app';

function freshApp() {
  const db = new Database(':memory:');
  initDb(db);
  return createApp(db);
}

describe('GET /api/health', () => {
  it('reports ok with the app name and a timestamp', async () => {
    const res = await request(freshApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', app: 'pixelwhimsy' });
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('feedback wiring', () => {
  it('submits, lists, and upvotes feedback for the pixelwhimsy entity', async () => {
    const app = freshApp();
    const created = await request(app)
      .post('/api/feedback')
      .send({ entity: 'pixelwhimsy', text: 'more crayon colors please' });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/feedback/random?entity=pixelwhimsy');
    expect(list.body).toHaveLength(1);

    const vote = await request(app).post(`/api/feedback/${created.body.id}/vote`);
    expect(vote.body).toEqual({ id: created.body.id, votes: 1 });
  });
});
