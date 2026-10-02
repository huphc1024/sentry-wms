import { Modal as AntModal } from 'antd';

/**
 * The app's modal, now an Ant Design dialog underneath.
 *
 * The props are deliberately untouched -- `title`, `onClose`, `children`,
 * `footer`, `size` -- because thirty-three pages render this component and
 * none of them should have to change to get the new chrome. What the pages
 * gain is antd's header, close button, mask animation and focus trap;
 * what they keep is their own body markup, their own footer buttons, and
 * the widths they were laid out against.
 *
 * Two details are load-bearing:
 *
 * - `getContainer={false}` keeps the dialog in the DOM where the page put
 *   it instead of portalling it to <body>. Pages and tests reach into
 *   modal content through the render container (`within(container)`), and
 *   a portal would put that content out of reach.
 * - the `modal` class stays on the dialog so the in-modal type scale in
 *   App.css (`.modal .form-group label`, `.modal .detail-grid`, ...) keeps
 *   applying to body markup this component does not own.
 */

// App.css sizes `.modal` at 480px and `.modal.modal-wide` at 1280px. antd
// writes its width inline, which would win over the stylesheet, so the
// same numbers are repeated here rather than left to be overridden.
// `size="large"` has no rule in App.css and has always rendered at the
// default width; that is preserved rather than quietly widened.
const WIDTH_BY_SIZE = { wide: 1280 };

export default function Modal({ title, onClose, children, footer, size }) {
  return (
    <AntModal
      open
      title={title}
      onCancel={onClose}
      footer={footer || null}
      className={size ? `modal modal-${size}` : 'modal'}
      width={WIDTH_BY_SIZE[size] || 480}
      // Keeps the body's own padding and its scroll ceiling, so a long
      // detail modal still scrolls inside itself rather than growing past
      // the viewport.
      classNames={{ body: 'modal-body' }}
      getContainer={false}
      centered
      destroyOnHidden
    >
      {children}
    </AntModal>
  );
}
