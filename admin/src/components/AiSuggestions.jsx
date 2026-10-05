import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLocale } from '../i18n/locale.jsx';
import { friendlyError } from '../utils/friendlyError.js';

const PRIORITY_TAG = { high: 'tag-danger', medium: 'tag-warning', low: 'tag-gray' };
const ACTIONS = [
  'reorder', 'ship_first', 'discount', 'dispose', 'recount', 'investigate', 'none',
  'put_away', 'release', 'wait_po', 'transfer', 'partial_ship', 'create_po',
];

const chipStyle = {
  display: 'inline-block',
  padding: '1px 8px',
  fontSize: 11,
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text-secondary)',
};

/**
 * Collapsed-by-default panel that asks the backend for advisory
 * suggestions. Nothing is requested until the user clicks; the only
 * call on mount is the cheap status probe, which hides the panel when
 * the feature is off.
 *
 * `request` is `{ path, body }` or a function returning that; `lang`
 * is added to the body here so pages do not have to.
 */
export default function AiSuggestions({ kind, request, warehouseId, className }) {
  const { t, locale } = useLocale();
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [ratings, setRatings] = useState({});
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/admin/ai/status', { silentPermissionDenied: true });
        if (!res?.ok) return;
        const data = await res.json();
        if (!cancelled && data?.enabled === false) setEnabled(false);
      } catch { /* probe is best effort; keep the panel */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!enabled) return null;

  async function generate() {
    const spec = typeof requestRef.current === 'function' ? requestRef.current() : requestRef.current;
    if (!spec?.path) return;
    setLoading(true);
    setError(null);
    setRatings({});
    try {
      const res = await api.post(spec.path, { ...(spec.body || {}), lang: locale });
      if (res?.ok) {
        setResult(await res.json());
      } else {
        const body = await res?.json?.().catch(() => null);
        setResult(null);
        if (res?.status === 503 && body?.error === 'ai_disabled') setError(t('ai.disabled'));
        else if (res?.status === 403) setError(t('errors.noPermission'));
        else if (res?.status === 429) setError(t('ai.rateLimited'));
        else setError(friendlyError(body));
      }
    } catch (e) {
      setResult(null);
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  async function rate(suggestion, rating) {
    setRatings((prev) => ({ ...prev, [suggestion.id]: rating }));
    try {
      await api.post('/admin/ai/feedback', {
        suggestion_id: suggestion.id,
        kind,
        mode: result?.mode,
        rating,
        ...(warehouseId ? { warehouse_id: warehouseId } : {}),
      });
    } catch { /* feedback is best effort */ }
  }

  const suggestions = result?.suggestions || [];
  const mode = result?.mode;

  return (
    <div className={`card${className ? ` ${className}` : ''}`} style={{ marginBottom: 16 }}>
      <button
        type="button"
        className="btn btn-sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ fontWeight: 600 }}
      >
        {open ? '▾ ' : '▸ '}{t('ai.title')}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={generate} disabled={loading}>
              {t(loading ? 'ai.generating' : (result ? 'ai.refresh' : 'ai.generate'))}
            </button>
            {mode && (
              <span
                className={`tag ${mode === 'llm' ? 'tag-purple' : 'tag-gray'}`}
                title={t(mode === 'llm' ? 'ai.modeLlmHint' : 'ai.modeRulesHint')}
              >
                {t(mode === 'llm' ? 'ai.modeLlm' : 'ai.modeRules')}
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('ai.disclaimer')}</span>
          </div>

          {error && (
            <p role="status" style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>{error}</p>
          )}

          {result && !error && suggestions.length === 0 && (
            <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>{t('ai.empty')}</p>
          )}

          {suggestions.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
              {suggestions.map((s) => {
                const rated = ratings[s.id];
                return (
                  <li key={s.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className={`tag ${PRIORITY_TAG[s.priority] || 'tag-gray'}`}>
                        {t(`ai.priority.${s.priority}`, s.priority)}
                      </span>
                      <strong style={{ fontSize: 13 }}>{s.title}</strong>
                      {ACTIONS.includes(s.action) && (
                        <span className="tag tag-info">{t(`ai.action.${s.action}`)}</span>
                      )}
                    </div>
                    {s.detail && (
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{s.detail}</div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                      {s.so_number && <span className="mono" style={chipStyle}>{t('ai.chipOrder', { value: s.so_number })}</span>}
                      {s.sku && <span className="mono" style={chipStyle}>{t('ai.chipSku', { value: s.sku })}</span>}
                      {s.source_bin && <span className="mono" style={chipStyle}>{t('ai.chipFrom', { value: s.source_bin })}</span>}
                      {s.bin_code && <span className="mono" style={chipStyle}>{t('ai.chipBin', { value: s.bin_code })}</span>}
                      {s.source_warehouse && <span className="mono" style={chipStyle}>{t('ai.chipWarehouse', { value: s.source_warehouse })}</span>}
                      {s.alternatives?.length > 0 && (
                        <span className="mono" style={chipStyle}>{t('ai.chipAlternatives', { value: s.alternatives.join(', ') })}</span>
                      )}
                      {s.quantity != null && <span className="mono" style={chipStyle}>{t('ai.chipQty', { value: s.quantity })}</span>}
                      {s.due_date && <span className="mono" style={chipStyle}>{t('ai.chipDue', { value: s.due_date })}</span>}
                      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        {rated ? (
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('ai.thanks')}</span>
                        ) : (
                          <>
                            <button type="button" className="btn btn-sm" aria-label={t('ai.helpful')} title={t('ai.helpful')} onClick={() => rate(s, 1)}>{'\u{1F44D}'}</button>
                            <button type="button" className="btn btn-sm" aria-label={t('ai.notHelpful')} title={t('ai.notHelpful')} onClick={() => rate(s, -1)}>{'\u{1F44E}'}</button>
                          </>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
