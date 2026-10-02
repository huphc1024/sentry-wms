import { t } from '../i18n/translate';

/**
 * Universal barcode lookup for the Home screen.
 *
 * A scan can be any of four things, so Home tries them in order: item,
 * bin, purchase order, sales order. The previous version wrapped each
 * attempt in a bare `catch {}` and, having exhausted all four, always
 * said "Barcode not recognized" -- including when the warehouse Wi-Fi
 * had dropped or the API was down. On the floor that reads as "this
 * label is bad", so the picker scans it again, tries another carton,
 * and eventually walks to the office, when the real fix is to reconnect.
 *
 * So each failure is classified. Only a genuine 404 means "not this
 * kind of thing, try the next lookup"; anything else stops the chain
 * immediately, because a server that just refused one request is not
 * going to answer the next three.
 */

export const SCAN_ITEM = 'item';
export const SCAN_BIN = 'bin';
export const SCAN_PO = 'po';
export const SCAN_SO = 'so';
export const SCAN_NOT_FOUND = 'not_found';
export const SCAN_UNREACHABLE = 'unreachable';
export const SCAN_SERVER_ERROR = 'server_error';
export const SCAN_DENIED = 'denied';
export const SCAN_REQUEST_ERROR = 'request_error';

/**
 * Why did one lookup call fail?
 *
 * api/client.js attaches `response = {status, data}` to errors it raises
 * from an HTTP status, and leaves it null/undefined when fetch itself
 * failed (offline, DNS, wrong server URL) or the 10s timeout fired.
 * That absence is the signal for "never reached the server".
 */
export function classifyLookupFailure(err) {
  const status = err?.response?.status;
  if (status === 404) return SCAN_NOT_FOUND;
  if (status === 403) return SCAN_DENIED;
  if (typeof status === 'number' && status >= 500) return SCAN_SERVER_ERROR;
  if (typeof status === 'number') return SCAN_REQUEST_ERROR;
  return SCAN_UNREACHABLE;
}

/** Operator-facing message for a failed scan. Vietnamese: this is read
 *  on the floor, mid-shift, by whoever is holding the scanner. */
export function scanFailureMessage(kind, barcode) {
  switch (kind) {
    case SCAN_UNREACHABLE:
      return t('common.scanUnreachable');
    case SCAN_SERVER_ERROR:
      return t('common.scanServerError');
    case SCAN_DENIED:
      return t('common.scanDenied');
    case SCAN_REQUEST_ERROR:
      return t('common.scanRequestError');
    default:
      return barcode
        ? t('common.scanNotFoundCode', { barcode })
        : t('common.scanNotFound');
  }
}

const LOOKUPS = [
  { kind: SCAN_ITEM, path: (code) => `/api/lookup/item/${code}`, pick: (d) => (d?.item ? d : null) },
  { kind: SCAN_BIN, path: (code) => `/api/lookup/bin/${code}`, pick: (d) => (d?.bin ? d : null) },
  { kind: SCAN_PO, path: (code) => `/api/receiving/po/${code}`, pick: (d) => (d?.purchase_order ? d : null) },
  { kind: SCAN_SO, path: (code) => `/api/lookup/so/${code}`, pick: (d) => (d?.sales_order ? d : null) },
];

/**
 * Resolve a scanned barcode to whatever it is.
 *
 * Returns `{kind, data}` on a hit, or `{kind}` carrying one of the
 * failure kinds above. The caller decides what to render or navigate to;
 * this function neither touches navigation nor shows anything.
 */
export async function lookupScannedBarcode(client, barcode) {
  const code = encodeURIComponent(barcode);

  for (const lookup of LOOKUPS) {
    try {
      const resp = await client.get(lookup.path(code));
      const hit = lookup.pick(resp?.data);
      if (hit) return { kind: lookup.kind, data: hit };
      // 200 with an empty body: treat as "not this kind" and keep going,
      // the same as a 404 would.
    } catch (err) {
      const failure = classifyLookupFailure(err);
      if (failure !== SCAN_NOT_FOUND) return { kind: failure, error: err };
    }
  }

  return { kind: SCAN_NOT_FOUND };
}
