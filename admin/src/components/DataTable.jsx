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

export default function DataTable({
  columns,
  data,
  pagination,
  onPageChange,
  onRowClick,
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

  // These lists are heterogeneous: some carry `id`, some a `canonical_id`,
  // some nothing at all (the old table fell back to the array index).
  // antd deprecated the index argument to `rowKey`, so the position is
  // captured here instead of asked for at render time.
  const keyByRow = new Map();
  rows.forEach((row, index) => {
    if (!keyByRow.has(row)) keyByRow.set(row, row?.id ?? index);
  });

  const antColumns = columns.map((col, index) => {
    const isSortable = !!(col.sortable && onSort);
    return {
      // `key` is optional on these column definitions (the actions column
      // often has none), so fall back to the label and then the position.
      key: col.key || col.labelKey || col.label || `col-${index}`,
      title: heading(col),
      className: col.mono ? 'mono' : undefined,
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
        onRow={onRowClick
          ? (row) => ({ onClick: () => onRowClick(row), className: 'clickable' })
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
