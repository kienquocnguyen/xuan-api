import type { Post } from './post.entity.js';
import { omittedFieldsWithData } from './post-compatibility.js';

const stored = (tags: string[]) => ({ tags }) as Post;

describe('omittedFieldsWithData (blog spec §3.4, Q3)', () => {
  it('reports tags omitted while the post has some', () => {
    expect(omittedFieldsWithData({ slug: 'a' }, stored(['x']))).toEqual(['tags']);
  });

  it('ignores tags omitted while the post has none', () => {
    expect(omittedFieldsWithData({ slug: 'a' }, stored([]))).toEqual([]);
  });

  it.each([null, [], ['y']])('ignores tags sent explicitly (%o)', (tags) => {
    expect(omittedFieldsWithData({ slug: 'a', tags }, stored(['x']))).toEqual([]);
  });
});
