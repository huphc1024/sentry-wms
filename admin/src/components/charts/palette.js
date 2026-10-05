// Chart colours are theme tokens from App.css, so charts follow light /
// dark mode without a re-render. Never write a hex value here.
export const SERIES_COLORS = [
  'var(--accent)',
  'var(--info)',
  'var(--success)',
  'var(--purple)',
  'var(--warning)',
  'var(--danger)',
];

export const GRID_COLOR = 'var(--border)';
export const AXIS_COLOR = 'var(--text-secondary)';

export const TOOLTIP_STYLE = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 12,
};

export const AXIS_TICK = { fill: AXIS_COLOR, fontSize: 11 };

/** 'YYYY-MM-DD' -> 'MM-DD' for compact x-axis ticks. */
export function shortDate(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(5, 10) : value;
}
