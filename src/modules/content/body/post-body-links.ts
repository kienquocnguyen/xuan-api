const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const WHITESPACE = /\s/u;

/**
 * C0 controls, DEL or any whitespace: the URL parser would silently strip or encode them. All of these are
 * single UTF-16 code units, so a code-unit loop is exact.
 */
function hasUnsafeCharacter(href: string): boolean {
  for (let i = 0; i < href.length; i++) {
    const code = href.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || WHITESPACE.test(href[i])) return true;
  }
  return false;
}

/** An absolute https/http/mailto URL without credentials (blog spec §4.1, link rule). */
export function isSafeLinkHref(href: string): boolean {
  if (hasUnsafeCharacter(href)) return false;
  let url: URL;
  try {
    url = new URL(href); // relative, protocol-relative and fragment-only hrefs throw without a base
  } catch {
    return false;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
  return url.username === '' && url.password === '';
}

const ANCHOR = /^#[A-Za-z0-9_-]{1,200}$/;

/**
 * Body version 2 (blog completion spec §5.5): the version 1 rule, plus a site-relative `/path` (one leading
 * slash, never `//host`, no backslash) and an in-page `#anchor`.
 */
export function isSafeLinkHrefV2(href: string): boolean {
  if (isSafeLinkHref(href) || ANCHOR.test(href)) return true;
  return (
    href.startsWith('/') &&
    !href.startsWith('//') &&
    !href.includes('\\') &&
    !hasUnsafeCharacter(href)
  );
}
