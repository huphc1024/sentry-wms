import { Modal as AntModal } from 'antd';
import { useLocale } from '../i18n/locale.jsx';

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

// `onBack` is optional. When supplied, a back arrow renders at the start of
// the header and the title sits beside it. The title is an <h2> either way:
// it is the dialog's heading for assistive tech and for the tests that find it. Used by the SO modal's Related
// Records tab, where clicking a related record swaps the modal's contents in
// place and the operator needs a way back to where they started. Omitting it
// renders exactly what every other caller renders.
export default function Modal({ title, onClose, children, footer, size, onBack, backLabel }) {
  const { t } = useLocale();
  const backText = backLabel ? t('modal.backTo', { label: backLabel }) : t('modal.back');
  const heading = onBack ? (
    <span className="modal-title-with-back">
      <button
        type="button"
        className="modal-back"
        onClick={onBack}
        aria-label={backText}
        title={backText}
        data-testid="modal-back"
      >
        &#8592;
      </button>
      <h2 className="modal-title-text">{title}</h2>
    </span>
  ) : <h2 className="modal-title-text">{title}</h2>;
  return (
    <AntModal
      open
      title={heading}
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
