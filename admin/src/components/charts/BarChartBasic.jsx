import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AXIS_TICK, GRID_COLOR, SERIES_COLORS, TOOLTIP_STYLE,
} from './palette.js';

/** Single-series vertical bar chart. `name` labels the series in the tooltip. */
export default function BarChartBasic({
  data, xKey, yKey, name, color = SERIES_COLORS[0], height = 240,
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} stroke={GRID_COLOR} interval={0} />
        <YAxis tick={AXIS_TICK} stroke={GRID_COLOR} allowDecimals={false} width={48} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--surface)' }} />
        <Bar dataKey={yKey} name={name} fill={color} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
