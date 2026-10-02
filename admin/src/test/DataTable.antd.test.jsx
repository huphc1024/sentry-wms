/**
 * DataTable moved onto Ant Design's Table. The props are the contract
 * thirty-two pages depend on, so these cover the parts that the rewrite
 * could plausibly have changed underneath them.
 *
 * The sorting case is not hypothetical. antd owns a sorter cycle of
 * ascending -> descending -> unsorted and, on that third click, hands
 * onChange a sorter object with no columnKey. Reading the click out of
 * onChange therefore dropped every third one, and a list that these pages
 * expect to flip between ascending and descending forever got stuck
 * descending. Inventory, AuditLog and PickingTickets all sort this way.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import DataTable from '../components/DataTable.jsx';

const COLUMNS = [
  { key: 'sku', label: 'SKU', mono: true, sortable: true },
  { key: 'name', label: 'Name' },
  { key: 'qty', label: 'Qty', render: (r) => <b>{r.qty}</b> },
];

const ROWS = [
  { sku: 'TST-001', name: 'Elk Hair Caddis', qty: 4 },
  { sku: 'TST-002', name: 'Woolly Bugger', qty: 9 },
];

describe('DataTable on antd', () => {
  it('renders every column header and every row', () => {
    const { getByText } = render(<DataTable columns={COLUMNS} data={ROWS} />);
    ['SKU', 'Name', 'Qty'].forEach((h) => expect(getByText(h)).toBeInTheDocument());
    expect(getByText('TST-001')).toBeInTheDocument();
    expect(getByText('Woolly Bugger')).toBeInTheDocument();
    // A render function returning JSX still renders as JSX.
    expect(getByText('9').tagName).toBe('B');
  });

  it('shows the empty message rather than an empty body', () => {
    const { getByText } = render(
      <DataTable columns={COLUMNS} data={[]} emptyMessage="No items found" />
    );
    expect(getByText('No items found')).toBeInTheDocument();
  });

  it('calls onRowClick with the row behind the clicked cell', () => {
    const onRowClick = vi.fn();
    const { getByText } = render(
      <DataTable columns={COLUMNS} data={ROWS} onRowClick={onRowClick} />
    );
    fireEvent.click(getByText('TST-002'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
  });

  it('keeps flipping direction however many times the header is clicked', () => {
    // The harness is the sorting the real pages do: the parent owns
    // sortKey/sortDir and flips the direction on every click of the same
    // column (Inventory.handleSort, AuditLog, PickingTickets all do this).
    // A static parent would not reproduce the bug -- it is only once the
    // controlled order has actually moved to descending that antd's own
    // cycle reaches "unsorted" and reports a sorter with no columnKey.
    const seen = [];
    function Harness() {
      const [sortKey, setSortKey] = React.useState(null);
      const [sortDir, setSortDir] = React.useState('asc');
      seen.push(sortKey ? sortDir : null);
      return (
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(key) => {
            if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            else { setSortKey(key); setSortDir('asc'); }
          }}
        />
      );
    }

    const { getByText } = render(<Harness />);
    const header = getByText('SKU');
    const dirAfterEachClick = [];
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(header);
      dirAfterEachClick.push(seen[seen.length - 1]);
    }
    expect(dirAfterEachClick).toEqual(['asc', 'desc', 'asc', 'desc']);
  });

  it('leaves non-sortable headers inert', () => {
    const onSort = vi.fn();
    const { getByText } = render(
      <DataTable columns={COLUMNS} data={ROWS} sortKey="sku" sortDir="asc" onSort={onSort} />
    );
    fireEvent.click(getByText('Name'));
    expect(onSort).not.toHaveBeenCalled();
  });

  it('does not make headers sortable when the page passes no onSort', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={ROWS} />);
    expect(container.querySelector('.ant-table-column-has-sorters')).toBeNull();
  });

  it('pages through the envelope the API returns', () => {
    const onPageChange = vi.fn();
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        pagination={{ page: 2, pages: 4, total: 180, per_page: 50 }}
        onPageChange={onPageChange}
      />
    );
    const pager = container.querySelector('.ant-pagination');
    // 180 rows at 50 a page is four pages -- not the ten-a-page default
    // antd would assume if per_page were ignored.
    expect(within(pager).getByText('4')).toBeInTheDocument();
    fireEvent.click(within(pager).getByText('3'));
    expect(onPageChange).toHaveBeenCalledWith(3, 50);
  });

  it('derives a page size when the caller omits per_page', () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        pagination={{ page: 1, pages: 2, total: 4 }}
        onPageChange={() => {}}
      />
    );
    const pager = container.querySelector('.ant-pagination');
    expect(within(pager).getByText('2')).toBeInTheDocument();
    expect(within(pager).queryByText('3')).toBeNull();
  });

  it('offers CSV export beside the pager, and only with rows to export', () => {
    const { getByText, rerender } = render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        pagination={{ page: 1, pages: 1, total: 2, per_page: 50 }}
        onPageChange={() => {}}
      />
    );
    expect(getByText('Export CSV').closest('button')).toBeEnabled();

    rerender(
      <DataTable
        columns={COLUMNS}
        data={[]}
        pagination={{ page: 1, pages: 0, total: 0, per_page: 50 }}
        onPageChange={() => {}}
      />
    );
    expect(getByText('Export CSV').closest('button')).toBeDisabled();
  });

  it('hides the pager entirely when the page passes no pagination', () => {
    const { queryByText, container } = render(<DataTable columns={COLUMNS} data={ROWS} />);
    expect(container.querySelector('.ant-pagination')).toBeNull();
    expect(queryByText('Export CSV')).toBeNull();
  });
});
