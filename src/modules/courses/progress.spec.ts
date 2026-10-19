import { clampPosition, type ProgressState, resolveResumeLessonId } from './progress.js';
import { toLessonProgressDto } from './dto/learning.dto.js';

describe('clampPosition', () => {
  it.each([
    ['above a known duration', 900, 600, 600],
    ['within the duration', 30, 600, 30],
    ['without a known duration', 900, null, 900],
    ['at zero', 0, 600, 0],
  ])('clamps a position %s', (_case, position, duration, expected) => {
    expect(clampPosition(position, duration)).toBe(expected);
  });
});

describe('resolveResumeLessonId', () => {
  const lessons = ['a', 'b', 'c'];
  const at = (minute: number, completed = false): ProgressState => ({
    lastWatchedAt: new Date(Date.UTC(2026, 9, 19, 10, minute)),
    completedAt: completed ? new Date(Date.UTC(2026, 9, 19, 10, minute)) : null,
  });
  const progress = (...entries: Array<[string, ProgressState]>) => new Map(entries);

  it.each([
    ['no progress → the first lesson', progress(), 'a'],
    ['the latest is incomplete → that lesson', progress(['a', at(1, true)], ['b', at(2)]), 'b'],
    ['the latest is completed → the next lesson', progress(['b', at(2, true)]), 'c'],
    ['the last lesson completed → stays on it', progress(['c', at(3, true)]), 'c'],
    ['only an unpublished lesson has progress → the first lesson', progress(['x', at(9)]), 'a'],
    ['an unpublished lesson is newer → it is ignored', progress(['x', at(9)], ['b', at(2)]), 'b'],
    ['a tie at the latest instant → the later lesson', progress(['a', at(5)], ['b', at(5)]), 'b'],
    [
      'an older incomplete lesson does not win over a newer completed one',
      progress(['a', at(1)], ['b', at(4, true)]),
      'c',
    ],
  ])('%s', (_case, state, expected) => {
    expect(resolveResumeLessonId(lessons, state)).toBe(expected);
  });

  it('returns null only when there is no published lesson', () => {
    expect(resolveResumeLessonId([], progress(['a', at(1)]))).toBeNull();
  });
});

describe('toLessonProgressDto', () => {
  const row = (positionSeconds: number, completed = false) => ({
    positionSeconds,
    completedAt: completed ? new Date() : null,
    lastWatchedAt: new Date(),
  });

  it.each([
    ['no row → zeros', undefined, 600, { positionSeconds: 0, completed: false }],
    ['a row within the duration', row(120), 600, { positionSeconds: 120, completed: false }],
    [
      'a row above a lowered duration → read-clamped',
      row(600, true),
      300,
      { positionSeconds: 300, completed: true },
    ],
    ['a row without a known duration', row(900), null, { positionSeconds: 900, completed: false }],
  ])('maps %s', (_case, progress, duration, expected) => {
    expect(toLessonProgressDto(progress, duration)).toEqual(expected);
  });
});
