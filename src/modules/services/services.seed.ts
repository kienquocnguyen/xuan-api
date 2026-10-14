import dataSource from '../../database/data-source.js';
import { ServiceOffering } from './service-offering.entity.js';

// Owner-approved catalog copy (2026-10-14). Re-running updates these rows in place, keyed by slug.
const catalog: Array<
  Pick<ServiceOffering, 'slug' | 'title' | 'summary' | 'isPublished' | 'sortOrder'>
> = [
  {
    slug: 'channel-kickstart',
    title: 'Channel Kickstart Session',
    summary:
      'A focused 90-minute 1:1 coaching session to help creators clarify where to start and build a practical 30-day content direction.',
    isPublished: true,
    sortOrder: 1,
  },
  {
    slug: '3-month-1-1-coaching',
    title: '3-Month 1:1 Coaching',
    summary:
      'A 12-week 1:1 coaching program to help creators build and refine their Personal Brand through content, feedback, and a repeatable system.',
    isPublished: true,
    sortOrder: 2,
  },
];

async function seed(): Promise<void> {
  await dataSource.setOptions({ logging: ['query'] }).initialize();
  try {
    await dataSource
      .createQueryBuilder()
      .insert()
      .into(ServiceOffering)
      .values(catalog)
      // Named target (D32): a future unrelated unique constraint must never be silently absorbed.
      .orUpdate(['title', 'summary', 'is_published', 'sort_order'], 'uq_services_slug')
      .execute();
  } finally {
    await dataSource.destroy();
  }
}

await seed();
