import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The portal is a separate workspace so that "a customer sees only its
 * own data" is a property of the architecture rather than of every page
 * being written carefully. These tests pin the two halves of that:
 * this bundle talks to /api/portal and to nothing else, and it reads the
 * portal session cookie rather than the staff one.
 *
 * A failure here is not a lint nit. Reaching a staff endpoint from this
 * bundle would either 401 (best case) or, if that endpoint is ever
 * mis-gated, serve an operator's cross-tenant view to a customer.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx)$/.test(path) && !path.includes('test') ? [path] : [];
  });
}

/** Comments are prose -- api.js documents which staff cookie it does NOT
 *  read, and that sentence should not fail the check that enforces it. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = sourceFiles(SRC).map((path) => ({
  path,
  body: stripComments(readFileSync(path, 'utf8')),
}));

describe('portal bundle isolation', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('addresses no staff API surface', () => {
    const offenders = files
      .filter(({ body }) => /['"`]\/api\/(admin|auth|v1)\b/.test(body))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('reads the portal cookie, never the staff one', () => {
    const offenders = files
      .filter(({ body }) => /sentry_csrf|sentry_auth\b/.test(body))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('routes every request through the shared client', () => {
    // A bare fetch() would bypass the /api/portal prefix, the CSRF
    // header and the 401 handling in src/api.js.
    const offenders = files
      .filter(({ path, body }) => !path.endsWith(join('src', 'api.js'))
        && /(?<![\w.])fetch\s*\(/.test(body))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
