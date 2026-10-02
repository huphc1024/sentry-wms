import '@testing-library/jest-dom';

/**
 * jsdom implements no media queries, and Ant Design's responsive
 * components call matchMedia while rendering. Without this shim every
 * test that renders a table throws "window.matchMedia is not a function"
 * before it can assert anything. Nothing matches, which is the right
 * answer for a headless DOM with no viewport: components fall back to
 * their default layout.
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
