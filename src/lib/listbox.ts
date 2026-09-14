/**
 * Javora — custom listbox selection logic (the button-triggered "pick one
 * from a short list" pattern, as distinct from `typeahead.ts`'s text-input
 * combobox).
 *
 * Kept framework-free and pure for the same reason `typeahead.ts` is: the
 * interaction rules (what opens the panel, how Home/End/arrows move the
 * highlight, what Enter does closed vs. open) are unit-testable without a
 * DOM renderer this project doesn't have set up.
 */

export type ListboxAction =
  | { type: "open" }
  | { type: "move"; index: number }
  | { type: "select"; index: number }
  | { type: "close"; keepFocus: boolean }
  | { type: "none" };

/**
 * What a keydown on the trigger (when closed) or the listbox (when open,
 * via `aria-activedescendant` — focus never leaves the trigger) should do.
 *
 * `length` is the option count; `activeIndex` is the currently highlighted
 * option, or -1 when nothing is highlighted yet.
 */
export function resolveListboxKeyAction(
  key: string,
  state: { open: boolean; activeIndex: number; length: number },
): ListboxAction {
  if (!state.open) {
    // Space/Enter/either arrow all open a closed control — this matches the
    // native <select> it replaces, where any of these keys drops the list.
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
      return { type: "open" };
    }
    return { type: "none" };
  }

  if (key === "ArrowDown") {
    if (!state.length) return { type: "none" };
    const next = state.activeIndex < 0 ? 0 : (state.activeIndex + 1) % state.length;
    return { type: "move", index: next };
  }
  if (key === "ArrowUp") {
    if (!state.length) return { type: "none" };
    const next = state.activeIndex < 0 ? state.length - 1 : (state.activeIndex - 1 + state.length) % state.length;
    return { type: "move", index: next };
  }
  if (key === "Home") {
    return state.length ? { type: "move", index: 0 } : { type: "none" };
  }
  if (key === "End") {
    return state.length ? { type: "move", index: state.length - 1 } : { type: "none" };
  }
  if (key === "Enter" || key === " ") {
    return state.activeIndex >= 0 && state.activeIndex < state.length
      ? { type: "select", index: state.activeIndex }
      : { type: "close", keepFocus: true };
  }
  if (key === "Escape") {
    return { type: "close", keepFocus: true };
  }
  if (key === "Tab") {
    // Tab moves focus on its own — this only tells the caller to drop the
    // panel first, never to preventDefault the keystroke.
    return { type: "close", keepFocus: false };
  }
  return { type: "none" };
}
