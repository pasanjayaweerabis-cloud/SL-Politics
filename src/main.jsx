import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import './styles/index.css';
import App from './App.jsx';

/**
 * Two mount paths, chosen by what is already in the document.
 *
 * A production build is prerendered: `#root` arrives full of real markup, and
 * hydrating adopts it — the reader sees content immediately and React attaches
 * behaviour to what is already on screen. Calling `createRoot` there would
 * throw that markup away and re-render from nothing, producing a visible flash
 * and wasting the entire point of prerendering.
 *
 * The dev server prerenders nothing, so `#root` is empty and there is nothing
 * to hydrate. `hydrateRoot` on an empty container is an error, so development
 * takes the ordinary client path.
 */
const container = document.getElementById('root');
const tree = <React.StrictMode><App/></React.StrictMode>;

if (container.hasChildNodes()) hydrateRoot(container, tree);
else createRoot(container).render(tree);

// Entrance animations (empty state, revealed cards, filter chips, avatar
// fade-in) must never ship as an invisible base state in the prerendered
// HTML a crawler or no-JS reader gets — see the "Prerender / crawlability"
// invariants in CLAUDE.md. Every such rule is scoped to
// `:root[data-hydrated]` and this attribute only appears once React is
// actually running, so the static markup stays fully visible by default.
document.documentElement.setAttribute('data-hydrated', 'true');
