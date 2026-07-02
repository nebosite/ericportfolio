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
  it('reports ok with the app name', async () => {
    const res = await request(freshApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', app: 'bigtinygames' });
  });
});

describe('leaderboard', () => {
  it('starts empty', async () => {
    const res = await request(freshApp()).get('/api/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('accepts a valid score and upper-cases the initials', async () => {
    const app = freshApp();
    const post = await request(app).post('/api/leaderboard').send({ initials: 'ab', score: 120 });
    expect(post.status).toBe(201);
    expect(post.body).toMatchObject({ initials: 'AB', score: 120 });
  });

  it('orders by score descending', async () => {
    const app = freshApp();
    await request(app).post('/api/leaderboard').send({ initials: 'LO', score: 10 });
    await request(app).post('/api/leaderboard').send({ initials: 'HI', score: 999 });
    await request(app).post('/api/leaderboard').send({ initials: 'MD', score: 500 });
    const list = await request(app).get('/api/leaderboard');
    expect(list.body.map((r: { initials: string }) => r.initials)).toEqual(['HI', 'MD', 'LO']);
  });

  it('rejects bad initials', async () => {
    const app = freshApp();
    expect((await request(app).post('/api/leaderboard').send({ initials: '', score: 1 })).status).toBe(400);
    expect(
      (await request(app).post('/api/leaderboard').send({ initials: 'TOOLONG', score: 1 })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/leaderboard').send({ initials: 'a b', score: 1 })).status,
    ).toBe(400);
  });

  it('rejects non-integer, negative, or absurd scores', async () => {
    const app = freshApp();
    expect((await request(app).post('/api/leaderboard').send({ initials: 'AB', score: -1 })).status).toBe(400);
    expect(
      (await request(app).post('/api/leaderboard').send({ initials: 'AB', score: 1.5 })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/leaderboard').send({ initials: 'AB', score: 100_000_001 })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/leaderboard').send({ initials: 'AB', score: 'lots' })).status,
    ).toBe(400);
  });

  it('keeps each game’s scores separate', async () => {
    const app = freshApp();
    await request(app).post('/api/leaderboard').send({ initials: 'SNK', score: 50 }); // default: snake
    await request(app)
      .post('/api/leaderboard')
      .send({ initials: 'PAC', score: 900, game: 'big-pac-tiny-man' });

    const snake = await request(app).get('/api/leaderboard'); // defaults to snake
    expect(snake.body.map((r: { initials: string }) => r.initials)).toEqual(['SNK']);

    const pac = await request(app).get('/api/leaderboard').query({ game: 'big-pac-tiny-man' });
    expect(pac.body.map((r: { initials: string }) => r.initials)).toEqual(['PAC']);
  });

  it('rejects an invalid game slug', async () => {
    const app = freshApp();
    expect(
      (await request(app).post('/api/leaderboard').send({ initials: 'AB', score: 1, game: 'Bad Game!' }))
        .status,
    ).toBe(400);
  });
});
