import { useEffect, useRef, useState } from 'react';
import { Table } from 'antd';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import { useLocale } from '../i18n/locale.jsx';
import { friendlyError } from '../utils/friendlyError.js';

// Preset questions. Each maps straight to one read-only backend tool, so
// they work without an API key (mode "quick", no LLM involved).
const QUICK = [
  { tool: 'low_stock_items', labelKey: 'aiAssistant.quick.lowStock' },
  { tool: 'near_expiry_stock', labelKey: 'aiAssistant.quick.nearExpiry' },
  { tool: 'zone_utilisation', labelKey: 'aiAssistant.quick.zones' },
  { tool: 'waiting_stock_orders', labelKey: 'aiAssistant.quick.waitingOrders' },
  { tool: 'open_purchase_orders', labelKey: 'aiAssistant.quick.openPos' },
  { tool: 'recent_receipts', labelKey: 'aiAssistant.quick.receipts' },
  { tool: 'cycle_count_variances', labelKey: 'aiAssistant.quick.variances' },
  { tool: 'sales_summary', labelKey: 'aiAssistant.quick.sales' },
];

const HISTORY_TURNS = 6;

const bubbleBase = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  maxWidth: '100%',
  fontSize: 13,
};

/** Markdown-light: '-' bullets and **bold** only, rendered as elements. */
function renderInline(line, keyPrefix) {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : part
  ));
}

function AnswerText({ text }) {
  const blocks = [];
  let list = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) {
        list = [];
        blocks.push({ type: 'ul', items: list, key: i });
      }
      list.push({ text: bullet[1], key: i });
      return;
    }
    list = null;
    if (line.trim()) blocks.push({ type: 'p', text: line, key: i });
  });
  return (
    <div>
      {blocks.map((b) => (b.type === 'ul' ? (
        <ul key={b.key} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {b.items.map((it) => <li key={it.key}>{renderInline(it.text, it.key)}</li>)}
        </ul>
      ) : (
        <p key={b.key} style={{ margin: '4px 0' }}>{renderInline(b.text, b.key)}</p>
      )))}
    </div>
  );
}

function ResultTable({ table }) {
  const { t } = useLocale();
  const rows = table.rows || [];
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const columns = keys.map((k) => ({
    title: t(`aiAssistant.col.${k}`, k),
    dataIndex: k,
    key: k,
    render: (v) => (v === null || v === undefined ? '-' : String(v)),
  }));
  const summary = table.summary;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        {t(`aiAssistant.tool.${table.tool}`, table.tool)}
        {' · '}
        {t('aiAssistant.rowCount', { count: rows.length })}
        {table.truncated ? ` · ${t('aiAssistant.truncated')}` : ''}
      </div>
      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, marginBottom: 6 }}>
          {Object.entries(summary).map(([k, v]) => (
            <span key={k}>
              {t(`aiAssistant.col.${k}`, k)}
              {': '}
              <strong>{v === null || v === undefined ? '-' : String(v)}</strong>
            </span>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('aiAssistant.noRows')}</div>
      ) : (
        <Table
          size="small"
          columns={columns}
          dataSource={rows.map((r, i) => ({ ...r, _key: i }))}
          rowKey="_key"
          pagination={rows.length > 10 ? { pageSize: 10, size: 'small' } : false}
          scroll={{ x: true }}
        />
      )}
    </div>
  );
}

function ModeTag({ mode }) {
  const { t } = useLocale();
  const llm = mode === 'llm';
  return (
    <span
      className={llm ? 'tag tag-purple' : 'tag tag-gray'}
      title={t(llm ? 'ai.modeLlmHint' : 'aiAssistant.modeQuickHint')}
    >
      {t(llm ? 'ai.modeLlm' : 'aiAssistant.modeQuick')}
    </span>
  );
}

export default function AiAssistant() {
  const { t, locale } = useLocale();
  const { warehouseId } = useWarehouse();
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [turns, setTurns] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/admin/ai/status', { silentPermissionDenied: true });
        if (!res?.ok) return;
        const data = await res.json();
        if (!cancelled) setLlmAvailable(data?.mode === 'llm');
      } catch { /* status is best effort; stay in quick mode */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' }); // i18n-ignore
  }, [turns]);

  function historyFor() {
    return turns
      .filter((x) => x.text && !x.error && !x.quick)
      .slice(-HISTORY_TURNS)
      .map((x) => ({ role: x.role, text: x.text.slice(0, 2000) }));
  }

  async function errorMessage(res) {
    const body = await res?.json?.().catch(() => null);
    if (body?.error === 'ai_llm_unavailable') {
      setLlmAvailable(false);
      return t('aiAssistant.error.llmUnavailable');
    }
    if (body?.error === 'ai_llm_failed') return t('aiAssistant.error.llmFailed');
    if (res?.status === 403) return t('errors.noPermission');
    if (res?.status === 429) return t('ai.rateLimited');
    return friendlyError(body);
  }

  async function ask({ text, quick, label }) {
    if (!warehouseId || loading) return;
    const history = historyFor();
    setTurns((prev) => [...prev, { role: 'user', text: quick ? label : text, quick: !!quick }]);
    setLoading(true);
    try {
      const body = { warehouse_id: warehouseId, lang: locale };
      if (quick) body.quick = quick;
      else Object.assign(body, { question: text, history });
      const res = await api.post('/admin/ai/ask', body);
      if (res?.ok) {
        const data = await res.json();
        setTurns((prev) => [...prev, {
          role: 'assistant',
          text: data.answer || '',
          quick: data.mode === 'quick',
          mode: data.mode,
          data: data.data || [],
        }]);
      } else {
        const msg = await errorMessage(res);
        setTurns((prev) => [...prev, { role: 'assistant', error: msg }]);
      }
    } catch (e) {
      setTurns((prev) => [...prev, { role: 'assistant', error: friendlyError(e) }]);
    } finally {
      setLoading(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    const text = question.trim();
    if (!text || !llmAvailable) return;
    setQuestion('');
    ask({ text });
  }

  const headerMode = llmAvailable ? 'llm' : 'quick'; // i18n-ignore

  return (
    <div>
      <PageHeader title={t('aiAssistant.title')}>
        <ModeTag mode={headerMode} />
      </PageHeader>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
          {t(llmAvailable ? 'aiAssistant.introLlm' : 'aiAssistant.introQuick')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {QUICK.map((q) => (
            <button
              key={q.tool}
              type="button"
              className="btn btn-sm"
              disabled={loading || !warehouseId}
              onClick={() => ask({ quick: q.tool, label: t(q.labelKey) })}
            >
              {t(q.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12, minHeight: 160 }}>
        {turns.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{t('aiAssistant.empty')}</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-live="polite">
          {turns.map((turn, i) => (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              style={{
                ...bubbleBase,
                alignSelf: turn.role === 'user' ? 'flex-end' : 'stretch',
                background: turn.role === 'user' ? 'var(--bg-secondary)' : undefined,
              }}
            >
              {turn.role === 'user' ? (
                <span>{turn.text}</span>
              ) : turn.error ? (
                <span role="alert" style={{ color: 'var(--text-secondary)' }}>{turn.error}</span>
              ) : (
                <div>
                  <div style={{ marginBottom: 4 }}><ModeTag mode={turn.mode} /></div>
                  {turn.text
                    ? <AnswerText text={turn.text} />
                    : <p style={{ margin: '4px 0' }}>{t('aiAssistant.quickResult')}</p>}
                  {turn.data.map((table, n) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <ResultTable key={n} table={table} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div role="status" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('aiAssistant.thinking')}</div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form onSubmit={submit} className="card" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          className="form-input"
          style={{ flex: 1 }}
          value={question}
          maxLength={1000}
          disabled={!llmAvailable || loading}
          placeholder={t(llmAvailable ? 'aiAssistant.placeholder' : 'aiAssistant.placeholderQuick')}
          aria-label={t('aiAssistant.inputLabel')}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!llmAvailable || loading || !question.trim()}
        >
          {t('aiAssistant.send')}
        </button>
      </form>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>{t('aiAssistant.disclaimer')}</p>
    </div>
  );
}
