/**
 * API status codes to labels.
 *
 * Resolved dynamically by StatusTag.jsx, so none of these keys has a
 * literal call site. Anything scanning for unused keys has to know
 * that, or it will report all eighteen as dead.
 */

export const en = {
  'status.ARCHIVED': 'ARCHIVED',
  'status.CHECKED_IN': 'CHECKED IN',
  'status.CANCELLED': 'CANCELLED',
  'status.CLOSED': 'CLOSED',
  'status.COMPLETE': 'COMPLETE',
  'status.COMPLETED': 'COMPLETED',
  'status.INACTIVE': 'INACTIVE',
  'status.IN_PROGRESS': 'IN PROGRESS',
  'status.LOW': 'LOW',
  'status.OPEN': 'OPEN',
  'status.PACKED': 'PACKED',
  'status.PARTIAL': 'PARTIAL',
  'status.PICKED': 'PICKED',
  'status.RECEIVED': 'RECEIVED',
  'status.REFUNDED': 'REFUNDED',
  'status.Ready to pick': 'Ready to pick',
  'status.SHIPPED': 'SHIPPED',
  'status.SHORT': 'SHORT',
  'status.VARIANCE': 'VARIANCE',
  'status.WAITING_STOCK': 'WAITING STOCK',
};

export const vi = {
  'status.ARCHIVED': 'LƯU TRỮ',
  'status.CHECKED_IN': 'ĐÃ VÀO CỔNG',
  'status.CANCELLED': 'ĐÃ HỦY',
  'status.CLOSED': 'ĐÓNG',
  'status.COMPLETE': 'HOÀN TẤT',
  'status.COMPLETED': 'HOÀN TẤT',
  'status.INACTIVE': 'NGƯNG',
  'status.IN_PROGRESS': 'ĐANG XỬ LÝ',
  'status.LOW': 'THẤP',
  'status.OPEN': 'MỞ',
  'status.PACKED': 'ĐÃ ĐÓNG GÓI',
  'status.PARTIAL': 'MỘT PHẦN',
  'status.PICKED': 'ĐÃ LẤY',
  'status.RECEIVED': 'ĐÃ NHẬN',
  'status.REFUNDED': 'ĐÃ HOÀN TIỀN',
  'status.Ready to pick': 'Sẵn sàng lấy',
  'status.SHIPPED': 'ĐÃ GỬI',
  'status.SHORT': 'THIẾU',
  'status.VARIANCE': 'LỆCH',
  'status.WAITING_STOCK': 'CHỜ HÀNG',
};
