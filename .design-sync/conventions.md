## Using the SL Politics / Javora component set

**No provider or wrapper required.** None of these components read from React
context — they're plain function components taking props. Just import and
use them directly; no `<ThemeProvider>` or root wrapper to add.

**Optional dark mode**: the stylesheet ships a dark palette activated by
`<html data-theme="dark">` (or via `prefers-color-scheme`). Leave it off
unless the design specifically calls for dark mode.

### Styling idiom: CSS custom properties + BEM-ish classes

This is **not** a utility-class system (no Tailwind-style atomic classes) and
**not** a prop-driven style API — components render fixed class names, and
those classes consume design tokens via `var(--token-name)`. To restyle or
compose new layout, write plain CSS using the same tokens; don't invent
new hex colors or spacing values.

Real tokens (from `tokens/tokens.css` in this bundle):

| Purpose | Tokens |
|---|---|
| Surfaces | `--background`, `--surface`, `--surface-soft`, `--surface-inset`, `--nav-bg`, `--footer-bg` |
| Brand | `--primary`, `--primary-dark`, `--secondary`, `--deep-teal`, `--sage` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-on-brand` |
| Borders | `--border`, `--border-strong` |
| Status (each has `-text`/`-bg`/`-border`) | `--success`, `--warning`, `--danger`, `--info` |
| Type scale | `--text-xs` … `--text-xl`, `--font-serif` (headings), `--font-sans` (body), `--font-mono` |
| Spacing | `--space-1` … `--space-24` (0.25rem steps) |
| Radius | `--radius-xs`, `--radius-sm`, `--radius`, `--radius-md`, `--radius-lg`, `--radius-full` |
| Motion | `--dur` (220ms), `--ease` |

Component class families follow a `block`/`block--modifier` pattern, e.g.
`.badge` + `.badge--verified`/`.badge--current`, `.chip` + `.chip--gold`/
`.chip--muted`, `.notice` + `.notice--info`/`.notice--warning`, `.btn` +
`.btn--primary`/`.btn--secondary`/`.btn--ghost`/`.btn--sm`, `.avatar` +
`.avatar--sm`/`.avatar--lg`. When you need a class this DS doesn't ship
(e.g. a new layout wrapper), write real CSS against the tokens table above
rather than inline styles with hardcoded colors.

### Where the truth lives

Read `styles.css` (and its `@import`s, including `_ds_bundle.css`) before
styling anything new — it's the actual compiled stylesheet this bundle
ships, tokens included. Each component's `.prompt.md` documents its own
props and usage.

### Example composition

```jsx
import { SectionHead, StatsCard, ProfileResult } from 'javora-react';

function DirectorySummary({ view }) {
  return (
    <section>
      <SectionHead title="Directory" description="Every public figure on record." />
      <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
        <StatsCard value={225} label="Sitting Members of Parliament" iconName="users" />
        <StatsCard value={612} label="Former members recorded" iconName="archive" />
      </div>
      <ProfileResult view={view} />
    </section>
  );
}
```
