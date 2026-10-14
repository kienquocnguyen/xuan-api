import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { ServiceOffering } from '../src/modules/services/service-offering.entity.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

describe('Services catalog', () => {
  let app: NestExpressApplication;
  let repo: Repository<ServiceOffering>;

  beforeAll(async () => {
    app = await createTestApp();
    repo = app.get(DataSource).getRepository(ServiceOffering);
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const seed = (rows: Partial<ServiceOffering>[]) =>
    repo.insert(
      rows.map((r) => ({ title: 'T', summary: 'S', isPublished: true, sortOrder: 0, ...r })),
    );

  const idOf = async (slug: string) => (await repo.findOneByOrFail({ slug })).id;

  describe('GET /services', () => {
    it('returns published services ordered by sort_order then slug, as ServiceDto only', async () => {
      await seed([
        {
          slug: 'coaching-3-months',
          title: '3-Month 1:1 Coaching',
          summary: 'Three months.',
          sortOrder: 2,
        },
        { slug: 'kickstart-session', title: 'Kickstart', summary: 'One session.', sortOrder: 1 },
        { slug: 'draft-offer', isPublished: false, sortOrder: 0 },
      ]);
      const res = await request(app.getHttpServer()).get('/services');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          {
            id: await idOf('kickstart-session'),
            slug: 'kickstart-session',
            title: 'Kickstart',
            summary: 'One session.',
          },
          {
            id: await idOf('coaching-3-months'),
            slug: 'coaching-3-months',
            title: '3-Month 1:1 Coaching',
            summary: 'Three months.',
          },
        ],
      });
    });

    it('breaks sort_order ties by slug', async () => {
      await seed([
        { slug: 'b-offer', sortOrder: 1 },
        { slug: 'a-offer', sortOrder: 1 },
        { slug: 'c-offer', sortOrder: 0 },
      ]);
      const res = await request(app.getHttpServer()).get('/services');
      expect(res.status).toBe(200);
      expect(res.body.data.map((s: { slug: string }) => s.slug)).toEqual([
        'c-offer',
        'a-offer',
        'b-offer',
      ]);
    });

    it('returns an empty list, not 404, when nothing is published', async () => {
      const res = await request(app.getHttpServer()).get('/services');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    });
  });

  describe('GET /services/:slug', () => {
    const notFound = {
      data: null,
      error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
    };

    it('returns one published service', async () => {
      await seed([{ slug: 'kickstart-session', title: 'Kickstart', summary: 'One session.' }]);
      const res = await request(app.getHttpServer()).get('/services/kickstart-session');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          id: await idOf('kickstart-session'),
          slug: 'kickstart-session',
          title: 'Kickstart',
          summary: 'One session.',
        },
      });
    });

    it.each([
      ['unknown slug', 'nope'],
      ['uppercase slug', 'Kickstart'],
      ['uppercase kebab slug', 'Kickstart-Session'],
      ['whitespace slug', '%20'],
      ['very long slug', 'a'.repeat(300)],
    ])('%s → 404 NOT_FOUND', async (_n, slug) => {
      await seed([{ slug: 'kickstart-session' }]);
      const res = await request(app.getHttpServer()).get(`/services/${slug}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(notFound);
    });

    it('a draft is not found', async () => {
      await seed([{ slug: 'draft-offer', isPublished: false }]);
      const res = await request(app.getHttpServer()).get('/services/draft-offer');
      expect(res.status).toBe(404);
      expect(res.body).toEqual(notFound);
    });
  });
});
