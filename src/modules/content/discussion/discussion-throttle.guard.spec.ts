import { DISCUSSION_LIMITS } from './discussion-throttle.guard.js';

describe('discussion throttle limits (owner BD-8, spec §6.4)', () => {
  it('allows 5 writes a minute and 60 an hour per user', () => {
    expect(DISCUSSION_LIMITS).toEqual([
      { name: 'minute', ttl: 60_000, limit: 5 },
      { name: 'hour', ttl: 3_600_000, limit: 60 },
    ]);
  });
});
