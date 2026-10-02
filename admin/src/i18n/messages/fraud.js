/**
 * Strings owned by the fraud review queue.
 *
 * The two address columns are named for what they hold rather than
 * translated word for word: the cell renders a postal address, so
 * "Billing" on its own would have read as a payment column.
 */

export const en = {
  'fraud.billingAddress': 'Billing',
  'fraud.blank': '(blank)',
  'fraud.flaggedAtIngest': 'Orders flagged at ingest',
  'fraud.flaggedAtIngestCount': 'Orders flagged at ingest ({count})',
  'fraud.memo': 'Memo',
  'fraud.memoPlaceholder': 'CSR notes…',
  'fraud.noFlaggedOrders': 'No flagged orders',
  'fraud.pushFailed': 'Could not push order {so} to queue.',
  'fraud.pushToQueue': 'Push to queue',
  'fraud.saveFailed': 'Save failed',
  'fraud.shippingAddress': 'Shipping',
  'fraud.title': 'Fraud Review',
};

export const vi = {
  'fraud.billingAddress': 'Địa chỉ thanh toán',
  'fraud.blank': '(trống)',
  'fraud.flaggedAtIngest': 'Đơn bị gắn cờ khi tiếp nhận',
  'fraud.flaggedAtIngestCount': 'Đơn bị gắn cờ khi tiếp nhận ({count})',
  'fraud.memo': 'Ghi chú',
  'fraud.memoPlaceholder': 'Ghi chú của CSKH…',
  'fraud.noFlaggedOrders': 'Không có đơn bị gắn cờ',
  'fraud.pushFailed': 'Không đẩy được đơn {so} vào hàng chờ.',
  'fraud.pushToQueue': 'Đẩy vào hàng chờ',
  'fraud.saveFailed': 'Lưu không thành công',
  'fraud.shippingAddress': 'Địa chỉ giao hàng',
  'fraud.title': 'Rà soát gian lận',
};
