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

vi.mock('../warehouse.jsx', () => ({
  useWarehouse: () => ({ warehouseId: 7, warehouse: { warehouse_id: 7 } }),
}));

import AiAssistant from '../pages/AiAssistant.jsx';

const reply = (body, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const zones = {
  tool: 'zone_utilisation',
  rows: [{ zone_code: 'A', zone_name: 'Pick A', zone_type: 'PICKING', bins_total: 10, bins_occupied: 9, occupancy_pct: 90, units: 120 }],
  row_count: 1,
  truncated: false,
};

function renderPage() {
  return render(
    <LocaleProvider>
      <AiAssistant />
    </LocaleProvider>,
  );
}

describe('AiAssistant page', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('quick mode: input disabled, chips run a preset tool and render a table', async () => {
    getMock.mockImplementation(() => reply({ enabled: true, mode: 'rules' }));
    postMock.mockImplementation(() => reply({
      mode: 'quick', answer: null, tools_used: ['zone_utilisation'], data: [zones],
    }));
    const view = renderPage();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/admin/ai/status', expect.anything()));
    expect(view.getByLabelText('Your question').disabled).toBe(true);
    expect(view.getByRole('button', { name: 'Ask' }).disabled).toBe(true);

    fireEvent.click(view.getByRole('button', { name: 'Which zones are full?' }));
    await waitFor(() => expect(view.getByText('Pick A')).toBeTruthy());
    expect(postMock).toHaveBeenCalledWith('/admin/ai/ask', {
      warehouse_id: 7, lang: 'en', quick: 'zone_utilisation',
    });
    expect(view.getAllByText('Occupancy %').length).toBeGreaterThan(0);
    expect(view.getAllByText('Quick').length).toBeGreaterThan(0);
  });

  it('llm mode: sends question with history and renders the answer', async () => {
    getMock.mockImplementation(() => reply({ enabled: true, mode: 'llm' }));
    postMock
      .mockImplementationOnce(() => reply({
        mode: 'llm', answer: 'Zone **A** is fullest.\n- A: 90%', tools_used: ['zone_utilisation'], data: [zones],
      }))
      .mockImplementationOnce(() => reply({
        mode: 'llm', answer: 'Nothing else.', tools_used: [], data: [],
      }));
    const view = renderPage();
    const input = view.getByLabelText('Your question');
    await waitFor(() => expect(input.disabled).toBe(false));

    fireEvent.change(input, { target: { value: 'which zone is full?' } });
    fireEvent.click(view.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(view.getByText('A: 90%')).toBeTruthy());
    expect(view.getAllByText('A').some((el) => el.tagName === 'STRONG')).toBe(true);
    expect(postMock.mock.calls[0][1]).toEqual({
      warehouse_id: 7, lang: 'en', question: 'which zone is full?', history: [],
    });

    fireEvent.change(input, { target: { value: 'anything else?' } });
    fireEvent.click(view.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(view.getByText('Nothing else.')).toBeTruthy());
    expect(postMock.mock.calls[1][1].history).toEqual([
      { role: 'user', text: 'which zone is full?' },
      { role: 'assistant', text: 'Zone **A** is fullest.\n- A: 90%' },
    ]);
  });

  it('shows a friendly message when the LLM is unavailable and falls back to quick', async () => {
    getMock.mockImplementation(() => reply({ enabled: true, mode: 'llm' }));
    postMock.mockImplementation(() => reply({ error: 'ai_llm_unavailable', mode: 'quick' }, 503));
    const view = renderPage();
    const input = view.getByLabelText('Your question');
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(view.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toMatch(/not available now/));
    expect(input.disabled).toBe(true);
  });

  it('shows the failure message on ai_llm_failed', async () => {
    getMock.mockImplementation(() => reply({ enabled: true, mode: 'llm' }));
    postMock.mockImplementation(() => reply({ error: 'ai_llm_failed', mode: 'llm' }, 503));
    const view = renderPage();
    const input = view.getByLabelText('Your question');
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(view.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toMatch(/could not answer/));
  });
});
