/**
 * Tabbed dashboard: Overview and Sales tabs against the
 * /admin/dashboard/overview and /admin/dashboard/sales contract.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// jsdom has no layout, so ResponsiveContainer measures 0x0 and renders
// nothing. Hand the chart a fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => React.cloneElement(children, { width: 500, height: 240 }),
  };
});

const apiGetMock = vi.fn();
vi.mock('../api.js', () => ({
  api: {
    get: (...a) => apiGetMock(...a),
    put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  },
}));
vi.mock('../warehouse.jsx', () => ({ useWarehouse: () => ({ warehouseId: 7 }) }));
vi.mock('../auth.jsx', () => ({
  useAuth: () => ({ user: { role: 'ADMIN', allowed_overrides: [] } }),
}));

import Dashboard from '../pages/Dashboard.jsx';

const json = (body, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const OVERVIEW = {
  kpis: {
    orders_open: 12, orders_picked: 3, orders_packed: 4, orders_shipped_today: 9,
    backorders: 2, low_stock_items: 5, near_expiry_units: 40, expired_units: 6,
    pending_variances: 1, open_po_lines: 8, inbound_expected_units: 1200,
  },
  series: {
    orders_created: [{ date: '2026-10-01', value: 3 }, { date: '2026-10-02', value: 5 }],
    orders_shipped: [{ date: '2026-10-01', value: 2 }, { date: '2026-10-02', value: 4 }],
    received_units: [{ date: '2026-10-01', value: 100 }],
  },
  status_breakdown: [{ status: 'OPEN', count: 12 }, { status: 'SHIPPED', count: 30 }],
  stock_by_zone: [{ zone_code: 'A', zone_name: 'Zone A', units: 500 }],
};

const SALES = {
  kpis: {
    revenue: 54321, orders: 77, avg_order_value: 705, cancelled_orders: 3, invoiced: 60, unpaid: 11,
  },
  series: { revenue: [{ date: '2026-10-01', value: 1000 }, { date: '2026-10-02', value: 2000 }] },
  by_channel: [
    { channel: 'Amazon', orders: 40, revenue: 30000 },
    { channel: 'eBay', orders: 37, revenue: 24321 },
  ],
  top_items: [{ sku: 'SKU-TOP-1', name: 'Widget Prime', quantity: 90, revenue: 9000 }],
};

function wire(overrides = {}) {
  apiGetMock.mockImplementation((path = '') => {
    if (path.startsWith('/admin/dashboard/overview')) return overrides.overview ?? json(OVERVIEW);
    if (path.startsWith('/admin/dashboard/sales')) return overrides.sales ?? json(SALES);
    if (path.startsWith('/admin/ai/status')) return json({ enabled: true });
    return json({});
  });
}

const renderDash = () => render(<MemoryRouter><Dashboard /></MemoryRouter>);
const calls = (prefix) => apiGetMock.mock.calls.filter(([p]) => p.startsWith(prefix));

describe('Dashboard tabs', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    wire();
  });

  it('opens on Overview and renders KPIs, charts and AI panels', async () => {
    const view = renderDash();
    const open = await view.findByTestId('kpi-orders_open');
    expect(within(open).getByText('12')).toBeInTheDocument();
    expect(view.getByTestId('kpi-inbound_expected_units')).toHaveTextContent('1,200');
    expect(view.getByText('Orders created vs shipped')).toBeInTheDocument();
    expect(view.getByText('Stock by zone')).toBeInTheDocument();
    expect(view.getByText('AI suggestions: replenishment')).toBeInTheDocument();
    expect(view.getByText('AI suggestions: expiry actions')).toBeInTheDocument();
    // Recharts drew real SVG for the series.
    expect(view.container.querySelector('.recharts-area')).not.toBeNull();
    expect(view.container.querySelector('.recharts-bar')).not.toBeNull();

    const [path] = calls('/admin/dashboard/overview')[0];
    expect(path).toContain('warehouse_id=7');
    expect(path).toContain('days=7');
    // Sales is not fetched until its tab is opened.
    expect(calls('/admin/dashboard/sales')).toHaveLength(0);
  });

  it('refetches when the range changes (7/14/30 only)', async () => {
    const view = renderDash();
    await view.findByTestId('kpi-orders_open');
    expect(view.queryByRole('button', { name: 'Last 90 days' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Last 30 days' }));
    await waitFor(() => {
      expect(calls('/admin/dashboard/overview').some(([p]) => p.includes('days=30'))).toBe(true);
    });
  });

  it('shows an error when the overview request fails', async () => {
    wire({ overview: json({ error: 'x' }, 500) });
    const view = renderDash();
    expect(await view.findByText('Could not load dashboard data.')).toBeInTheDocument();
  });

  it('Sales tab shows KPIs, channel split, top items and offers 90 days', async () => {
    const view = renderDash();
    await view.findByTestId('kpi-orders_open');
    fireEvent.click(view.getByRole('tab', { name: 'Sales' }));
    const revenue = await view.findByTestId('kpi-revenue');
    expect(revenue).toHaveTextContent('54,321');
    expect(view.getByTestId('kpi-unpaid')).toHaveTextContent('11');
    expect(view.getByText('SKU-TOP-1')).toBeInTheDocument();
    expect(view.getByText('Widget Prime')).toBeInTheDocument();
    expect(view.getByText('Revenue by channel')).toBeInTheDocument();

    const [path] = calls('/admin/dashboard/sales')[0];
    expect(path).toContain('days=30');
    fireEvent.click(view.getByRole('button', { name: 'Last 90 days' }));
    await waitFor(() => {
      expect(calls('/admin/dashboard/sales').some(([p]) => p.includes('days=90'))).toBe(true);
    });
  });

  it('keeps the Productivity tab reachable', async () => {
    const view = renderDash();
    await view.findByTestId('kpi-orders_open');
    fireEvent.click(view.getByRole('tab', { name: 'Productivity' }));
    expect(await view.findByText('Local Pickup')).toBeInTheDocument();
  });
});
