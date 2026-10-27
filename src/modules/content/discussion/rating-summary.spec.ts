import { toRatingSummary } from './rating-summaries.js';

describe('toRatingSummary (blog completion spec §6.2)', () => {
  it.each([
    [0, 0, { average: null, count: 0 }],
    [1, 5, { average: 5, count: 1 }],
    [2, 9, { average: 4.5, count: 2 }],
    [3, 13, { average: 4.33, count: 3 }],
    [3, 14, { average: 4.67, count: 3 }],
    [6, 7, { average: 1.17, count: 6 }],
  ])('%i ratings summing %i → %o', (count, sum, summary) => {
    expect(toRatingSummary(count, sum)).toEqual(summary);
  });
});
