/**
 * Strings owned by the single picking-ticket print view.
 *
 * Like its batch sibling this renders outside Layout, so the DOM sweep
 * never reached it: every one of these printed in English no matter
 * which language the operator had chosen.
 */

export const en = {
  'pickingTicketPrint.barcode': 'Barcode {value}',
  'pickingTicketPrint.box': 'Box',
  'pickingTicketPrint.companyLogo': 'Company logo',
  'pickingTicketPrint.emptyData': 'Sales order data was empty.',
  'pickingTicketPrint.loading': 'Loading ticket…',
  'pickingTicketPrint.mustShipBy': 'Must ship by: {date}',
  'pickingTicketPrint.networkError': 'Network error.',
  'pickingTicketPrint.orderDate': 'Order Date',
  'pickingTicketPrint.orderNumber': 'Order #{number}',
  'pickingTicketPrint.packingSlip': 'Packing Slip',
  'pickingTicketPrint.print': 'Print',
  'pickingTicketPrint.refetchHint': "Re-fetch this ticket's data from the server",
  'pickingTicketPrint.refreshing': 'Refreshing…',
  'pickingTicketPrint.renderFailed': 'Could not render ticket',
  'pickingTicketPrint.shipTo': 'Ship To:',
  'pickingTicketPrint.shippingMethod': 'Shipping Method',
  'pickingTicketPrint.soLoadFailed': 'Could not load sales order #{id}.',
  'pickingTicketPrint.soNotFound': 'Sales order #{id} not found.',
  'pickingTicketPrint.shipWith': 'SHIP WITH:',
  'pickingTicketPrint.combineCount': '({count} orders, one shipment)',
};

export const vi = {
  'pickingTicketPrint.barcode': 'Mã vạch {value}',
  'pickingTicketPrint.box': 'Thùng',
  'pickingTicketPrint.companyLogo': 'Logo công ty',
  'pickingTicketPrint.emptyData': 'Dữ liệu đơn bán trống.',
  'pickingTicketPrint.loading': 'Đang tải phiếu…',
  'pickingTicketPrint.mustShipBy': 'Phải giao trước: {date}',
  'pickingTicketPrint.networkError': 'Lỗi kết nối.',
  'pickingTicketPrint.orderDate': 'Ngày đặt',
  'pickingTicketPrint.orderNumber': 'Đơn số {number}',
  'pickingTicketPrint.packingSlip': 'Phiếu đóng gói',
  'pickingTicketPrint.print': 'In',
  'pickingTicketPrint.refetchHint': 'Tải lại dữ liệu phiếu này từ máy chủ',
  'pickingTicketPrint.refreshing': 'Đang làm mới…',
  'pickingTicketPrint.renderFailed': 'Không dựng được phiếu',
  'pickingTicketPrint.shipTo': 'Giao đến:',
  'pickingTicketPrint.shippingMethod': 'Phương thức giao',
  'pickingTicketPrint.soLoadFailed': 'Không tải được đơn bán số {id}.',
  'pickingTicketPrint.soNotFound': 'Không tìm thấy đơn bán số {id}.',
  'pickingTicketPrint.shipWith': 'GIAO CÙNG:',
  'pickingTicketPrint.combineCount': '({count} đơn, một lô hàng)',
};
