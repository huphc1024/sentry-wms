/**
 * `RichText` exists so a sentence with markup in the middle stays one
 * translation key. The test that matters is the second one: the two
 * languages put the value in different places, and the rendered output
 * has to follow the sentence, not the source order of the JSX.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RichText from '../i18n/RichText.jsx';
import { messages } from '../i18n/messages/index.js';

describe('RichText', () => {
  it('keeps the markup around the value', () => {
    const { container } = render(
      <RichText
        text="Cancelling will mark {so} as CANCELLED."
        values={{ so: <strong>SO-1042</strong> }}
      />,
    );
    expect(container.querySelector('strong').textContent).toBe('SO-1042');
    expect(container.textContent).toBe('Cancelling will mark SO-1042 as CANCELLED.');
  });

  it('follows the sentence when a language moves the value', () => {
    const { container } = render(
      <RichText
        text="{parent} is unaffected, and {so} is cancelled."
        values={{ so: <b>SO-1042</b>, parent: <i>SO-9</i> }}
      />,
    );
    expect(container.textContent).toBe('SO-9 is unaffected, and SO-1042 is cancelled.');
  });

  it('leaves a placeholder nobody supplied visible', () => {
    const { container } = render(<RichText text="a {missing} b" values={{}} />);
    expect(container.textContent).toBe('a {missing} b');
  });

  it('renders every placeholder the cancel warning declares', () => {
    // The page supplies `so` and `parent`. If a translation gains a
    // third placeholder, this is where it shows up -- otherwise the
    // modal would render a literal `{x}` to an operator.
    const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const locale of ['en', 'vi']) {
      expect(names(messages[locale]['backorders.cancelWarning']))
        .toEqual(['parent', 'so']);
    }
  });
});
