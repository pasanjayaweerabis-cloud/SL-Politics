/**
 * Javora — portrait URL resolution.
 *
 * Moved out of components/Primitives.jsx, where it sat as one of two pure
 * functions in an otherwise all-JSX file — which is why
 * src/lib/portrait.test.ts, testing this exact function, had no matching
 * source file for years. The tests are unchanged; only their import path
 * moves with the function.
 */

/**
 * Resolve a portrait URL for use in `src`.
 *
 * Absolute URLs are returned untouched; only genuinely relative paths get a
 * leading slash. The previous version prepended "/" unconditionally, which
 * turned every official portrait into "/https://www.parliament.lk/..." — a
 * 404 that silently fell back to the monogram. That is why no portrait had
 * ever appeared, and it looked like a deliberate design choice rather than
 * the bug it was.
 */
export function portraitSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^(https?:)?\/\//i.test(url) || url.startsWith('/') ? url : `/${url}`;
}
