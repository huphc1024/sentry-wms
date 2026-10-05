import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../i18n/locale.jsx';

const getMock = vi.fn();
const postMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('../api.js', () => ({
  api: {
    get: (...args) => getMock(...args),
    post: (...args) => postMock(...args),
    put: (...args) => putMock(...args),
    delete: (...args) => deleteMock(...args),
  },
}));

import CustomerUsers from '../pages/CustomerUsers.jsx';

const ok = (body) => Promise.resolve({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

const fail = (status, body) => Promise.resolve({
  ok: false,
  status,
  json: () => Promise.resolve(body),
});

const CUSTOMERS = {
  customers: [
    { customer_id: 'cust-a', customer_code: 'C-A', customer_name: 'Alpha', is_active: true },
    { customer_id: 'cust-b', customer_code: 'C-B', customer_name: 'Bravo', is_active: true },
    { customer_id: 'cust-x', customer_code: 'C-X', customer_name: 'Gone', is_active: false },
  ],
};

const PORTAL_USERS = {
  customer_users: [{
    customer_user_id: 7,
    customer_id: 'cust-a',
    customer_code: 'C-A',
    customer_name: 'Alpha',
    username: 'alpha-user',
    full_name: 'Alpha Person',
    email: 'a@example.com',
    is_active: true,
    must_change_password: false,
    feature_keys: ['inventory'],
    last_login: null,
  }],
};

function renderPage() {
  return render(
    <LocaleProvider>
      <CustomerUsers />
    </LocaleProvider>,
  );
}

describe('CustomerUsers page', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    deleteMock.mockReset();
    getMock.mockImplementation((path) => {
      if (path.startsWith('/admin/customer-users?')) return ok(PORTAL_USERS);
      if (path === '/admin/customers') return ok(CUSTOMERS);
      if (path.includes('/features')) {
        return ok({
          customer_user_id: 7,
          feature_keys: ['inventory'],
          all_feature_keys: ['inventory', 'orders', 'inbound', 'invoices', 'reports'],
        });
      }
      return ok({});
    });
  });

  it('lists portal accounts with their customer and grants', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    expect(screen.getByText('C-A · Alpha')).toBeTruthy();
    expect(screen.getByText('See their own stock')).toBeTruthy();
  });

  it('offers only active customers when provisioning', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByText('Add account'));

    const select = await screen.findByLabelText('Customer *');
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('cust-a');
    expect(values).toContain('cust-b');
    // An inactive customer must not be offered: provisioning a login
    // against it would grant access to a relationship that has ended.
    expect(values).not.toContain('cust-x');
  });

  it('defaults a new account to forced password change', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByText('Add account'));

    const forced = await screen.findByLabelText(
      /Force a password change on first sign-in/,
    );
    expect(forced.checked).toBe(true);
  });

  it('creates an account with the selected grants', async () => {
    postMock.mockReturnValue(ok({ customer_user_id: 8 }));
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByText('Add account'));

    fireEvent.change(await screen.findByLabelText('Customer *'), {
      target: { value: 'cust-b' },
    });
    fireEvent.change(screen.getByLabelText('Username *'), {
      target: { value: 'bravo-user' },
    });
    fireEvent.change(screen.getByLabelText('Full name *'), {
      target: { value: 'Bravo Person' },
    });
    fireEvent.change(screen.getByLabelText('Password *'), {
      target: { value: 'portal-pw-1' },
    });
    fireEvent.click(screen.getByLabelText('Outbound orders & status'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const [path, body] = postMock.mock.calls[0];
    expect(path).toBe('/admin/customer-users');
    expect(body.customer_id).toBe('cust-b');
    expect(body.feature_keys).toEqual(['orders']);
    expect(body.must_change_password).toBe(true);
  });

  it('never sends customer_id when editing an existing account', async () => {
    putMock.mockReturnValue(ok({ customer_user_id: 7 }));
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByText('Edit'));

    fireEvent.change(await screen.findByLabelText('Full name *'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [, body] = putMock.mock.calls[0];
    // The PUT endpoint forbids unknown fields, so sending customer_id
    // would turn every edit into a 400. It is also not a thing an
    // operator may change: see the page's save() comment.
    expect(body).not.toHaveProperty('customer_id');
    expect(body.full_name).toBe('Renamed');
  });

  it('omits the password field when the operator leaves it blank', async () => {
    putMock.mockReturnValue(ok({ customer_user_id: 7 }));
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(await screen.findByText('Save'));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [, body] = putMock.mock.calls[0];
    expect(body).not.toHaveProperty('password');
  });

  it('renders the feature checkboxes from the server catalogue', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Access' }));

    // 'reports' has a label locally, but the point is that the list comes
    // from all_feature_keys so a key added server-side still appears.
    await waitFor(() => expect(screen.getByText('Reports')).toBeTruthy());
    const inventory = screen.getByLabelText('See their own stock');
    expect(inventory.checked).toBe(true);
  });

  it('can revoke every grant', async () => {
    putMock.mockReturnValue(ok({ feature_keys: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Access' }));

    const inventory = await screen.findByLabelText('See their own stock');
    fireEvent.click(inventory);
    fireEvent.click(screen.getByText('Save access'));

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [path, body] = putMock.mock.calls[0];
    expect(path).toBe('/admin/customer-users/7/features');
    expect(body.feature_keys).toEqual([]);
  });

  it('surfaces the unknown-key detail from a rejected grant save', async () => {
    putMock.mockReturnValue(
      fail(400, { error: 'Unknown feature_key(s)', unknown: ['bogus'] }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Access' }));
    fireEvent.click(await screen.findByText('Save access'));

    await waitFor(() => expect(
      screen.getByText(/Unknown feature_key\(s\): bogus/),
    ).toBeTruthy());
  });

  it('deactivates rather than deleting', async () => {
    deleteMock.mockReturnValue(ok({ is_active: false }));
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByText('Stopped'));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(
      '/admin/customer-users/7',
    ));
  });

  it('requires a customer before saving', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alpha-user')).toBeTruthy());
    fireEvent.click(screen.getByText('Add account'));
    fireEvent.click(await screen.findByText('Save'));

    await waitFor(() => expect(screen.getByText('A customer is required')).toBeTruthy());
    expect(postMock).not.toHaveBeenCalled();
  });
});
