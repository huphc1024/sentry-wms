import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useLocale } from '../i18n/locale.jsx';
import { encodeCode128B } from '../utils/code128.js';
import { formatDateOnly } from '../utils/date.js';
import './pickingTicket.css';

function shippingAddressLines(so) {
  const lines = [];
  const name = so.shipping_address_name || so.customer_name || '';
  if (name) lines.push(name);
  if (so.shipping_address_line1) lines.push(so.shipping_address_line1);
  if (so.shipping_address_line2) lines.push(so.shipping_address_line2);
  const cityStateZip = [
    so.shipping_address_city,
    so.shipping_address_state,
    so.shipping_address_postal_code,
  ].filter(Boolean).join(' ');
  if (cityStateZip) lines.push(cityStateZip);
  if (lines.length === 0 && so.ship_address) {
    // Legacy single-string ship address fallback. Split on newlines so
    // multi-line legacy data still stacks visually.
    return String(so.ship_address).split(/\r?\n/).filter(Boolean);
  }
  return lines;
}

function BarcodeSvg({ value, className, modulePx, height }) {
  const { t } = useLocale();
  // Render Code 128 modules as <rect> elements. We never inject the
  // user-supplied value into SVG text content, only into the encoder
  // (which only emits numeric module widths) -- so this stays safe
  // against arbitrary input.
  const { bars, width } = useMemo(() => {
    const { segments, totalModules } = encodeCode128B(value || '');
    const out = [];
    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segWidth = seg.width * modulePx;
      if (seg.black) out.push({ key: i, x: cursor, w: segWidth });
      cursor += segWidth;
    }
    return { bars: out, width: totalModules * modulePx };
  }, [value, modulePx]);
  if (width === 0) return null;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t('pickingTicketPrint.barcode', { value })}
    >
      {bars.map((b) => (
        <rect key={b.key} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
    </svg>
  );
}

export function TicketDocument({ so, lines, branding = {}, combineWith = [] }) {
  const { t } = useLocale();
  const orderNumber = so.so_number || '';
  const addressLines = shippingAddressLines(so);
  // Multi-Orders: siblings shipping to the same address in this print
  // stack. When present, a "SHIP WITH" banner tells the packer to box
  // these together as one shipment. Empty (the default) renders nothing,
  // so a normal single ticket is unchanged.
  const combineSiblings = Array.isArray(combineWith) ? combineWith : [];
  return (
    <div className="pt-page">
      {combineSiblings.length > 0 && (
        <div className="pt-combine">
          <span className="pt-combine-label">{t('pickingTicketPrint.shipWith')}</span>{' '}
          {combineSiblings.join(', ')}{' '}
          <span className="pt-combine-count">
            {t('pickingTicketPrint.combineCount', { count: combineSiblings.length + 1 })}
          </span>
        </div>
      )}
      <table className="pt-header">
        <tbody>
          <tr>
            <td rowSpan={3} className="pt-logo-cell">
              <div className="pt-logo-row">
                {branding.logo_url && (
                  <img src={branding.logo_url} className="pt-logo" alt={branding.company_name || t('pickingTicketPrint.companyLogo')} />
                )}
                {(branding.company_name || branding.company_address) && (
                  <div className="pt-nameandaddress">
                    {branding.company_name && (<>{branding.company_name}<br /></>)}
                    {(branding.company_address || '').split(/\r?\n/).filter(Boolean).map((ln, i) => (
                      <span key={i}>{ln}<br /></span>
                    ))}
                  </div>
                )}
              </div>
            </td>
            <td className="pt-right"><span className="pt-title">{t('pickingTicketPrint.packingSlip')}</span></td>
          </tr>
          <tr>
            <td className="pt-right"><span className="pt-number">{t('pickingTicketPrint.orderNumber', { number: orderNumber })}</span></td>
          </tr>
          <tr>
            <td className="pt-right">{t('pickingTicketPrint.mustShipBy', { date: formatDateOnly(so.ship_by_date) })}</td>
          </tr>
        </tbody>
      </table>

      <br />

      <table>
        <tbody>
          <tr>
            <td className="pt-address-header"><b>{t('salesOrders.shippingAddress')}</b></td>
            <td></td>
          </tr>
          <tr>
            <td className="pt-address">
              <b>{t('pickingTicketPrint.shipTo')}</b><br />
              {addressLines.map((l, i) => (
                <span key={i}>{l}{i < addressLines.length - 1 ? <br /> : null}</span>
              ))}
            </td>
            <td className="pt-right">
              <BarcodeSvg
                value={orderNumber}
                className="pt-barcode-small"
                modulePx={1}
                height={32}
              />
            </td>
          </tr>
        </tbody>
      </table>

      <table className="pt-body">
        <tbody>
          <tr><th>{t('pickingTicketPrint.shippingMethod')}</th><th>{t('pickingTicketPrint.orderDate')}</th></tr>
          <tr>
            <td>{so.ship_method || ''}</td>
            <td>{formatDateOnly(so.order_date || so.created_at)}</td>
          </tr>
        </tbody>
      </table>

      <table className="pt-itemtable">
        <thead>
          <tr>
            <th className="pt-center" colSpan={3}>{t('common.qty')}</th>
            <th className="pt-center" colSpan={3}>{t('dashboard.shipped')}</th>
            <th colSpan={16}>{t('common.item')}</th>
            <th colSpan={3}>{t('pickingTicketPrint.box')}</th>
            <th className="pt-right" colSpan={5}>{t('common.bin')}</th>
            <th className="pt-right" colSpan={4}>{t('common.upc')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.so_line_id}>
              <td className="pt-center" colSpan={3} style={{ lineHeight: '150%' }}>{l.quantity_ordered}</td>
              <td className="pt-center" colSpan={3} style={{ lineHeight: '150%' }}>{l.quantity_shipped}</td>
              <td colSpan={16}>
                <span className="pt-itemname">{l.sku} {l.item_name}</span>
              </td>
              <td colSpan={3}></td>
              <td className="pt-right" colSpan={5}>{l.preferred_bin_code || ''}</td>
              <td className="pt-right" colSpan={4}>{l.upc || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pt-tail">
        {branding.returns_text && (
          <div className="pt-returns">
            {branding.returns_text}
          </div>
        )}

        <div className="pt-footer">
          <div>
            <BarcodeSvg
              value={orderNumber}
              className="pt-barcode-large"
              modulePx={1.2}
              height={40}
            />
          </div>
          <div></div>
          <div></div>
        </div>
      </div>
    </div>
  );
}

export default function PickingTicketPrint() {
  const { t } = useLocale();
  const { soId } = useParams();
  const [so, setSo] = useState(null);
  const [lines, setLines] = useState([]);
  const [branding, setBranding] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Bump to force a re-fetch of the current ticket. Lets a picker
  // pull fresh data without leaving the page (e.g. after an upstream
  // connector writes new shipping_address_* on an SO they already
  // have open).
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      const res = await api.get(`/admin/sales-orders/${soId}/picking-ticket`);
      if (cancelled) return;
      if (!res) {
        setError(t('pickingTicketPrint.networkError'));
        setLoading(false);
        return;
      }
      if (res.status === 404) {
        setError(t('pickingTicketPrint.soNotFound', { id: soId }));
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(t('pickingTicketPrint.soLoadFailed', { id: soId }));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSo(data.sales_order || null);
      setLines(data.lines || []);
      setBranding(data.branding || {});
      setLoading(false);
      // mig 064: confirm-render trigger. Once we have both the SO
      // header and its lines, fire-and-forget a mark-printed POST so
      // this SO drops out of the Picking Tickets queue. Errors are
      // ignored - the queue defaults to hiding only confirmed prints,
      // so a network blip just means the SO stays visible.
      if (data.sales_order?.so_id) {
        api.post('/admin/sales-orders/mark-printed', {
          so_ids: [data.sales_order.so_id],
        }).catch(() => {});
      }
    }
    load();
    return () => { cancelled = true; };
  }, [soId, refreshCounter]);

  if (loading) {
    return (
      <div className="pt-root">
        <div className="pt-toolbar pt-no-print">
          <Link to="/picking-tickets" className="pt-back">&larr; {t('common.back')}</Link>
        </div>
        <div className="pt-page">{t('pickingTicketPrint.loading')}</div>
      </div>
    );
  }

  if (error || !so) {
    return (
      <div className="pt-root">
        <div className="pt-toolbar pt-no-print">
          <Link to="/picking-tickets" className="pt-back">&larr; {t('common.back')}</Link>
        </div>
        <div className="pt-page">
          <h2>{t('pickingTicketPrint.renderFailed')}</h2>
          <p>{error || t('pickingTicketPrint.emptyData')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-root">
      <div className="pt-toolbar pt-no-print">
        <Link to="/picking-tickets" className="pt-back">&larr; {t('common.back')}</Link>
        <button
          onClick={() => setRefreshCounter((c) => c + 1)}
          disabled={loading}
          title={t('pickingTicketPrint.refetchHint')}
        >
          {loading ? t('pickingTicketPrint.refreshing') : t('common.refresh')}
        </button>
        <button onClick={() => window.print()}>{t('pickingTicketPrint.print')}</button>
      </div>
      <TicketDocument so={so} lines={lines} branding={branding} />
    </div>
  );
}
