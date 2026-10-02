import { Pagination as AntPagination } from 'antd';

/**
 * Page stepper for the portal lists, now antd's pager underneath.
 *
 * Every portal list endpoint returns {page, page_size, total}, so the
 * control is still driven off that alone -- no per-page "has more"
 * probe -- and it still disappears entirely when everything fits on one
 * page. What the customer gains over the old prev/next pair is being
 * able to jump: a hundred invoices took fifty clicks to reach the end of.
 */
export default function Pagination({ page, pageSize, total, onChange }) {
  if ((total || 0) <= (pageSize || 0)) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="pagination">
      <span className="text-muted">
        {from}–{to} / {total}
      </span>
      <AntPagination
        current={page}
        pageSize={pageSize || 1}
        total={total || 0}
        showSizeChanger={false}
        size="small"
        onChange={onChange}
      />
    </div>
  );
}
