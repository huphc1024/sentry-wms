import { Button, Pagination, Table } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useLocale } from '../i18n/locale.jsx';
import { downloadCsv } from '../utils/exportCsv.js';

/**
 * The app's list table, now an Ant Design table underneath.
 *
 * Thirty-two pages render this component, so the props are unchanged:
 * `columns` still carry `{key, label, render, mono, sortable, csvValue}`,
 * sorting is still delegated upward through `onSort` (the server does the
 * ordering, not the browser), pagination is still the `{page, pages,
 * total, per_page}` envelope the API returns, and CSV export still sits
 * beside the pager.
 *
 * Sorting deserves a note. antd's own sorter would cycle
 * ascending -> descending -> unsorted and manage that state itself, which
 * is not what these pages do: the parent owns `sortKey`/`sortDir` and
 * decides what a click means. So antd draws the arrows from a `sortOrder`
 * that is entirely derived from the props, while the click itself is taken
 * off the header cell and handed straight to `onSort`. The arrows then
 * always show what the parent actually asked the server for.
 */

function toSortOrder(dir) {
  return dir === 'asc' ? 'ascend' : 'descend';
}

// An operator selecting text in a cell to copy an SO
// number or a SKU fired the row handler, which on some pages meant a
// navigation. Two things fix it, and both are here:
//
//   clickColumn  names the ONE column that opens the record, so the target
//                is discoverable and the rest of the row is free to select.
//                Opt-in: pages that do not set it keep whole-row clicking.
//   the guard    ignores any row click made while a selection exists, which
//                covers every page including the ones still using whole-row
//                clicking.
//
// A drag that ends inside a cell leaves a non-empty selection, so this
// distinguishes "finished selecting text" from "clicked".
function hasTextSelection() {
  if (typeof window === 'undefined' || !window.getSelection) return false;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && String(sel).trim().length > 0;
}

// Rows used to be keyed `row.id || i`. No admin list payload
// carries a bare `id`, so every table in the admin fell through to the array
// index and React reconciled rows by position. A row removed from the middle
// of the list shifted every row below it up one index, and any cell holding
// state was handed a different record's props without remounting. Fraud
// Review's memo box was where that surfaced: the CSR's typed note stayed put
// on screen while the order under it changed, so an edit-in-place wrote the
// note onto the wrong sales order.
//
// `rowKey` names what identifies a row: a field name, or a function for the
// tables whose rows have no single id column.
//
// Returns undefined when the row cannot be identified, so the caller can tell
// a real key apart from the index it substitutes. Resolving straight to the
// index here would hide a rowKey that silently misses on some rows.
function resolveRowKey(rowKey, row) {
  if (typeof rowKey === 'function') return rowKey(row);
  if (typeof rowKey === 'string') {
    const value = row?.[rowKey];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

// A wrong rowKey is worse than no rowKey: duplicate keys make React drop or
// merge rows outright, where an index at least renders. Both guards below are
// dev-only, so they cost nothing in the built bundle, and they fire in the
// test run -- which is the point, since that is where a bad key on a page
// nobody opened this week gets caught.
function warnOnBadKeys(resolved, rowKey, columns) {
  if (!import.meta.env?.DEV) return;
  const where = columns?.map((c) => c.label).filter(Boolean).join(', ');
  if (rowKey === undefined) {
    console.warn(`DataTable: no rowKey given, falling back to array index. Columns: ${where}`);
    return;
  }
  if (resolved.some((k) => k === undefined)) {
    const named = typeof rowKey === 'string' ? `"${rowKey}"` : 'function';
    console.warn(`DataTable: rowKey ${named} did not resolve on every row. Columns: ${where}`);
  }
  const present = resolved.filter((k) => k !== undefined);
  if (new Set(present).size !== present.length) {
    console.warn(`DataTable: rowKey produced duplicate keys. Columns: ${where}`);
  }
}

export default function DataTable({
  columns,
  data,
  rowKey,
  pagination,
  onPageChange,
  onRowClick,
  clickColumn,
  emptyMessage,
  emptyMessageKey,
  sortKey,
  sortDir,
  onSort,
}) {
  const { t } = useLocale();

  // Headings and the empty state are named with keys (`labelKey`,
  // `emptyMessageKey`). A plain `label` / `emptyMessage` is shown as given.
  const heading = (col) => (col.labelKey ? t(col.labelKey) : col.label);
  const empty = emptyMessageKey
    ? t(emptyMessageKey)
    : (emptyMessage || t('common.noRecords'));
  const rows = data || [];

  // Rows are keyed by the page's `rowKey` (a field name or a function);
  // a row it cannot identify falls back to its position. antd deprecated
  // the index argument to its own `rowKey`, so the position is captured
  // here instead of asked for at render time.
  const resolvedKeys = rows.map((row) => resolveRowKey(rowKey, row));
  if (rows.length > 0) warnOnBadKeys(resolvedKeys, rowKey, columns);
  const keyByRow = new Map();
  rows.forEach((row, index) => {
    if (!keyByRow.has(row)) keyByRow.set(row, resolvedKeys[index] ?? index);
  });

  // With clickColumn set the row itself is inert and the named cell
  // carries the handler; without it the whole row stays clickable.
  const activate = (row) => {
    if (hasTextSelection()) return;
    onRowClick?.(row);
  };

  const antColumns = columns.map((col, index) => {
    const isSortable = !!(col.sortable && onSort);
    return {
      // `key` is optional on these column definitions (the actions column
      // often has none), so fall back to the label and then the position.
      key: col.key || col.labelKey || col.label || `col-${index}`,
      title: heading(col),
      className: col.mono ? 'mono' : undefined,
      onCell: onRowClick && clickColumn && (col.key || col.label) === clickColumn
        ? (row) => ({ className: 'cell-clickable', onClick: () => activate(row) })
        : undefined,
      width: col.width,
      sorter: isSortable,
      sortOrder: isSortable && sortKey === col.key ? toSortOrder(sortDir) : null,
      showSorterTooltip: false,
      // The click is taken here rather than read out of antd's onChange.
      // antd cycles a column ascending -> descending -> unsorted and, on
      // that third click, reports a sorter with no columnKey at all -- so
      // routing through onChange silently dropped every third click and
      // the list appeared stuck in descending order. The parent owns the
      // direction, so it just needs to hear that the column was clicked.
      onHeaderCell: isSortable ? () => ({ onClick: () => onSort(col.key) }) : undefined,
      render: col.render ? (_, row) => col.render(row) : (_, row) => row[col.key],
    };
  });

  // The API envelope always carries `per_page`, but a few callers build
  // the envelope by hand and leave it out. Deriving it from the page count
  // keeps the pager honest instead of silently falling back to antd's
  // default of ten rows a page.
  const perPage = pagination
    ? pagination.per_page
      || (pagination.pages ? Math.ceil((pagination.total || 0) / pagination.pages) : 0)
      || rows.length
      || 1
    : 0;

  return (
    <div className="data-table-wrapper">
      <Table
        rowKey={(row) => keyByRow.get(row)}
        columns={antColumns}
        dataSource={rows}
        pagination={false}
        size="middle"
        locale={{ emptyText: empty }}
        onRow={onRowClick && !clickColumn
          ? (row) => ({ onClick: () => activate(row), className: 'clickable' })
          : undefined}
      />
      {pagination && (
        <div className="pagination">
          <Button
            size="small"
            icon={<DownloadOutlined />}
            disabled={rows.length === 0}
            onClick={() => downloadCsv(columns, rows, heading)}
          >
            {t('common.exportCsv')}
          </Button>
          <Pagination
            current={pagination.page}
            pageSize={perPage}
            total={pagination.total || 0}
            showSizeChanger={false}
            onChange={onPageChange}
            size="small"
            showTotal={() => t('table.pageOf', {
              page: pagination.page,
              pages: pagination.pages,
              total: pagination.total,
            })}
          />
        </div>
      )}
    </div>
  );
}
