import { z } from 'zod';
import { pageQueryFields, toPageInfo } from './page.js';

describe('toPageInfo', () => {
  it.each([
    [1, 12, 0, { page: 1, pageSize: 12, totalItems: 0, totalPages: 0 }],
    [1, 12, 12, { page: 1, pageSize: 12, totalItems: 12, totalPages: 1 }],
    [2, 12, 13, { page: 2, pageSize: 12, totalItems: 13, totalPages: 2 }],
    [9, 50, 3, { page: 9, pageSize: 50, totalItems: 3, totalPages: 1 }],
  ])('page %i, size %i, %i items', (page, size, total, expected) => {
    expect(toPageInfo(page, size, total)).toEqual(expected);
  });
});

describe('pageQueryFields', () => {
  const schema = z.strictObject({ ...pageQueryFields });

  it('defaults to page 1 of 12 and coerces query strings', () => {
    expect(schema.parse({})).toEqual({ page: 1, pageSize: 12 });
    expect(schema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it.each([{ page: '0' }, { page: '1.5' }, { page: 'abc' }, { pageSize: '0' }, { pageSize: '51' }])(
    'rejects %o',
    (query) => {
      expect(schema.safeParse(query).success).toBe(false);
    },
  );
});
