import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { t } from '../i18n/translate.js';
import { friendlyErrorFromResponse } from '../utils/friendlyError.js';

/**
 * Fetch one page of a portal list endpoint.
 *
 * All four list endpoints share the {page, page_size, total, <items>}
 * envelope, so one hook covers them; `key` names the array field
 * ('items', 'orders', 'purchase_orders', 'invoices').
 *
 * `filters` is spread into the query string. Pass a memo-stable object
 * (or a primitive-keyed one built inline -- it is serialised before use,
 * so a fresh object with the same values does not refetch).
 */
export default function usePagedList(path, key, filters = {}, pageSize = 50) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const serialised = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = { ...JSON.parse(serialised), page, page_size: pageSize };
    const res = await api.get(`${path}${qs(params)}`);
    // A redirect-on-401 already navigated away; res is undefined.
    if (!res) return;
    if (!res.ok) {
      setRows([]);
      setTotal(0);
      setError(await friendlyErrorFromResponse(res, t('common.error.loadFailed')));
      setLoading(false);
      return;
    }
    const data = await res.json();
    setRows(data[key] || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [path, key, serialised, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  // Filter changes must reset paging: staying on page 4 of a narrowed
  // result set shows an empty table that looks like "no data".
  useEffect(() => { setPage(1); }, [serialised]);

  return { rows, total, page, setPage, pageSize, loading, error, reload: load };
}
