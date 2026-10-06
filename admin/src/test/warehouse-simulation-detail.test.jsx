/**
 * The 2D simulation's bin detail and "attach pallet" flow, pinned after
 * they moved into components/simulation/ to be shared with the 3D view.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../i18n/locale.jsx';

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../api.js', () => ({
  api: {
    get: (...args) => getMock(...args),
    post: (...args) => postMock(...args),
  },
}));
vi.mock('../warehouse.jsx', () => ({
  useWarehouse: () => ({ warehouseId: 1, warehouse: { warehouse_id: 1, warehouse_name: 'Kho Test' } }),
}));

import WarehouseSimulation from '../pages/WarehouseSimulation.jsx';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

const MAP = {
  warehouse_id: 1,
  zones: [{ zone_id: 1, zone_code: 'PICK', zone_name: 'Pick zone', bin_count: 1, occupied_bins: 1, rack_count: 1, fill_pct: 100 }],
  racks: [],
  bins: [{
    bin_id: 1, bin_code: 'A-01-01', zone_id: 1, aisle: 'A', bay: '01', level: 1, position: 1,
    rack_key: '1|A|01', rack_label: 'A-001', total_qty: 12,
    contents: [
      { item_id: 7, sku: 'SKU-LOOSE', item_name: 'Loose item', lot_number: 'L1', quantity_on_hand: 4, pallet_id: null },
      { item_id: 8, sku: 'SKU-PAL', item_name: 'On pallet', quantity_on_hand: 8, pallet_id: 50 },
    ],
    pallets: [
      { pallet_id: 50, pallet_code: 'PL-50', sku: 'SKU-PAL', quantity_on_hand: 8 },
      { pallet_id: 51, pallet_code: 'PL-51', quantity_on_hand: 0, is_empty: true },
    ],
  }],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <WarehouseSimulation />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('WarehouseSimulation bin detail', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(() => ok(MAP));
    postMock.mockImplementation(() => ok({ pallet_id: 51 }));
  });

  it('shows pallets, empty pallets and loose stock, and attaches loose stock', async () => {
    const view = renderPage();
    fireEvent.click(await view.findByRole('button', { name: /Pick zone/ }));
    fireEvent.click(view.getByRole('button', { name: /A-001/ }));
    fireEvent.click(view.getByRole('button', { name: /Level 1/ }));
    fireEvent.click(view.getByRole('button', { name: /A-01-01/ }));

    const card = view.getByText('Bin A-01-01').closest('.sim2-detail-card');
    expect(within(card).getByText('PL-50')).toBeInTheDocument();
    expect(within(card).getByText('PL-51')).toBeInTheDocument();
    expect(within(card).getByText('SKU-LOOSE')).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'Open 3D view' })).toHaveAttribute('href', '/warehouse-3d');

    fireEvent.click(view.getByRole('button', { name: 'Attach pallet' }));
    expect(view.getByText('Attach pallet · SKU-LOOSE')).toBeInTheDocument();
    // Defaults: the bin's first empty pallet and the row's whole quantity.
    expect(document.querySelector('select.form-select')).toHaveValue('51');
    expect(document.querySelector('input[type="number"][max]')).toHaveValue(4);
    const buttons = view.getAllByRole('button', { name: 'Attach pallet' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      '/admin/pallets/51/attach-inventory',
      { item_id: 7, bin_id: 1, lot_number: 'L1', quantity: 4 },
      { silentPermissionDenied: true },
    ));
    await waitFor(() => expect(view.queryByText('Attach pallet · SKU-LOOSE')).not.toBeInTheDocument());
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
