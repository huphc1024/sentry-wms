import { useLocale } from '../i18n/locale.jsx';
import { t } from '../i18n/translate.js';

/**
 * Status pill. Localised labels for the statuses a customer can
 * actually see on portal payloads: sales_orders.status (constants.py
 * SO_*), purchase_orders.status (PO_*) and billing_invoices.status.
 *
 * An unmapped status renders verbatim in the neutral tone rather than
 * being hidden -- an operator adding a status should show up as an
 * unstyled label, not as a blank cell.
 */
const TONES = {
  // Sales orders
  OPEN: 'info',
  WAITING_STOCK: 'warning',
  PICKED: 'info',
  PACKED: 'info',
  SHIPPED: 'success',
  CANCELLED: 'muted',
  REFUNDED: 'muted',
  // Purchase orders
  PARTIAL: 'warning',
  RECEIVED: 'success',
  CLOSED: 'muted',
  ARCHIVED: 'muted',
  // Invoices
  SENT: 'info',
  PAID: 'success',
  // Sales-order lines (schema.sql: PENDING / PICKED / PACKED / SHIPPED)
  PENDING: 'muted',
};

export function statusLabel(status, translate = t) {
  if (!status) return '—';
  if (!Object.prototype.hasOwnProperty.call(TONES, status)) return status;
  return translate(`chrome.status.${status}`);
}

export default function StatusTag({ status }) {
  const { t: tr } = useLocale();
  if (!status) return <span className="text-muted">—</span>;
  return (
    <span className={`tag tag-${TONES[status] || 'muted'}`}>{statusLabel(status, tr)}</span>
  );
}
