import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { beforeEach } from 'vitest';

/**
 * `waitFor` and `findBy*` carry their own one-second budget, separate
 * from vitest's testTimeout, so raising that one never covered them: a
 * redirect assertion still failed at 1.6s on a busy machine while the
 * test itself had 20 seconds left. Same bargain as the timeout above --
 * the assertions are unchanged, only the patience.
 */
configure({ asyncUtilTimeout: 10000 });

/**
 * Pin the UI language for the whole suite.
 *
 * The admin panel ships Vietnamese by default (locale.jsx falls back to
 * 'vi' when nothing is stored, and friendlyError / ErrorBoundary read the
 * same key directly). These tests were written against the English source
 * strings and assert behaviour, not copy, so they declare the language
 * they expect instead of being rewritten every time a phrase is
 * translated. A test that cares about the Vietnamese output sets the key
 * itself.
 */
// A file that declares `@vitest-environment node` -- the ones that only
// read source text -- has no localStorage to pin. A file that resolves a
// translation at runtime needs jsdom and says so.
beforeEach(() => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('sentry_admin_locale', 'en');
});

/**
 * jsdom implements no media queries, and Ant Design's responsive
 * components (Table's breakpoint handling, Grid) call matchMedia during
 * render. Without this shim every test that renders a table throws
 * "window.matchMedia is not a function" before it can assert anything.
 * Nothing here matches, which is the right answer for a headless DOM with
 * no viewport: components fall back to their default layout.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
