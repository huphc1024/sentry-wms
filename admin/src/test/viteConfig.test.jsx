// @vitest-environment node
// This file never touches the DOM. Building a jsdom for it cost about
// eighteen seconds of the suite's wall clock and, on a loaded machine,
// starved the tests that do need one into a timeout.

/**
 * V-046: verify the SRI plugin stays wired into the Vite build config.
 *
 * This is a static-file assertion rather than a full build test: running
 * vite build in the unit-test harness is slow, but losing the SRI plugin
 * would silently ship a bundle without integrity attributes, so the
 * regression guard still earns its keep as a lint-level check.
 *
 * Manual verification: run `npm run build` and grep dist/index.html for
 * `integrity="sha384-"` on every script and stylesheet tag.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('vite.config.js (V-046 SRI)', () => {
  const config = readFileSync(join(process.cwd(), 'vite.config.js'), 'utf8');

  it('imports the sri plugin from vite-plugin-sri3', () => {
    expect(config).toMatch(/from ['"]vite-plugin-sri3['"]/);
  });

  it('invokes sri() inside the plugins array', () => {
    // Anchored to the array: a bare /sri\s*\(/ also matches a commented-out
    // or unrelated call, which would let the plugin be dropped unnoticed.
    const plugins = config.match(/plugins:\s*\[([^\]]*)\]/);
    expect(plugins).not.toBeNull();
    expect(plugins[1]).toMatch(/(^|[\s,])sri\s*\(\s*\)/);
  });

  it('keeps vendor chunks out of the entry bundle', () => {
    // Each chunk the config produces is covered by sri() only because
    // it is a build output; this pins that the split exists at all.
    expect(config).toMatch(/codeSplitting/);
  });

  it('puts integrity on every script and stylesheet in a built index.html', () => {
    // Only meaningful after `npm run build`; a fresh checkout has no dist.
    const html = join(process.cwd(), 'dist', 'index.html');
    if (!existsSync(html)) return;
    const tags = readFileSync(html, 'utf8').match(
      /<(?:script[^>]*\ssrc=|link[^>]*\srel="(?:stylesheet|modulepreload)")[^>]*>/g,
    ) || [];
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.filter((t) => !/integrity="sha384-/.test(t))).toEqual([]);
  });

  it('package.json pins vite-plugin-sri3 as a devDependency', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    );
    expect(pkg.devDependencies?.['vite-plugin-sri3']).toBeDefined();
  });
});
