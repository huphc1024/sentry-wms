/**
 * V-021: map backend error responses to user-friendly strings.
 *
 * The API answers with a code; the operator needs a sentence. The
 * mapping used to carry its own Vietnamese table and its own read of
 * the stored locale, which made it the fifth place in this app that
 * knew how to translate something. Now it maps code to message *key*
 * and hands that to the shared resolver, so a wording change happens in
 * one place and the table invariants cover these strings too.
 */

import { t } from '../i18n/translate.js';

const KEY_BY_CODE = {
  validation_error: 'errors.api.validation',
  unsupported_media_type: 'errors.api.unsupportedMedia',
  'Invalid username or password': 'errors.api.badCredentials',
  'Account disabled or deleted': 'errors.api.accountInactive',
  'Token expired': 'errors.api.sessionExpired',
  Unauthorized: 'errors.api.signInNeeded',
  Forbidden: 'errors.api.forbidden',
  'CSRF token missing or invalid': 'errors.api.sessionOutOfSync',
  'Access denied for this warehouse': 'errors.api.warehouseDenied',
  'Current password is incorrect': 'errors.api.currentPasswordWrong',
  'User not found': 'errors.api.accountNotFound',
  "Password cannot be 'admin'": 'errors.api.passwordNotAdmin',
  'Password must be at least 8 characters': 'errors.api.passwordLength',
  'Password must contain at least one letter': 'errors.api.passwordLetter',
  'Password must contain at least one digit': 'errors.api.passwordDigit',
  password_change_required: 'errors.api.passwordChangeRequired',
};

/**
 * @param payload   the parsed error body, or anything at all
 * @param fallback  a message key, or a literal for callers not yet
 *                  converted -- `translate` returns an unknown key
 *                  unchanged, so a literal still reads correctly.
 */
export function friendlyError(payload, fallback = 'errors.tryAgain') {
  const code = payload && typeof payload === 'object' ? payload.error : null;
  const key = code && Object.prototype.hasOwnProperty.call(KEY_BY_CODE, code)
    ? KEY_BY_CODE[code]
    : fallback;
  return t(key);
}

export async function friendlyErrorFromResponse(res, fallback) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return friendlyError(body, fallback);
}
