import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.jsx';
import { AuthProvider } from '../auth.jsx';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() { return this; },
  };
}

/**
 * Stub the four list endpoints plus /auth/me. The lists answer empty so
 * these tests are about the shell (nav, guards, feature gates) rather
 * than about rendering rows.
 */
function stubApi(account) {
  globalThis.fetch = vi.fn(async (url) => {
    if (url.startsWith('/api/portal/auth/me')) return jsonResponse(account);
    if (url.startsWith('/api/portal/inventory')) {
      return jsonResponse({ page: 1, page_size: 5, total: 0, items: [] });
    }
    if (url.startsWith('/api/portal/orders')) {
      return jsonResponse({ page: 1, page_size: 5, total: 0, orders: [] });
    }
    if (url.startsWith('/api/portal/inbound')) {
      return jsonResponse({ page: 1, page_size: 5, total: 0, purchase_orders: [] });
    }
    if (url.startsWith('/api/portal/invoices')) {
      return jsonResponse({ page: 1, page_size: 3, total: 0, invoices: [] });
    }
    return jsonResponse({ error: 'Not Found' }, 404);
  });
}

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const BASE_ACCOUNT = {
  customer_user_id: 7,
  username: 'acme-ops',
  full_name: 'Acme Ops',
  customer_id: 'c0000000-0000-0000-0000-000000000001',
  customer_name: 'Acme Vietnam',
  customer_code: 'ACME',
  features: ['orders'],
  must_change_password: false,
};

describe('portal shell', () => {
  beforeEach(() => {
    document.cookie = 'sentry_portal_csrf=portal-token-123; path=/';
  });

  it('shows only the nav entries the account holds a grant for', async () => {
    stubApi(BASE_ACCOUNT);
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Đơn xuất' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tồn kho' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Hóa đơn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Hàng nhập' })).not.toBeInTheDocument();
  });

  it('explains an ungranted feature instead of loading the page', async () => {
    stubApi(BASE_ACCOUNT);
    renderApp('/inventory');
    expect(await screen.findByRole('heading', { name: 'Chưa được cấp quyền' })).toBeInTheDocument();
    // And it never asked the API for data it knows the caller cannot read.
    expect(globalThis.fetch.mock.calls.every(([url]) => !url.startsWith('/api/portal/inventory')))
      .toBe(true);
  });

  it('holds a forced-change account on the change-password screen', async () => {
    stubApi({ ...BASE_ACCOUNT, must_change_password: true });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Đổi mật khẩu' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('phải đổi mật khẩu');
  });

  it('sends an unauthenticated visitor to the login screen', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401));
    renderApp('/orders');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    });
  });

  it('renders the customer identity in the top bar', async () => {
    stubApi(BASE_ACCOUNT);
    renderApp('/');
    expect(await screen.findByText('Acme Vietnam')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
  });
});
