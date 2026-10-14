import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, QueryFailedError, type Repository } from 'typeorm';
import { ServiceOffering } from '../src/modules/services/service-offering.entity.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

// A fresh object per insert: TypeORM writes the generated id back onto the inserted object.
const valid = () => ({
  slug: 'kickstart-session',
  title: 'Kickstart',
  summary: 'One focused session.',
});

const constraintOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QueryFailedError) {
      return (error.driverError as { constraint?: string }).constraint;
    }
    throw error;
  }
  throw new Error('expected the insert to fail');
};

describe('services table invariants', () => {
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

  it('fills id (uuid v7), created_at and defaults', async () => {
    await repo.insert(valid());
    const row = await repo.findOneByOrFail({ slug: 'kickstart-session' });
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.isPublished).toBe(false);
    expect(row.sortOrder).toBe(0);
  });

  it.each([
    [
      'duplicate slug',
      'uq_services_slug',
      async (r: Repository<ServiceOffering>) => {
        await r.insert(valid());
        return r.insert(valid());
      },
    ],
    [
      'uppercase slug',
      'ck_services_slug_format',
      (r: Repository<ServiceOffering>) => r.insert({ ...valid(), slug: 'Kickstart' }),
    ],
    [
      'double-dash slug',
      'ck_services_slug_format',
      (r: Repository<ServiceOffering>) => r.insert({ ...valid(), slug: 'a--b' }),
    ],
    [
      'blank title',
      'ck_services_title_not_blank',
      (r: Repository<ServiceOffering>) => r.insert({ ...valid(), title: '   ' }),
    ],
    [
      'blank summary',
      'ck_services_summary_not_blank',
      (r: Repository<ServiceOffering>) => r.insert({ ...valid(), summary: '' }),
    ],
  ])('rejects %s via %s', async (_name, constraint, act) => {
    expect(await constraintOf(act(repo))).toBe(constraint);
  });
});
