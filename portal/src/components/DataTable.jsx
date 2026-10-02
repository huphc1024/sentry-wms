import { Table } from 'antd';
import { useLocale } from '../i18n/locale.jsx';

/**
 * Read-only list for the portal, now an Ant Design table underneath.
 *
 * The props are unchanged -- `columns: [{key, label, render?, align?,
 * mono?}]`, `rows`, `rowKey`, `loading`, `empty`, `onRowClick` -- because
 * ten pages render this and none of them should have to change to get
 * the new look.
 *
 * It stays deliberately smaller than the admin panel's table: no CSV
 * export, no sorting, no pagination built in (the portal drives that
 * from its own Pagination component, because the list endpoints return
 * `{page, page_size, total}` and the page owns that state). A customer
 * surface should not grow operator tools by accident.
 */
export default function DataTable({
  columns, rows, rowKey, loading, empty, onRowClick,
}) {
  const { t } = useLocale();
  const list = rows || [];

  // `rowKey` here is a function of (row, index) -- antd's prop of the
  // same name no longer takes an index, so the keys are worked out up
  // front and looked up by row.
  const keyByRow = new Map();
  list.forEach((row, index) => {
    if (!keyByRow.has(row)) keyByRow.set(row, rowKey ? rowKey(row, index) : index);
  });

  const antColumns = columns.map((c) => ({
    key: c.key,
    title: c.label,
    align: c.align === 'right' ? 'right' : undefined,
    className: c.mono ? 'mono' : undefined,
    render: (_, row) => (c.render ? c.render(row) : (row[c.key] ?? '—')),
  }));

  return (
    <div className="table-wrap">
      <Table
        rowKey={(row) => keyByRow.get(row)}
        columns={antColumns}
        dataSource={list}
        loading={loading}
        pagination={false}
        size="middle"
        locale={{ emptyText: empty || t('chrome.table.empty') }}
        onRow={onRowClick
          ? (row) => ({ onClick: () => onRowClick(row), className: 'row-clickable' })
          : undefined}
      />
    </div>
  );
}
