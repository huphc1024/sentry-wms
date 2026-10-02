import { t } from '../i18n/translate.js';

/**
 * V-021: map backend error responses to user-facing strings in the current locale.
 *
 * The portal is customer-facing, so the mapping is tighter than admin's:
 * anything unrecognised collapses to a generic message rather than
 * echoing a backend string. Server errors on portal routes can carry
 * operator vocabulary (bin, zone, allocation) that means nothing to a
 * customer and hints at internal structure.
 */

const KNOWN = {
  validation_error: 'common.error.validation_error',
  unsupported_media_type: 'common.error.unsupported_media_type',
  'Invalid username or password': 'common.error.invalidCredentials',
  Unauthorized: 'common.error.unauthorized',
  Forbidden: 'common.error.forbidden',
  'Permission denied': 'common.error.permissionDenied',
  'Token expired': 'common.error.tokenExpired',
  'Token invalidated by password change': 'common.error.tokenInvalidated',
  'CSRF token missing or invalid': 'common.error.csrf',
  password_change_required: 'common.error.password_change_required',
  'Current password is incorrect': 'common.error.currentPasswordWrong',
  'Account not found': 'common.error.accountNotFound',
  "Password cannot be 'admin'": 'common.error.passwordAdmin',
  'Password must be at least 8 characters': 'common.error.passwordLength',
  'Password must contain at least one letter': 'common.error.passwordLetter',
  'Password must contain at least one digit': 'common.error.passwordDigit',
  'Order not found': 'common.error.orderNotFound',
  'Invoice not found': 'common.error.invoiceNotFound',
  'Warehouse not found': 'common.error.warehouseNotFound',
  'Customer not found': 'common.error.customerNotFound',
  'No stock on hand to ship from': 'common.error.noStock',
  'warehouse_code is required': 'common.error.warehouseRequired',
};

// Resolved when called, never at module load, so it follows the locale.
export function genericError() {
  return t('common.error.generic');
}

export function friendlyError(payload, fallback) {
  const fb = fallback ?? genericError();
  if (!payload || typeof payload !== 'object') return fb;
  const code = payload.error;
  if (code === 'Unknown sku') {
    // The handler echoes the offending SKU; it came from this user's own
    // input, so quoting it back is safe and far more useful than "invalid".
    return payload.sku
      ? t('common.error.unknownSkuNamed', undefined, { sku: payload.sku })
      : t('common.error.unknownSku');
  }
  if (code && Object.prototype.hasOwnProperty.call(KNOWN, code)) return t(KNOWN[code]);
  return fb;
}

export async function friendlyErrorFromResponse(res, fallback) {
  if (!res) return fallback ?? genericError();
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return friendlyError(body, fallback);
}
