import { describe, expect, it } from 'vitest';
import { getExpiryStatus, getMostUrgentExpiry } from '../expiryStatus';

const TODAY = new Date('2026-07-21T10:00:00');

describe('getExpiryStatus', () => {
  it('marks a past date as expired', () => {
    expect(getExpiryStatus('2026-07-20', TODAY)).toMatchObject({
      level: 'expired',
      daysRemaining: -1,
    });
  });

  it('marks dates within 14 days as near expiry', () => {
    expect(getExpiryStatus('2026-08-04', TODAY)).toMatchObject({
      level: 'near',
      daysRemaining: 14,
    });
  });

  it('returns ok for dates outside the warning window', () => {
    expect(getExpiryStatus('2026-08-05', TODAY).level).toBe('ok');
  });
});

describe('getMostUrgentExpiry', () => {
  it('returns the earliest expiry across bin contents and pallets', () => {
    const status = getMostUrgentExpiry([
      { expiry_date: '2026-08-01' },
      { expiry_date: '2026-07-19' },
    ], TODAY);
    expect(status).toMatchObject({ level: 'expired', daysRemaining: -2 });
  });
});
