/**
 * DataTable and Pagination moved onto Ant Design. Ten pages render them,
 * so what is pinned here is the props contract those pages rely on, not
 * antd's own behaviour.
 *
 * The portal's table is deliberately the smaller of the two in this
 * repo: no CSV export, no sorting, no built-in pager. A customer surface
 * that quietly grew operator tools would be a worse outcome than an
 * ugly one.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';

const COLUMNS = [
  { key: 'so_number', label: 'Số đơn', mono: true },
  { key: 'status', label: 'Trạng thái' },
  { key: 'total', label: 'Tổng', align: 'right', render: (r) => `${r.total} đ` },
];

const ROWS = [
  { so_number: 'SO-001', status: 'OPEN', total: 120000 },
  { so_number: 'SO-002', status: 'SHIPPED', total: 340000 },
];

describe('portal DataTable', () => {
  it('renders the headers and the rows', () => {
    const { getByText } = render(<DataTable columns={COLUMNS} rows={ROWS} />);
    ['Số đơn', 'Trạng thái', 'Tổng'].forEach((h) => expect(getByText(h)).toBeInTheDocument());
    expect(getByText('SO-002')).toBeInTheDocument();
    expect(getByText('120000 đ')).toBeInTheDocument();
  });

  it('falls back to an em dash for a missing value, as the old table did', () => {
    const { getByText } = render(
      <DataTable columns={COLUMNS} rows={[{ so_number: 'SO-003', total: 0 }]} />
    );
    expect(getByText('—')).toBeInTheDocument();
  });

  it('shows the caller\'s empty message', () => {
    const { getByText } = render(
      <DataTable columns={COLUMNS} rows={[]} empty="Chưa có đơn nào." />
    );
    expect(getByText('Chưa có đơn nào.')).toBeInTheDocument();
  });

  it('shows a default empty message when the caller gives none', () => {
    const { getByText } = render(<DataTable columns={COLUMNS} rows={[]} />);
    expect(getByText('Không có dữ liệu.')).toBeInTheDocument();
  });

  it('passes the clicked row back', () => {
    const onRowClick = vi.fn();
    const { getByText } = render(
      <DataTable columns={COLUMNS} rows={ROWS} onRowClick={onRowClick} />
    );
    fireEvent.click(getByText('SO-001'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('keys rows through the caller\'s rowKey', () => {
    // The old table took rowKey(row, index); antd's prop of the same name
    // no longer passes an index, so the keys are resolved before render.
    const rowKey = vi.fn((r) => r.so_number);
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} />);
    expect(rowKey).toHaveBeenCalledWith(ROWS[0], 0);
    expect(rowKey).toHaveBeenCalledWith(ROWS[1], 1);
  });

  it('stays read-only: no export, no sorting', () => {
    const { container, queryByText } = render(<DataTable columns={COLUMNS} rows={ROWS} />);
    expect(queryByText(/CSV/i)).toBeNull();
    expect(container.querySelector('.ant-table-column-has-sorters')).toBeNull();
  });
});

describe('portal Pagination', () => {
  it('hides itself when everything fits on one page', () => {
    const { container } = render(
      <Pagination page={1} pageSize={20} total={12} onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the range and reports the page the customer picked', () => {
    const onChange = vi.fn();
    const { container, getByText } = render(
      <Pagination page={2} pageSize={20} total={95} onChange={onChange} />
    );
    expect(getByText('21–40 / 95')).toBeInTheDocument();
    const pager = container.querySelector('.ant-pagination');
    // 95 at 20 a page is five pages -- the customer can jump, which the
    // old prev/next pair could not do.
    expect(within(pager).getByText('5')).toBeInTheDocument();
    fireEvent.click(within(pager).getByText('4'));
    expect(onChange).toHaveBeenCalledWith(4, 20);
  });

  it('clamps the range label on the last, partial page', () => {
    const { getByText } = render(
      <Pagination page={5} pageSize={20} total={95} onChange={() => {}} />
    );
    expect(getByText('81–95 / 95')).toBeInTheDocument();
  });
});
