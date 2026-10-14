import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthFixtureModule } from './fixtures/auth-fixture.module.js';
import { signInAs, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const forbidden = {
  data: null,
  error: { code: 'FORBIDDEN', message: 'You are not allowed to do this.', details: {} },
};

describe('Role-based access and ownership (fixture routes)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp([AuthFixtureModule]);
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, cookie?: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Cookie', cookie ?? '');

  describe('role-gated areas', () => {
    it.each([
      ['user', '/__fixture/editor-area', 403],
      ['user', '/__fixture/admin-area', 403],
      ['editor', '/__fixture/editor-area', 200],
      ['editor', '/__fixture/admin-area', 403],
      ['admin', '/__fixture/editor-area', 200],
      ['admin', '/__fixture/admin-area', 200],
    ] as const)('%s → %s → %i', async (role, path, status) => {
      const { cookie } = await signInAs(app, { role });
      const res = await get(path, cookie);
      expect(res.status).toBe(status);
      if (status === 403) expect(res.body).toEqual(forbidden);
    });

    it('no session → 401, not 403', async () => {
      const res = await get('/__fixture/editor-area');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('author-owned resources', () => {
    const create = async (cookie: string) => {
      const res = await request(app.getHttpServer())
        .post('/__fixture/posts')
        .set(XHR)
        .set('Cookie', cookie)
        .send({ title: 'Draft' });
      return res;
    };

    const actions = (id: string) =>
      [
        [
          'edit',
          (c: string) =>
            request(app.getHttpServer())
              .patch(`/__fixture/posts/${id}`)
              .set(XHR)
              .set('Cookie', c)
              .send({ title: 'New' }),
        ],
        [
          'publish',
          (c: string) =>
            request(app.getHttpServer())
              .post(`/__fixture/posts/${id}/publish`)
              .set(XHR)
              .set('Cookie', c),
        ],
        [
          'unpublish',
          (c: string) =>
            request(app.getHttpServer())
              .post(`/__fixture/posts/${id}/unpublish`)
              .set(XHR)
              .set('Cookie', c),
        ],
        [
          'delete',
          (c: string) =>
            request(app.getHttpServer()).delete(`/__fixture/posts/${id}`).set(XHR).set('Cookie', c),
        ],
      ] as const;

    it('an editor creates a post and becomes its author', async () => {
      const editor = await signInAs(app, { role: 'editor' });
      const res = await create(editor.cookie);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ authorId: editor.user.id, published: false });
    });

    it('a user cannot create a post', async () => {
      const user = await signInAs(app, { role: 'user' });
      const res = await create(user.cookie);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(forbidden);
    });

    it('an editor edits, publishes, unpublishes and deletes their own post', async () => {
      const editor = await signInAs(app, { role: 'editor' });
      const id = (await create(editor.cookie)).body.data.id as string;
      for (const [name, act] of actions(id)) {
        const res = await act(editor.cookie);
        expect([name, res.status]).toEqual([name, name === 'delete' ? 204 : 200]);
      }
    });

    it("an editor cannot edit, publish, unpublish or delete another editor's post", async () => {
      const author = await signInAs(app, { role: 'editor' });
      const other = await signInAs(app, { role: 'editor' });
      const id = (await create(author.cookie)).body.data.id as string;
      for (const [name, act] of actions(id)) {
        const res = await act(other.cookie);
        expect([name, res.status, res.body]).toEqual([name, 403, forbidden]);
      }
    });

    it("an admin manages any editor's post", async () => {
      const author = await signInAs(app, { role: 'editor' });
      const admin = await signInAs(app, { role: 'admin' });
      const id = (await create(author.cookie)).body.data.id as string;
      for (const [name, act] of actions(id)) {
        const res = await act(admin.cookie);
        expect([name, res.status]).toEqual([name, name === 'delete' ? 204 : 200]);
      }
    });

    it("a user cannot touch anyone's post", async () => {
      const author = await signInAs(app, { role: 'editor' });
      const user = await signInAs(app, { role: 'user' });
      const id = (await create(author.cookie)).body.data.id as string;
      for (const [name, act] of actions(id)) {
        const res = await act(user.cookie);
        expect([name, res.status]).toEqual([name, 403]);
      }
    });
  });
});
