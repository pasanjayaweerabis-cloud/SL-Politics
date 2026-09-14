// Hand-authored aggregator entry for design-sync: this repo has no library
// build (no package.json module/main/exports), so the converter has no dist
// to bundle from. This barrels the real exported components from
// src/components/ so the converter can build window.Javora from the repo's
// actual shipped code, per the "synthesize an entry" fallback.
export * from '../src/components/Primitives.jsx';
export * from '../src/components/Chrome.jsx';
export * from '../src/components/SearchTypeahead.jsx';
export * from '../src/components/Tabs.jsx';
