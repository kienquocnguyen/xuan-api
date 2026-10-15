const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const UNSAFE_CHARACTERS = /[\s\u0000-\u001f\u007f]/u;

/** An absolute https/http/mailto URL without credentials (blog spec §4.1, link rule). */
export function isSafeLinkHref(href: string): boolean {
  if (UNSAFE_CHARACTERS.test(href)) return false;
  let url: URL;
  try {
    url = new URL(href); // relative, protocol-relative and fragment-only hrefs throw without a base
  } catch {
    return false;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
  return url.username === '' && url.password === '';
}
