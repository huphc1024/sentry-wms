import { describe, it, expect, vi } from 'vitest';
import {
  lookupScannedBarcode,
  classifyLookupFailure,
  scanFailureMessage,
  SCAN_ITEM,
  SCAN_BIN,
  SCAN_PO,
  SCAN_SO,
  SCAN_NOT_FOUND,
  SCAN_UNREACHABLE,
  SCAN_SERVER_ERROR,
  SCAN_DENIED,
} from '../scanLookup';

/** Shape api/client.js raises for an HTTP status. */
function httpError(status, data = {}) {
  const err = new Error(data.error || `HTTP ${status}`);
  err.response = { status, data };
  return err;
}

/** Shape api/client.js raises when fetch never reached the server. */
function networkError(message = 'Network request failed') {
  return new Error(message);
}

/** Shape api/client.js raises when its 10s AbortController fires. */
function timeoutError() {
  const err = new Error('Request timeout');
  err.response = null;
  return err;
}

function clientReturning(handlers) {
  const get = vi.fn(async (path) => {
    for (const [fragment, result] of Object.entries(handlers)) {
      if (path.includes(fragment)) {
        if (result instanceof Error) throw result;
        return { data: result, status: 200 };
      }
    }
    throw httpError(404, { error: 'Not found' });
  });
  return { get };
}

describe('classifyLookupFailure', () => {
  it('reads a 404 as "not this kind of thing"', () => {
    expect(classifyLookupFailure(httpError(404))).toBe(SCAN_NOT_FOUND);
  });

  it('reads a dead network as unreachable, not as a bad barcode', () => {
    expect(classifyLookupFailure(networkError())).toBe(SCAN_UNREACHABLE);
  });

  it('reads the client timeout as unreachable', () => {
    expect(classifyLookupFailure(timeoutError())).toBe(SCAN_UNREACHABLE);
  });

  it('separates server faults from permission refusals', () => {
    expect(classifyLookupFailure(httpError(500))).toBe(SCAN_SERVER_ERROR);
    expect(classifyLookupFailure(httpError(503))).toBe(SCAN_SERVER_ERROR);
    expect(classifyLookupFailure(httpError(403))).toBe(SCAN_DENIED);
  });
});

describe('lookupScannedBarcode', () => {
  it('returns the item when the barcode is a SKU or UPC', async () => {
    const client = clientReturning({ '/lookup/item/': { item: { sku: 'TST-001' }, locations: [] } });
    const result = await lookupScannedBarcode(client, 'TST-001');
    expect(result.kind).toBe(SCAN_ITEM);
    expect(result.data.item.sku).toBe('TST-001');
  });

  it('falls through to the bin lookup when the item lookup 404s', async () => {
    const client = clientReturning({ '/lookup/bin/': { bin: { bin_code: 'A-01-01' }, items: [] } });
    const result = await lookupScannedBarcode(client, 'A-01-01');
    expect(result.kind).toBe(SCAN_BIN);
  });

  it('finds a purchase order on the third attempt', async () => {
    const client = clientReturning({ '/receiving/po/': { purchase_order: { po_number: 'PO-1' } } });
    expect((await lookupScannedBarcode(client, 'PO-1')).kind).toBe(SCAN_PO);
  });

  it('finds a sales order on the fourth attempt', async () => {
    const client = clientReturning({ '/lookup/so/': { sales_order: { so_number: 'SO-1' } } });
    expect((await lookupScannedBarcode(client, 'SO-1')).kind).toBe(SCAN_SO);
  });

  it('reports not-found only after all four lookups 404', async () => {
    const client = clientReturning({});
    const result = await lookupScannedBarcode(client, 'WH-DEMO-001');
    expect(result.kind).toBe(SCAN_NOT_FOUND);
    expect(client.get).toHaveBeenCalledTimes(4);
  });

  it('stops at the first unreachable call instead of blaming the barcode', async () => {
    // The regression this module exists for: Wi-Fi drops mid-shift and
    // the picker is told the label is unknown.
    const client = clientReturning({ '/lookup/item/': networkError() });
    const result = await lookupScannedBarcode(client, 'TST-001');
    expect(result.kind).toBe(SCAN_UNREACHABLE);
    // And it does not hammer a server it already failed to reach.
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('surfaces a server fault rather than continuing the chain', async () => {
    const client = clientReturning({ '/lookup/item/': httpError(500, { error: 'boom' }) });
    const result = await lookupScannedBarcode(client, 'TST-001');
    expect(result.kind).toBe(SCAN_SERVER_ERROR);
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('keeps going when a lookup answers 200 with nothing useful', async () => {
    const client = clientReturning({
      '/lookup/item/': {},
      '/lookup/bin/': { bin: { bin_code: 'RECV-01' } },
    });
    expect((await lookupScannedBarcode(client, 'RECV-01')).kind).toBe(SCAN_BIN);
  });

  it('url-encodes the scanned value', async () => {
    const client = clientReturning({});
    await lookupScannedBarcode(client, 'A/B 01');
    expect(client.get).toHaveBeenCalledWith('/api/lookup/item/A%2FB%2001');
  });
});

describe('scanFailureMessage', () => {
  it('names the offending code when nothing matched', () => {
    expect(scanFailureMessage(SCAN_NOT_FOUND, 'WH-DEMO-001')).toContain('WH-DEMO-001');
  });

  it('tells the operator to check Wi-Fi when the server was never reached', () => {
    expect(scanFailureMessage(SCAN_UNREACHABLE)).toContain('Wi-Fi');
  });

  it('does not blame the barcode for a server fault', () => {
    const message = scanFailureMessage(SCAN_SERVER_ERROR, 'TST-001');
    expect(message).not.toContain('TST-001');
    expect(message).toContain('Máy chủ');
  });
});
