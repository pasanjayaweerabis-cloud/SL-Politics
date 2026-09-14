import React from "react";

/**
 * Javora — debounce a rapidly-changing value.
 *
 * Returns `value`, but only after it has stopped changing for `delayMs`.
 * Used to decouple what a search box DISPLAYS (instant — every keystroke,
 * every input, the clear button) from what triggers an expensive
 * recomputation (the actual query/filter pass), without touching either the
 * input component or the computation it feeds.
 *
 * Deliberately a value, not a debounced callback: DirectoryPage's `commit()`
 * still updates the URL on every keystroke exactly as before (search
 * remains shareable and back/forward-restorable at the character it was
 * typed), and SearchTypeahead's `text` still updates on every keystroke for
 * what the input displays. Only the derived, expensive read — `queryPeople`/
 * `facetOptions`, `suggestPeople` — is asked to wait for typing to pause.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
