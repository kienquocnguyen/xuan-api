/** A high surrogate not followed by a low one, or a low surrogate not preceded by a high one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Text PostgreSQL can store: no NUL (rejected by `varchar`/`jsonb`) and no lone UTF-16 surrogate (rejected by
 * the `jsonb` parser, replaced silently in `varchar`). Either would otherwise surface as a 500 or corrupt text
 * (I15; blog spec §4.1 "Strings").
 */
export function isStorableText(value: string): boolean {
  return !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}

export const STORABLE_TEXT_MESSAGE = 'Text must not contain NUL characters or broken Unicode.';
