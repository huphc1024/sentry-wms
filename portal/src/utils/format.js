import { getStoredLocale } from '../i18n/translate.js';

/** Display helpers. Portal payloads carry ISO dates and plain numbers. */

/** BCP-47 tag for the stored UI locale, read at call time. */
function tag() {
  return getStoredLocale() === 'en' ? 'en-GB' : 'vi-VN';
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(tag(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(tag(), {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString(tag());
}

export function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return '—';
  const value = Number(amount).toLocaleString(tag(), { maximumFractionDigits: 2 });
  return currency ? `${value} ${currency}` : value;
}

/**
 * Days until an expiry date; negative when already past.
 * Compared at date granularity so an item expiring later today reads as
 * 0 days rather than as expired.
 */
export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86400000);
}
