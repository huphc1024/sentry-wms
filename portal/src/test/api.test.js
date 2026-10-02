import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, qs } from '../api.js';
import { friendlyError } from '../utils/friendlyError.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() { return this; },
  };
}

describe('portal api client', () => {
  beforeEach(() => {
    document.cookie = 'sentry_portal_csrf=portal-token-123; path=/';
    document.cookie = 'sentry_csrf=staff-token-456; path=/';
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true }));
  });

  it('prefixes every path with /api/portal', async () => {
    await api.get('/inventory');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/portal/inventory',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends the portal CSRF cookie on writes, never the staff one', async () => {
    await api.post('/orders', { lines: [] });
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers['X-CSRF-Token']).toBe('portal-token-123');
  });

  it('omits the CSRF header on reads', async () => {
    await api.get('/orders');
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('does not redirect on the /auth/me 401 that means "not signed in"', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401));
    const res = await api.get('/auth/me', { redirectOn401: false });
    expect(res.status).toBe(401);
  });

  it('drops empty query params', () => {
    expect(qs({ search: '', page: 2, status: undefined })).toBe('?page=2');
  });
});

describe('friendlyError', () => {
  it('echoes the offending sku, which came from the user own input', () => {
    expect(friendlyError({ error: 'Unknown sku', sku: 'ABC-1' })).toContain('ABC-1');
  });

  it('collapses an unmapped backend string to a generic message', () => {
    const message = friendlyError({ error: 'bin BIN-A1 is blocked for zone Z2' });
    expect(message).toBe('Đã xảy ra lỗi. Vui lòng thử lại.');
    expect(message).not.toContain('BIN-A1');
  });

  it('explains the multi-warehouse 400', () => {
    expect(friendlyError({ error: 'warehouse_code is required', choices: ['DN1', 'DN2'] }))
      .toContain('chọn kho');
  });
});
