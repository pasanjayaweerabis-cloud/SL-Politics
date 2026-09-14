import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Javora — in-house toast, modelled on Sonner's API (see /ask-sonner) so a
 * later move to the real package would be mechanical. Built in-house rather
 * than installed: CLAUDE.md's "Add no dependencies" is a documented position,
 * and a toast is one `role="status"` region and a handful of transitions, not
 * a case that overcomes it.
 *
 * A plain module-level store (not a context provider) read with
 * `useSyncExternalStore`, so `toast()` can be called from any event handler
 * without threading a hook through every caller — see PortfolioProfile.jsx's
 * "Copy link" / "Copy citation" buttons, the only current callers.
 *
 * Only ever call `toast()` from an event handler, never from a render or an
 * effect — an effect firing twice under StrictMode is exactly how Sonner's
 * own docs describe its double-toast bug, and this store has no de-duplication
 * against that failure mode beyond the stable-`id` update behaviour below.
 */

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 4000;

let toasts = [];
const listeners = new Set();
/** id -> { remaining, startedAt, timerId }. `startedAt: null` while paused. */
const timers = new Map();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current toast list. Exported for tests — Toaster is the only other
    reader, via `useSyncExternalStore`. */
export function getSnapshot() {
  return toasts;
}

function getServerSnapshot() {
  return toasts;
}

function stopTimer(id) {
  const timer = timers.get(id);
  // Bare `setTimeout`/`clearTimeout`, not `window.*`: this store is plain
  // state-machine logic with no DOM dependency, which is what lets its unit
  // tests run under plain Node — see the note on jsdom in CLAUDE.md's
  // "Current gaps". `window.*` would work in a browser but throw under Node,
  // where there is no `window`.
  if (timer?.timerId) clearTimeout(timer.timerId);
  return timer;
}

function startTimer(id, remaining) {
  if (!Number.isFinite(remaining) || remaining <= 0) {
    timers.delete(id);
    return;
  }
  const timerId = setTimeout(() => dismiss(id), remaining);
  timers.set(id, { remaining, startedAt: Date.now(), timerId });
}

/** Cancels the countdown without losing how much of it is left. */
export function pauseToast(id) {
  const timer = timers.get(id);
  if (!timer || timer.startedAt === null) return;
  const elapsed = Date.now() - timer.startedAt;
  stopTimer(id);
  timers.set(id, { remaining: Math.max(timer.remaining - elapsed, 0), startedAt: null, timerId: null });
}

/** Resumes a countdown `pauseToast` stopped, for whatever time was left. */
export function resumeToast(id) {
  const timer = timers.get(id);
  if (!timer || timer.startedAt !== null) return;
  startTimer(id, timer.remaining);
}

function dismiss(id) {
  stopTimer(id);
  timers.delete(id);
  const next = toasts.filter(entry => entry.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  notify();
}

let autoId = 0;
function nextId() {
  autoId += 1;
  return `toast-auto-${autoId}`;
}

/**
 * Show a toast, or update it in place when `options.id` matches one already
 * showing — the mechanism behind "click the same copy button 5x quickly: one
 * toast updates, no pile-up." A fresh, unmatched id is pushed to the front and
 * the list capped at MAX_VISIBLE, oldest dropped first.
 */
export function toast(message, options = {}) {
  const { id = nextId(), description, duration = DEFAULT_DURATION, variant = 'default' } = options;
  const previous = toasts.find(t => t.id === id);
  // Monotonic per-id counter: an update to a stable id (the same copy button
  // clicked twice) produces identical message/description text, so `bump` is
  // the only field ToastItem can key a re-acknowledgement effect on.
  const bump = previous ? previous.bump + 1 : 0;
  const entry = { id, message, description, duration, variant, bump };
  const isUpdate = previous !== undefined;

  const merged = isUpdate ? toasts.map(t => (t.id === id ? entry : t)) : [entry, ...toasts];
  toasts = merged.slice(0, MAX_VISIBLE);

  // Anything the cap above just dropped off the end still has a live timer
  // pointed at a dismiss() for an id nothing renders any more.
  for (const dropped of merged.slice(MAX_VISIBLE)) stopTimer(dropped.id);

  stopTimer(id);
  startTimer(id, duration);
  notify();
  return id;
}

toast.success = (message, options = {}) => toast(message, { ...options, variant: 'success' });
toast.error = (message, options = {}) => toast(message, { ...options, variant: 'error' });
toast.dismiss = id => {
  if (id) { dismiss(id); return; }
  for (const entry of toasts) stopTimer(entry.id);
  timers.clear();
  toasts = [];
  notify();
};

/* Retained one extra render past removal from the store, matching Drawer's
   "stay mounted long enough to play the exit" idiom in Primitives.jsx — the
   difference is a fixed delay here rather than a `transitionend` listener,
   since a dismissed toast (unlike the drawer) is never reopened mid-exit, so
   there is nothing to retarget. EXIT_MS is `--dur-exit` (140ms, tokens.css)
   plus a small buffer so the fade is never cut short by a slow paint; keep
   the two in step if `--dur-exit` changes. Omitting `data-open` here (rather
   than setting it "false") is what plays the exit at all: the base `.toast`
   rule IS the closed shape — translateY(8px), opacity 0, --dur-exit — so an
   entry that never reaches `data-open="true"` simply transitions to it. */
const EXIT_MS = 160;

function useVisibleToasts(list) {
  const [closing, setClosing] = React.useState([]);
  const prevListRef = React.useRef(list);

  React.useEffect(() => {
    const prevList = prevListRef.current;
    prevListRef.current = list;
    const liveIds = new Set(list.map(entry => entry.id));
    const justRemoved = prevList.filter(entry => !liveIds.has(entry.id));
    if (!justRemoved.length) return undefined;

    setClosing(current => [...current, ...justRemoved]);
    const timers = justRemoved.map(entry => setTimeout(() => {
      setClosing(current => current.filter(item => item !== entry));
    }, EXIT_MS));
    return () => timers.forEach(clearTimeout);
  }, [list]);

  // Filtered at render, not just at removal: a dismissed toast's stable id
  // (a copy button re-clicked right away) can come back alive before its own
  // exit timer above fires. Once that happens the live entry is what should
  // render — never a live copy and a still-fading ghost of the same id.
  const liveIds = new Set(list.map(entry => entry.id));
  return closing.filter(entry => !liveIds.has(entry.id));
}

function ToastItem({ entry, exiting, nodeRefCallback }) {
  const { t } = useI18n();
  const hovering = React.useRef(false);
  const focused = React.useRef(false);
  const nodeRef = React.useRef(null);
  const bumpTimerRef = React.useRef(null);
  const isFirstRender = React.useRef(true);

  // Re-acknowledgement: toast() replaces an entry with a matching stable id
  // in place, so clicking the same copy button twice produced an identical
  // DOM and no visible response at all. Skip the first render — the entrance
  // animation already covers that paint — and pulse `data-bump` on every
  // later bump so CSS has something to key a transition on.
  React.useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return undefined; }
    const node = nodeRef.current;
    if (!node) return undefined;
    node.setAttribute('data-bump', 'true');
    clearTimeout(bumpTimerRef.current);
    bumpTimerRef.current = setTimeout(() => node.removeAttribute('data-bump'), 240);
    return () => clearTimeout(bumpTimerRef.current);
  }, [entry.bump]);

  const maybeResume = () => {
    if (!hovering.current && !focused.current) resumeToast(entry.id);
  };

  const icon = entry.variant === 'success' ? 'check' : entry.variant === 'error' ? 'alert' : null;

  return <div
    ref={node => { nodeRef.current = node; nodeRefCallback?.(node); }}
    className={`toast toast--${entry.variant}`}
    data-open={exiting ? undefined : 'true'}
    onMouseEnter={() => { hovering.current = true; pauseToast(entry.id); }}
    onMouseLeave={() => { hovering.current = false; maybeResume(); }}
    onFocus={() => { focused.current = true; pauseToast(entry.id); }}
    onBlur={e => {
      // Focus moving between this toast's own message and its dismiss
      // button is not focus leaving the toast — only clear once it actually
      // has, which is what a plain focus-within pause/resume means.
      if (e.currentTarget.contains(e.relatedTarget)) return;
      focused.current = false;
      maybeResume();
    }}
  >
    {icon ? <Icon name={icon} className="toast__icon"/> : null}
    <div className="toast__body">
      <p className="toast__message">{entry.message}</p>
      {entry.description ? <p className="toast__description">{entry.description}</p> : null}
    </div>
    <button
      type="button"
      className="toast__dismiss"
      aria-label={t('toast.dismiss')}
      onClick={() => toast.dismiss(entry.id)}
    >
      <Icon name="close"/>
    </button>
  </div>;
}

/**
 * Mounted exactly once, in App.jsx beside `<Layout>` — never per page. Two
 * persistent live regions exist from first render (before any toast has ever
 * fired), which is what makes an announcement reliable: a region created at
 * the same moment as its first message is not reliably announced by a screen
 * reader. Renders no text and no layout while `toasts` is empty, which is
 * exactly its state on the server and on first paint, so the prerendered HTML
 * carries an empty shell rather than a broken control.
 */
export function Toaster() {
  const list = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Closing entries render alongside the live list for one more paint so
  // their exit transition (already defined on `.toast`'s base rule) has
  // something on screen to play against — see useVisibleToasts above.
  const closing = useVisibleToasts(list);
  const combined = [...list, ...closing];
  const statusToasts = combined.filter(entry => entry.variant !== 'error');
  const alertToasts = combined.filter(entry => entry.variant === 'error');
  const isExiting = entry => closing.includes(entry);
  const renderKey = entry => (isExiting(entry) ? `${entry.id}-exiting` : entry.id);

  // FLIP for the flex `column-reverse` stack shift: a new toast prepends to
  // the store (entering at the visual bottom), displacing every toast above
  // it by its own height + gap on the same frame — flex position isn't a
  // transitionable property, so there is no CSS-only fix. `nodes`/`positions`/
  // `anims` are plain refs, not state: writing to them must never trigger a
  // render, or this effect would loop.
  const nodesRef = React.useRef(new Map());
  const positionsRef = React.useRef(new Map());
  const animsRef = React.useRef(new Map());
  const setNodeRef = key => node => {
    if (node) nodesRef.current.set(key, node);
    else nodesRef.current.delete(key);
  };

  React.useLayoutEffect(() => {
    // Empty on the server and on first paint — return before any measurement
    // (useLayoutEffect never runs on the server, but this also covers the
    // brief client render before any toast has fired).
    if (combined.length === 0) return;
    // The play step below animates via the Web Animations API rather than
    // toggling an inline `transform`, specifically because this site's CSP
    // ships `style-src 'self'` with no `unsafe-inline` (scripts/prerender.mjs
    // — "this app has no inline style anywhere to accommodate") and writing
    // `node.style.transform` was confirmed, against the real prerendered
    // build, to trigger and get blocked by that policy. `Element.animate()`
    // does not touch the `style` attribute or the CSSOM inline style
    // declaration, so it isn't covered by style-src at all — but that also
    // means it bypasses base.css's reduced-motion override (which strips
    // `transform` from CSS transition lists, not WAAPI animations), so this
    // is the one place in the codebase that needs an explicit check.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const prevPositions = positionsRef.current;
    const nextPositions = new Map();
    const rootStyle = getComputedStyle(document.documentElement);
    const duration = parseFloat(rootStyle.getPropertyValue('--dur-enter')) || 200;
    const easing = rootStyle.getPropertyValue('--ease-out').trim() || 'ease-out';

    for (const entry of combined) {
      const key = closing.includes(entry) ? `${entry.id}-exiting` : entry.id;
      const node = nodesRef.current.get(key);
      if (!node) continue;

      const top = node.getBoundingClientRect().top;
      nextPositions.set(key, top);

      // No previous position recorded means this node just mounted — it has
      // its own @starting-style entrance to play, which fighting it with a
      // FLIP animation here would only interfere with.
      const prevTop = prevPositions.get(key);
      if (prevTop === undefined) continue;

      const delta = prevTop - top;
      if (Math.abs(delta) < 1) continue;

      // A retrigger before the previous travel finished (dismissing a toast
      // while others are still settling) must not layer two animations on
      // the same node — cancel and restart from the new delta instead.
      animsRef.current.get(key)?.cancel();
      const animation = node.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration, easing },
      );
      animsRef.current.set(key, animation);
    }

    positionsRef.current = nextPositions;
    for (const key of animsRef.current.keys()) {
      if (!nextPositions.has(key)) animsRef.current.delete(key);
    }
  }, [combined, closing]);

  return <div className="toaster">
    <div className="toaster__region" role="status" aria-live="polite">
      {statusToasts.map(entry => (
        <ToastItem key={renderKey(entry)} entry={entry} exiting={isExiting(entry)} nodeRefCallback={setNodeRef(renderKey(entry))}/>
      ))}
    </div>
    <div className="toaster__region" role="alert" aria-live="assertive">
      {alertToasts.map(entry => (
        <ToastItem key={renderKey(entry)} entry={entry} exiting={isExiting(entry)} nodeRefCallback={setNodeRef(renderKey(entry))}/>
      ))}
    </div>
  </div>;
}
