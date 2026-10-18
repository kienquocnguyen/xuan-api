import { isCompleteCurriculumOrder, type CurriculumSnapshot } from './curriculum-order.js';

const [s1, s2, s3] = ['s1', 's2', 's3'];
const [l1, l2, l3, l4] = ['l1', 'l2', 'l3', 'l4'];

/** Two sections: s1 holds l1, l2; s2 holds l3. */
const current: CurriculumSnapshot = { sectionIds: [s1, s2], lessonIds: [l1, l2, l3] };

describe('isCompleteCurriculumOrder', () => {
  it.each([
    [
      'the exact curriculum in a different order',
      [
        { id: s2, lessonIds: [l3] },
        { id: s1, lessonIds: [l2, l1] },
      ],
    ],
    [
      'a lesson moved to another listed section',
      [
        { id: s1, lessonIds: [l1] },
        { id: s2, lessonIds: [l3, l2] },
      ],
    ],
    [
      'every lesson in one section, the other empty',
      [
        { id: s1, lessonIds: [] },
        { id: s2, lessonIds: [l1, l2, l3] },
      ],
    ],
  ])('accepts %s', (_case, sections) => {
    expect(isCompleteCurriculumOrder(current, { sections })).toBe(true);
  });

  it.each([
    ['a missing section', [{ id: s1, lessonIds: [l1, l2, l3] }]],
    [
      'a missing lesson',
      [
        { id: s1, lessonIds: [l1, l2] },
        { id: s2, lessonIds: [] },
      ],
    ],
    [
      'a duplicate lesson id',
      [
        { id: s1, lessonIds: [l1, l2, l1] },
        { id: s2, lessonIds: [l3] },
      ],
    ],
    [
      'a lesson listed in two sections',
      [
        { id: s1, lessonIds: [l1, l2, l3] },
        { id: s2, lessonIds: [l3] },
      ],
    ],
    [
      'a duplicate section id',
      [
        { id: s1, lessonIds: [l1, l2] },
        { id: s1, lessonIds: [l3] },
      ],
    ],
    [
      'a lesson id not in the course',
      [
        { id: s1, lessonIds: [l1, l2, l4] },
        { id: s2, lessonIds: [l3] },
      ],
    ],
    [
      'an extra lesson id beyond the course',
      [
        { id: s1, lessonIds: [l1, l2] },
        { id: s2, lessonIds: [l3, l4] },
      ],
    ],
    [
      'a section id not in the course',
      [
        { id: s1, lessonIds: [l1, l2] },
        { id: s3, lessonIds: [l3] },
      ],
    ],
    [
      'an extra section beyond the course',
      [
        { id: s1, lessonIds: [l1, l2] },
        { id: s2, lessonIds: [l3] },
        { id: s3, lessonIds: [] },
      ],
    ],
  ])('rejects %s', (_case, sections) => {
    expect(isCompleteCurriculumOrder(current, { sections })).toBe(false);
  });

  it('accepts an empty course ordered as empty', () => {
    expect(isCompleteCurriculumOrder({ sectionIds: [], lessonIds: [] }, { sections: [] })).toBe(
      true,
    );
  });

  it('rejects an empty order for a course that has sections', () => {
    expect(isCompleteCurriculumOrder(current, { sections: [] })).toBe(false);
  });
});
