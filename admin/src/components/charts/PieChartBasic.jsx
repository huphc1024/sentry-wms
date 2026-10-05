import {
  Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip,
} from 'recharts';
import { SERIES_COLORS, TOOLTIP_STYLE } from './palette.js';

/** Donut chart over [{ [nameKey]: label, [valueKey]: number }]. */
export default function PieChartBasic({ data, nameKey, valueKey, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius="55%"
          outerRadius="80%"
          stroke="var(--panel)"
        >
          {data.map((row, i) => (
            <Cell key={row[nameKey]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
