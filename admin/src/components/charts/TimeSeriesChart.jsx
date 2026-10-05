import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AXIS_TICK, GRID_COLOR, SERIES_COLORS, TOOLTIP_STYLE, shortDate,
} from './palette.js';

/**
 * Area chart over dates. `series` is [{ key, name, data: [{date, value}] }];
 * the series are merged on `date` so several can share one axis.
 */
export default function TimeSeriesChart({ series, height = 240 }) {
  const byDate = new Map();
  series.forEach((s) => {
    (s.data || []).forEach((p) => {
      const row = byDate.get(p.date) || { date: p.date };
      row[s.key] = p.value;
      byDate.set(p.date, row);
    });
  });
  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} stroke={GRID_COLOR} />
        <YAxis tick={AXIS_TICK} stroke={GRID_COLOR} allowDecimals={false} width={48} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {series.length > 1 && <Legend />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            fillOpacity={0.12}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
