import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createApp, initDb } from './app';

function fresh() {
  const db = new Database(':memory:');
  initDb(db);
  return { db, app: createApp(db) };
}

describe('POST /api/feedback', () => {
  it('accepts up to 1000 characters and returns the new item', async () => {
    const { app } = fresh();
    const res = await request(app)
      .post('/api/feedback')
      .send({ entity: 'snake', text: 'love the big field' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ entity: 'snake', text: 'love the big field', votes: 0 });
    expect(res.body.id).toBeTypeOf('number');
  });

  it('trims the text and allows exactly 1000 chars but not 1001', async () => {
    const { app } = fresh();
    const trimmed = await request(app)
      .post('/api/feedback')
      .send({ entity: 'snake', text: '  spaced  ' });
    expect(trimmed.body.text).toBe('spaced');

    expect(
      (await request(app).post('/api/feedback').send({ entity: 'snake', text: 'x'.repeat(1000) }))
        .status,
    ).toBe(201);
    expect(
      (await request(app).post('/api/feedback').send({ entity: 'snake', text: 'x'.repeat(1001) }))
        .status,
    ).toBe(400);
  });

  it('rejects empty text and a bad entity slug', async () => {
    const { app } = fresh();
    expect((await request(app).post('/api/feedback').send({ entity: 'snake', text: '' })).status).toBe(400);
    expect((await request(app).post('/api/feedback').send({ entity: 'snake', text: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/feedback').send({ entity: 'Snake!', text: 'hi' })).status).toBe(400);
    expect((await request(app).post('/api/feedback').send({ entity: '', text: 'hi' })).status).toBe(400);
  });
});

describe('GET /api/feedback/random', () => {
  it('returns at most three active items for the entity', async () => {
    const { app } = fresh();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/feedback').send({ entity: 'snake', text: `idea ${i}` });
    }
    const res = await request(app).get('/api/feedback/random?entity=snake');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    for (const item of res.body) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('text');
      expect(item).toHaveProperty('votes');
    }
  });

  it('never returns another entity\'s feedback', async () => {
    const { app } = fresh();
    await request(app).post('/api/feedback').send({ entity: 'snake', text: 'snake one' });
    await request(app).post('/api/feedback').send({ entity: 'big-pac-tiny-man', text: 'pac one' });
    const res = await request(app).get('/api/feedback/random?entity=snake');
    expect(res.body.map((r: { text: string }) => r.text)).toEqual(['snake one']);
  });

  it('excludes inactive items', async () => {
    const { app, db } = fresh();
    await request(app).post('/api/feedback').send({ entity: 'snake', text: 'visible' });
    const hidden = await request(app).post('/api/feedback').send({ entity: 'snake', text: 'hidden' });
    db.prepare('UPDATE feedback SET active = 0 WHERE id = ?').run(hidden.body.id);
    const res = await request(app).get('/api/feedback/random?entity=snake');
    expect(res.body.map((r: { text: string }) => r.text)).toEqual(['visible']);
  });

  it('returns an empty list when there is nothing and 400 for a bad entity', async () => {
    const { app } = fresh();
    expect((await request(app).get('/api/feedback/random?entity=snake')).body).toEqual([]);
    expect((await request(app).get('/api/feedback/random?entity=BAD!')).status).toBe(400);
  });
});

describe('POST /api/feedback/:id/vote', () => {
  it('increments the vote count', async () => {
    const { app } = fresh();
    const created = await request(app).post('/api/feedback').send({ entity: 'snake', text: 'good' });
    const id = created.body.id;
    const first = await request(app).post(`/api/feedback/${id}/vote`);
    const second = await request(app).post(`/api/feedback/${id}/vote`);
    expect(first.body).toEqual({ id, votes: 1 });
    expect(second.body).toEqual({ id, votes: 2 });
  });

  it('404s for an unknown id and 400 for a non-numeric id', async () => {
    const { app } = fresh();
    expect((await request(app).post('/api/feedback/999/vote')).status).toBe(404);
    expect((await request(app).post('/api/feedback/abc/vote')).status).toBe(400);
  });
});
