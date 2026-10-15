const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const WHITESPACE = /\s/u;

/** C0 controls, DEL or any whitespace: the URL parser would silently strip or encode them. */
const hasUnsafeCharacter = (href: string) =>
  [...href].some((char) => {
    const code = char.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f || WHITESPACE.test(char);
  });

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
