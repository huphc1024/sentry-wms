import { describe, expect, it } from 'vitest';
import { parseExpiryFromOcr, parseExpiryFromScan } from '../expiryParser';

describe('parseExpiryFromScan', () => {
  it('reads a parenthesized GS1 AI 17 date', () => {
    expect(parseExpiryFromScan('(01)08912345678903(17)271231(10)LOT01')).toBe('2027-12-31');
  });

  it('reads a raw GS1 Data Matrix element string', () => {
    expect(parseExpiryFromScan(']d201089123456789031727123110LOT01')).toBe('2027-12-31');
  });

  it('supports GS1 day 00 as the last day of the month', () => {
    expect(parseExpiryFromScan('(17)280200')).toBe('2028-02-29');
  });

  it('reads an internal expiry QR code', () => {
    expect(parseExpiryFromScan('PALLET=HCM-PLT-00001;EXP=2027-08-05')).toBe('2027-08-05');
  });

  it('does not treat arbitrary digits as an expiry date', () => {
    expect(parseExpiryFromScan('SKU-171231-ABC')).toBeNull();
  });
});

describe('parseExpiryFromOcr', () => {
  it('reads a labelled Vietnamese expiry date', () => {
    expect(parseExpiryFromOcr('NSX: 01/01/2026\nHSD: 31/12/2027')).toBe('2027-12-31');
  });

  it('reads a date printed on the line after EXP', () => {
    expect(parseExpiryFromOcr('LOT A123\nEXP\n2027-09-30')).toBe('2027-09-30');
  });

  it('rejects ambiguous unlabelled dates', () => {
    expect(parseExpiryFromOcr('01/01/2026\n31/12/2027')).toBeNull();
  });
});
