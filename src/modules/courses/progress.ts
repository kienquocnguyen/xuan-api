/** What the resume rule needs from a progress row (course spec §9.4). */
export type ProgressState = Readonly<{ completedAt: Date | null; lastWatchedAt: Date }>;

/** A saved position never exceeds the lesson's known duration (spec §9.2 on write, §9.6 on read). */
export function clampPosition(positionSeconds: number, durationSeconds: number | null): number {
  return durationSeconds === null ? positionSeconds : Math.min(positionSeconds, durationSeconds);
}

/**
 * Resume (spec §9.4), over the course's **published** lessons in curriculum order; progress on any other lesson is
 * ignored (§10.2): (1) the lesson with the latest `lastWatchedAt`, a tie going to the later lesson; (2) if it's
 * completed, the next one, or itself when it's the last; (3) with no progress, the first. `null` only when there
 * is no published lesson, which P1 rules out for a published course.
 */
export function resolveResumeLessonId(
  publishedLessonIds: readonly string[],
  progress: ReadonlyMap<string, ProgressState>,
): string | null {
  if (publishedLessonIds.length === 0) return null;
  let latest = -1;
  let latestAt = -Infinity;
  publishedLessonIds.forEach((id, index) => {
    const state = progress.get(id);
    if (state && state.lastWatchedAt.getTime() >= latestAt) {
      latest = index;
      latestAt = state.lastWatchedAt.getTime();
    }
  });
  if (latest === -1) return publishedLessonIds[0];
  const completed = progress.get(publishedLessonIds[latest])?.completedAt != null;
  return publishedLessonIds[
    completed ? Math.min(latest + 1, publishedLessonIds.length - 1) : latest
  ];
}
