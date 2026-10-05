import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../i18n/locale.jsx';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../api.js', () => ({
  api: {
    get: (...args) => getMock(...args),
    post: (...args) => postMock(...args),
  },
}));

import AiSuggestions from '../components/AiSuggestions.jsx';

const reply = (body, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const payload = (mode = 'llm', suggestions) => ({
  mode,
  kind: 'replenish',
  generated_at: '2026-10-05T00:00:00Z',
  suggestions: suggestions ?? [{
    id: 's1',
    priority: 'high',
    title: 'Reorder widgets',
    detail: 'Stock below minimum',
    sku: 'SKU-A',
    item_name: 'Widget',
    bin_code: 'A-01',
    quantity: 12,
    due_date: '2026-10-20',
    action: 'reorder',
  }],
});

function renderPanel() {
  return render(
    <LocaleProvider>
      <AiSuggestions
        kind="replenish"
        warehouseId={7}
        request={{ path: '/admin/ai/replenishment', body: { warehouse_id: 7 } }}
      />
    </LocaleProvider>,
  );
}

async function open(view) {
  fireEvent.click(view.getByRole('button', { name: /AI suggestions/ }));
  fireEvent.click(view.getByRole('button', { name: 'Get suggestions' }));
}

describe('AiSuggestions', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(() => reply({ enabled: true, mode: 'llm' }));
  });

  it('is collapsed and only probes status on mount', async () => {
    const view = renderPanel();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/admin/ai/status', expect.anything()));
    expect(postMock).not.toHaveBeenCalled();
    expect(view.queryByRole('button', { name: 'Get suggestions' })).toBeNull();
  });

  it('posts with the UI locale and renders suggestions', async () => {
    postMock.mockImplementation(() => reply(payload('llm')));
    const view = renderPanel();
    await open(view);
    await view.findByText('Reorder widgets');
    expect(postMock).toHaveBeenCalledWith('/admin/ai/replenishment', { warehouse_id: 7, lang: 'en' });
    expect(view.getByText('High')).toBeInTheDocument();
    expect(view.getByText('Stock below minimum')).toBeInTheDocument();
    expect(view.getByText('SKU SKU-A')).toBeInTheDocument();
    expect(view.getByText('Bin A-01')).toBeInTheDocument();
    expect(view.getByText('Qty 12')).toBeInTheDocument();
    expect(view.getByText('Due 2026-10-20')).toBeInTheDocument();
    expect(view.getByText('Reorder')).toBeInTheDocument();
    expect(view.getByText('AI')).toBeInTheDocument();
    expect(view.getByText(/advisory/)).toBeInTheDocument();
  });

  it('labels rule-based results as Rules', async () => {
    postMock.mockImplementation(() => reply(payload('rules')));
    const view = renderPanel();
    await open(view);
    await view.findByText('Rules');
    expect(view.queryByText('AI')).toBeNull();
  });

  it('hides itself when AI is disabled', async () => {
    getMock.mockImplementation(() => reply({ enabled: false, mode: 'rules' }));
    const view = renderPanel();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await waitFor(() => expect(view.queryByRole('button', { name: /AI suggestions/ })).toBeNull());
  });

  it('shows a muted message on 503 ai_disabled', async () => {
    postMock.mockImplementation(() => reply({ error: 'ai_disabled' }, 503));
    const view = renderPanel();
    await open(view);
    await view.findByText('AI suggestions are turned off.');
  });

  it('shows rate-limit and permission messages', async () => {
    postMock.mockImplementationOnce(() => reply({}, 429));
    const view = renderPanel();
    await open(view);
    await view.findByText('Too many requests. Try again in a minute.');
    postMock.mockImplementationOnce(() => reply({ error: 'Permission denied' }, 403));
    fireEvent.click(view.getByRole('button', { name: 'Get suggestions' }));
    await view.findByText('You do not have permission to access this resource.');
  });

  it('sends feedback once and shows the thanks state', async () => {
    postMock.mockImplementation((path) => (
      path === '/admin/ai/feedback' ? reply({ ok: true }) : reply(payload('llm'))
    ));
    const view = renderPanel();
    await open(view);
    await view.findByText('Reorder widgets');
    fireEvent.click(view.getByRole('button', { name: 'Helpful' }));
    await view.findByText('Thanks for the feedback');
    expect(postMock).toHaveBeenCalledWith('/admin/ai/feedback', {
      suggestion_id: 's1', kind: 'replenish', mode: 'llm', rating: 1, warehouse_id: 7,
    });
    expect(view.queryByRole('button', { name: 'Helpful' })).toBeNull();
  });

  it('renders put-away facts: source, destination and other bins', async () => {
    postMock.mockImplementation((path) => (path === '/admin/ai/feedback' ? reply({ ok: true }) : reply({
      mode: 'rules',
      kind: 'putaway',
      generated_at: '2026-10-05T00:00:00Z',
      suggestions: [{
        id: 'p1', priority: 'medium', title: 'Put TST-001 away to A-01-01', detail: 'Move 7',
        sku: 'TST-001', item_name: 'Fly', bin_code: 'A-01-01', quantity: 7, due_date: null,
        action: 'put_away', source_bin: 'RECV-01', alternatives: ['B-01-01', 'BULK-02'],
      }],
    })));
    const view = render(
      <LocaleProvider>
        <AiSuggestions
          kind="putaway"
          warehouseId={1}
          request={{ path: '/admin/ai/putaway', body: { warehouse_id: 1 } }}
        />
      </LocaleProvider>,
    );
    await open(view);
    await view.findByText('Put TST-001 away to A-01-01');
    expect(postMock).toHaveBeenCalledWith('/admin/ai/putaway', { warehouse_id: 1, lang: 'en' });
    expect(view.getByText('From RECV-01')).toBeInTheDocument();
    expect(view.getByText('Bin A-01-01')).toBeInTheDocument();
    expect(view.getByText('Other bins: B-01-01, BULK-02')).toBeInTheDocument();
    expect(view.getByText('Put away')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Not helpful' }));
    await view.findByText('Thanks for the feedback');
    expect(postMock).toHaveBeenCalledWith('/admin/ai/feedback', {
      suggestion_id: 'p1', kind: 'putaway', mode: 'rules', rating: -1, warehouse_id: 1,
    });
  });

  it('renders backorder facts by order number only', async () => {
    postMock.mockImplementation(() => reply({
      mode: 'rules',
      kind: 'backorder',
      generated_at: '2026-10-05T00:00:00Z',
      suggestions: [{
        id: 'b1', priority: 'high', title: 'SO-9: transfer stock from WH-B', detail: 'Enough stock',
        sku: 'TST-004', item_name: 'Nymph', bin_code: null, quantity: 3, due_date: null,
        action: 'transfer', so_number: 'SO-9', source_warehouse: 'WH-B',
      }],
    }));
    const view = render(
      <LocaleProvider>
        <AiSuggestions
          kind="backorder"
          warehouseId={1}
          request={{ path: '/admin/ai/backorders', body: { warehouse_id: 1 } }}
        />
      </LocaleProvider>,
    );
    await open(view);
    await view.findByText('SO-9: transfer stock from WH-B');
    expect(view.getByText('Order SO-9')).toBeInTheDocument();
    expect(view.getByText('Source warehouse WH-B')).toBeInTheDocument();
    expect(view.getByText('Transfer stock')).toBeInTheDocument();
    expect(view.queryByText(/^Bin /)).toBeNull();
  });

  it('shows an empty state', async () => {
    postMock.mockImplementation(() => reply(payload('rules', [])));
    const view = renderPanel();
    await open(view);
    await view.findByText('Nothing to suggest right now. Looks good.');
  });
});
