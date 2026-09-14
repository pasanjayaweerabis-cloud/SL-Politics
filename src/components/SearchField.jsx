import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { useI18n } from '../lib/i18n.jsx';

/**
 * The icon + input + clear-button shell shared by SearchBar (Primitives.jsx)
 * and SearchTypeahead. The two components duplicated roughly 40 lines of this
 * markup and controlled-input wiring.
 *
 * Deliberately narrow: only the `.search__field` div. The outer `<form>`,
 * its `role="search"`/`onSubmit`, the visually-hidden `<label>` and the
 * submit button are NOT here, because they differ between the two callers
 * (SearchBar's form gets a `compact` modifier and an optional submit button;
 * SearchTypeahead's form is always full-width with a combobox wired to it) —
 * and because keeping them in each caller is what lets SearchBar stay a
 * plain filter input and SearchTypeahead stay a navigation combobox with a
 * different keyboard contract, which the audit is explicit must not be
 * flattened into one component.
 *
 * Holds no state of its own — `value`/`onChange`/`onClear` are fully
 * controlled by the caller, exactly as both originals already managed their
 * own local text state. `onChange` receives the native change event (not
 * just the string) because both callers' existing handlers already read
 * `event.target.value` themselves alongside other work (SearchBar also
 * calls `onInput`; SearchTypeahead also opens the panel and resets the
 * highlighted row) — passing the raw event preserves that without SearchField
 * inventing a second calling convention.
 */
/**
 * "/" focuses this field from anywhere on the page — the nav has no
 * persistent search input to focus (just links into whichever page's own
 * field this is), so each mounted SearchField claims the shortcut for
 * itself. Guarded against firing while any other input, textarea or
 * contenteditable already has focus, so it never steals a "/" a reader typed
 * into unrelated text.
 */
function useSlashFocus(inputRef, enabled) {
  React.useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inputRef, enabled]);
}

/**
 * `inputRef`: an external ref onto the actual `<input>` DOM node — for a
 * caller (SearchTypeahead's mobile sheet) that needs to focus it
 * imperatively. Optional: when omitted, SearchField keeps its own internal
 * ref, which is all `useSlashFocus` above needs. Never passed via
 * `inputProps` — a `ref` spread in there after this component's own
 * `ref={...}` would silently replace it, breaking the shortcut.
 */
export function SearchField({
  id,
  type = 'search',
  value,
  placeholder,
  onChange,
  onClear,
  inputProps = {},
  inputRef: externalRef,
  enableSlashShortcut = true,
}) {
  const { t } = useI18n();
  const internalRef = React.useRef(null);
  const inputRef = externalRef ?? internalRef;
  useSlashFocus(inputRef, enableSlashShortcut);
  return <div className="search__field">
    <Icon name="search" className="search__icon"/>
    <input
      id={id}
      ref={inputRef}
      className="search__input"
      type={type}
      name="q"
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      onChange={onChange}
      {...inputProps}
    />
    <button type="button" className="search__clear" aria-label={t('common.clearSearch')} data-visible={value ? 'true' : 'false'} onClick={onClear}><Icon name="close"/></button>
  </div>;
}
