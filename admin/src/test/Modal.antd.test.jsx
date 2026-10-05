/**
 * Modal moved onto Ant Design's dialog. Thirty-three pages render it, so
 * what is pinned here is the contract they rely on rather than antd's own
 * behaviour.
 *
 * The container case is the one that would break quietly: antd portals a
 * dialog to <body> by default, and these pages (and their tests) reach
 * into modal content through the render container. A portal would leave
 * that content technically on screen but unreachable from `within(...)`,
 * so `getContainer={false}` is load-bearing, not a preference.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import Modal from '../components/Modal.jsx';

function open(props = {}) {
  return render(
    <div data-testid="page">
      <Modal title="Edit Vendor" onClose={() => {}} {...props}>
        <p>Body content</p>
      </Modal>
    </div>
  );
}

describe('Modal on antd', () => {
  it('renders the title and the body the page passed', () => {
    const { getByText } = open();
    expect(getByText('Edit Vendor')).toBeInTheDocument();
    expect(getByText('Body content')).toBeInTheDocument();
  });

  it('keeps its content inside the render container instead of portalling it', () => {
    const { getByTestId } = open();
    expect(within(getByTestId('page')).getByText('Body content')).toBeInTheDocument();
  });

  it('renders the page-supplied footer, and nothing when there is none', () => {
    const { getByText, queryByText, container } = render(
      <Modal title="Edit Vendor" onClose={() => {}} footer={<button>Save</button>}>
        <p>Body content</p>
      </Modal>
    );
    expect(getByText('Save')).toBeInTheDocument();
    expect(queryByText('OK')).toBeNull(); // antd's default footer stays out of the way
    expect(container.querySelector('.ant-modal-footer')).not.toBeNull();
  });

  it('calls onClose from the close button', () => {
    const onClose = vi.fn();
    const { container } = open({ onClose });
    fireEvent.click(container.querySelector('.ant-modal-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the mask behind the dialog is clicked', () => {
    // The old hand-written overlay closed on a bare click. antd guards
    // against a drag that starts inside the dialog and ends on the mask,
    // so it only closes when mousedown and mouseup both land on the wrap
    // -- hence the full sequence rather than a lone click event.
    const onClose = vi.fn();
    const { container } = open({ onClose });
    const wrap = container.querySelector('.ant-modal-wrap');
    fireEvent.mouseDown(wrap);
    fireEvent.mouseUp(wrap);
    fireEvent.click(wrap);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the App.css hooks the page bodies are styled against', () => {
    const { container } = open({ size: 'wide' });
    const dialog = container.querySelector('.ant-modal');
    // `.modal .form-group label`, `.modal .detail-grid` and friends in
    // App.css only apply while the dialog still carries these classes.
    expect(dialog).toHaveClass('modal');
    expect(dialog).toHaveClass('modal-wide');
    expect(container.querySelector('.modal-body')).not.toBeNull();
  });

  it('widens for size="wide" and keeps the default width otherwise', () => {
    const wide = open({ size: 'wide' });
    expect(wide.container.querySelector('.ant-modal')).toHaveStyle({ width: '1280px' });
    const plain = open();
    expect(plain.container.querySelector('.ant-modal')).toHaveStyle({ width: '480px' });
  });
});
