/**
 * Javora — light/dark theme.
 *
 * The chosen theme is applied to <html data-theme> by an inline script in
 * index.html before first paint, so there is no flash of the wrong theme on
 * load. This module keeps that attribute and localStorage in step afterwards.
 *
 * Every localStorage access is guarded: it throws outright in Safari private
 * mode and wherever site data is blocked, and a theme preference is not worth
 * breaking the page over.
 */

export const STORAGE_KEY = 'javora.theme';

export function storedTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // Storage unavailable — fall back to the system preference.
    return null;
  }
}

/**
 * The theme in effect now: an explicit choice, else the system preference.
 *
 * Returns 'light' when there is no DOM, which happens while prerendering.
 * A build cannot know a future reader's preference, so the static HTML commits
 * to light and the toggle re-reads the real theme on mount. The inline script
 * in index.html has already set <html data-theme> by then, so the correction
 * happens before anything is painted.
 */
export function activeTheme() {
  if (typeof document === 'undefined') return 'light';
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Preference cannot be persisted; it still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent('javora:themechange', { detail: { theme } }));
}

export function toggleTheme() {
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
