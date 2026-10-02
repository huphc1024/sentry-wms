import { t } from '../i18n/translate.js';

export const NEAR_EXPIRY_DAYS = 14;

export function getExpiryStatus(expiryDate, today = new Date()) {
  if (!expiryDate) return null;
  const target = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const daysRemaining = Math.round((target.getTime() - start.getTime()) / 86400000);
  if (daysRemaining < 0) {
    return {
      level: 'expired',
      daysRemaining,
      label: t('common.expiryOverdue', { days: Math.abs(daysRemaining) }),
    };
  }
  if (daysRemaining <= NEAR_EXPIRY_DAYS) {
    return {
      level: 'near',
      daysRemaining,
      label: daysRemaining === 0
        ? t('common.expiryToday')
        : t('common.expiryLeft', { days: daysRemaining }),
    };
  }
  return { level: 'ok', daysRemaining, label: t('common.expiryLeft', { days: daysRemaining }) };
}

export function getMostUrgentExpiry(records = [], today = new Date()) {
  return records.reduce((urgent, record) => {
    const status = getExpiryStatus(record?.expiry_date, today);
    if (!status) return urgent;
    if (!urgent || status.daysRemaining < urgent.daysRemaining) return status;
    return urgent;
  }, null);
}
