import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { resolveListboxKeyAction } from '../lib/listbox.ts';

/**
 * A custom "pick one from a short list" control — the button-triggered
 * listbox pattern, as distinct from `SearchTypeahead`/`RecordPicker`'s
 * text-input combobox.
 *
 * Built to replace two native `<select>`s (the language switcher, the
 * corrections "field in question" picker) whose open popup is drawn by the
 * OS and cannot be styled at all on Windows — confirmed by inspecting the
 * popup directly: `option` background/colour computes correctly but the
 * platform's native combo-box widget ignores it when painting. There is no
 * CSS fix for that; a custom listbox is the only way to get a themed,
 * animated, rounded panel.
 *
 * Follows the same accessibility contract `SearchTypeahead` already uses
 * elsewhere in this codebase: only the trigger is ever focusable, the open
 * panel is plain `<div>`s tracked via `aria-activedescendant`, and a
 * `mousedown` listener outside the root closes it. That contract is what
 * keeps a custom dropdown from needing a focus trap — the trigger never
 * loses focus in the first place.
 */
export function Dropdown({
  id,
  value,
  options,
  onChange,
  label,
  /**
   * Id of a VISIBLE element that names this control, for the case where the
   * control sits beside its own label on screen (the directory's "Sort").
   * Preferred over `label` there: an `aria-label` would replace the trigger's
   * own text, so a screen reader would hear "Sort" and never hear which sort
   * is currently applied. `aria-labelledby` pointing at the visible label AND
   * at the trigger itself reads both, in the order they appear on screen.
   */
  labelledBy,
  placeholder,
  renderTrigger,
  triggerClassName = '',
  panelClassName = '',
  invalid,
  describedBy,
}) {
  const [open, setOpen] = React.useState(false);
  const selectedIndex = options.findIndex(option => option.value === value);
  const [activeIndex, setActiveIndex] = React.useState(selectedIndex);
  // 'bottom' (default) drops the panel below the trigger; 'top' flips it
  // above. Needed because the language switcher also renders inside the
  // mobile nav drawer, near the bottom of that drawer's own scrolling area —
  // opening downward there put the list past the visible edge, so a reader
  // had to already know to scroll the drawer before they could see it had
  // opened at all.
  const [placement, setPlacement] = React.useState('bottom');
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const listId = `${id}-listbox-${React.useId()}`;

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const openPanel = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // The panel isn't rendered yet to measure, so this estimates its
      // height from the option count/row size (`.dropdown__option`'s own
      // padding) rather than the exact laid-out value — close enough to
      // decide which side has room, capped at the panel's own max-height.
      const estimatedHeight = Math.min(320, options.length * 38 + 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPlacement(spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? 'top' : 'bottom');
    }
    setOpen(true);
  };

  const select = index => {
    const option = options[index];
    setOpen(false);
    if (option) onChange(option.value);
  };

  const handleKeyDown = event => {
    const action = resolveListboxKeyAction(event.key, { open, activeIndex, length: options.length });
    if (action.type === 'open') {
      event.preventDefault();
      openPanel();
    } else if (action.type === 'move') {
      event.preventDefault();
      setActiveIndex(action.index);
    } else if (action.type === 'select') {
      event.preventDefault();
      select(action.index);
    } else if (action.type === 'close') {
      if (action.keepFocus) event.preventDefault();
      setOpen(false);
    }
  };

  const activeId = open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;
  const selected = options[selectedIndex];

  // Keeps the panel mounted through its closing fade instead of vanishing
  // instantly — same `data-open`-transition idiom `SearchTypeahead` uses.
  // Caught during render (comparing against the previous render's value),
  // not in an effect, so the correction lands in the same paint as the
  // state change rather than one frame late.
  const [mounted, setMounted] = React.useState(open);
  const [lastOpen, setLastOpen] = React.useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setMounted(true);
  }

  return <div className="dropdown" ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      id={id}
      className={`dropdown__trigger ${triggerClassName}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={activeId}
      aria-label={!labelledBy && renderTrigger ? label : undefined}
      aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
      aria-invalid={invalid ? 'true' : undefined}
      aria-describedby={describedBy}
      onClick={() => (open ? setOpen(false) : openPanel())}
      onKeyDown={handleKeyDown}
    >
      {renderTrigger
        ? renderTrigger(selected)
        : <span className="dropdown__value" data-placeholder={selected ? undefined : 'true'}>{selected ? selected.label : placeholder}</span>}
      <Icon name="chevronDown" className="dropdown__chevron"/>
    </button>
    {mounted ? <div
      className={`dropdown__panel ${panelClassName}`}
      data-open={open ? 'true' : 'false'}
      data-placement={placement}
      id={listId} role="listbox" aria-label={label}
      onTransitionEnd={event => { if (!open && event.target === event.currentTarget) setMounted(false); }}
    >
      {options.map((option, index) => (
        <div
          key={option.value}
          id={`${listId}-option-${index}`}
          role="option"
          aria-selected={option.value === value}
          className={`dropdown__option${index === activeIndex ? ' dropdown__option--active' : ''}`}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => select(index)}
        >
          {option.label}
        </div>
      ))}
    </div> : null}
  </div>;
}
