// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { messages } from '../messages/index.js';

const { en, vi } = messages;

describe('message tables', () => {
  it('defines every key in both languages', () => {
    const enOnly = Object.keys(en).filter((k) => !(k in vi));
    const viOnly = Object.keys(vi).filter((k) => !(k in en));
    expect({ enOnly, viOnly }).toEqual({ enOnly: [], viOnly: [] });
  });

  it('leaves no value empty', () => {
    const blank = [
      ...Object.entries(en).filter(([, v]) => !String(v).trim()).map(([k]) => `en ${k}`),
      ...Object.entries(vi).filter(([, v]) => !String(v).trim()).map(([k]) => `vi ${k}`),
    ];
    expect(blank).toEqual([]);
  });

  it('keeps the same {placeholders} in both languages', () => {
    const names = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.keys(en)
      .filter((k) => k in vi)
      .filter((k) => names(en[k]).join() !== names(vi[k]).join())
      .map((k) => `${k}: en{${names(en[k])}} vi{${names(vi[k])}}`);
    expect(mismatched).toEqual([]);
  });
});
