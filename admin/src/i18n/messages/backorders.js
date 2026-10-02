/**
 * Strings owned by the backorders dashboard.
 *
 * The cancel warning is one key rather than three, even though the
 * sentence has two values wrapped in markup. Vietnamese puts the
 * order number in a different place, and a translator handed three
 * fragments cannot move it. `RichText` supplies the markup.
 */

export const en = {
  'backorders.cancelConfirm': 'Cancel Backorder',
  'backorders.cancelFailed': 'Failed to cancel backorder.',
  'backorders.cancelTitle': 'Cancel backorder {so}?',
  'backorders.cancelTooltip': 'Cancel this backorder',
  'backorders.cancelWarning': 'Cancelling will mark {so} as CANCELLED. The parent SO ({parent}) is unaffected. A backorder.cancelled event fires on the integration outbox and the Teams channel.',
  'backorders.cancelled': 'Backorder {so} cancelled ({reason}).',
  'backorders.cancelling': 'Cancelling…',
  'backorders.daysWaiting': 'Days waiting',
  'backorders.emptyReady': 'No backorders are ready to ship right now.',
  'backorders.emptyWaiting': 'No backorders waiting for stock.',
  'backorders.fulfillableSince': 'Fulfillable since',
  'backorders.items': 'Items',
  'backorders.keep': 'Keep Backorder',
  'backorders.loadFailed': 'Failed to load backorders.',
  'backorders.noItems': '(none)',
  'backorders.number': 'Backorder #',
  'backorders.parentSo': 'Parent SO',
  'backorders.reason': 'Reason',
  'backorders.reasonCustomerAsked': 'Customer asked to cancel',
  'backorders.reasonFound': 'Found in warehouse',
  'backorders.reasonOther': 'Other',
  'backorders.reasonRefunded': 'Refunded',
  'backorders.tabReady': 'Ready to Ship',
  'backorders.tabWaiting': 'Waiting',
};

export const vi = {
  'backorders.cancelConfirm': 'Hủy đơn thiếu hàng',
  'backorders.cancelFailed': 'Hủy đơn thiếu hàng không thành công.',
  'backorders.cancelTitle': 'Hủy đơn thiếu hàng {so}?',
  'backorders.cancelTooltip': 'Hủy đơn thiếu hàng này',
  'backorders.cancelWarning': 'Hủy sẽ chuyển {so} sang trạng thái ĐÃ HỦY. Đơn bán gốc ({parent}) không bị ảnh hưởng. Một sự kiện backorder.cancelled sẽ được bắn ra hộp thư tích hợp và kênh Teams.',
  'backorders.cancelled': 'Đã hủy đơn thiếu hàng {so} ({reason}).',
  'backorders.cancelling': 'Đang hủy…',
  'backorders.daysWaiting': 'Số ngày chờ',
  'backorders.emptyReady': 'Hiện không có đơn thiếu hàng nào sẵn sàng giao.',
  'backorders.emptyWaiting': 'Không có đơn thiếu hàng nào đang chờ tồn.',
  'backorders.fulfillableSince': 'Đủ hàng từ',
  'backorders.items': 'Hàng hóa',
  'backorders.keep': 'Giữ đơn',
  'backorders.loadFailed': 'Tải danh sách đơn thiếu hàng không thành công.',
  'backorders.noItems': '(không có)',
  'backorders.number': 'Số đơn thiếu hàng',
  'backorders.parentSo': 'Đơn bán gốc',
  'backorders.reason': 'Lý do',
  'backorders.reasonCustomerAsked': 'Khách yêu cầu hủy',
  'backorders.reasonFound': 'Tìm thấy hàng trong kho',
  'backorders.reasonOther': 'Khác',
  'backorders.reasonRefunded': 'Đã hoàn tiền',
  'backorders.tabReady': 'Sẵn sàng giao',
  'backorders.tabWaiting': 'Đang chờ',
};
