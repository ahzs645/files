import type { ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ScatterChart, Scatter, ZAxis, ReferenceLine, BarChart, Bar } from 'recharts';
import type { Overview, Slice, Matrix, Trends, Comparison } from './model';

export const count = (n: number) => n.toLocaleString('en-CA');
export const percent = (n: number | null) => n === null ? '—' : new Intl.NumberFormat('en-CA', { style: 'percent', maximumFractionDigits: 1 }).format(n);
export function money(n: number | null, currency: string, compact = false) {
  if (n === null) return '—';
  try { if (currency !== 'UNSPECIFIED') return new Intl.NumberFormat('en-CA', { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(n); } catch { /* Preserve an unfamiliar source currency label. */ }
  return `${new Intl.NumberFormat('en-CA', { notation: compact ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)} ${currency === 'UNSPECIFIED' ? 'units' : currency}`;
}
export const compact = (n: number) => new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const text = 'var(--color-text-secondary)';
const tooltipStyle = { backgroundColor: 'var(--color-bg-surface-strong)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 12 };
export function Panel({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="market-panel"><header><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}
export function Metrics({ items }: { items: { label: string; value: ReactNode; detail?: string }[] }) {
  return <div className="market-metrics">{items.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.detail && <small>{item.detail}</small>}</div>)}</div>;
}
export function LinePlot({ data, metric, currency, pareto = false }: { data: any[]; metric: 'value' | 'count'; currency: string; pareto?: boolean }) {
  const key = pareto ? 'share' : metric;
  return <div className="market-plot"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 18, left: 0, bottom: 8 }} accessibilityLayer>
    <CartesianGrid vertical={false} stroke="var(--color-border-default)" />
    <XAxis type={pareto ? 'number' : 'category'} domain={pareto ? [1, 'dataMax'] : undefined} tickFormatter={pareto ? n => count(Number(n)) : undefined} dataKey={pareto ? 'rank' : 'month'} tick={{ fill: text, fontSize: 12 }} minTickGap={28} axisLine={false} tickLine={false} />
    <YAxis tick={{ fill: text, fontSize: 12 }} width={58} axisLine={false} tickLine={false} domain={pareto ? [0, 100] : ['auto', 'auto']} ticks={pareto ? [0, 25, 50, 75, 100] : undefined} allowDataOverflow={pareto} tickFormatter={n => pareto ? percent(Number(n) / 100) : compact(Number(n))} />
    {pareto && <ReferenceLine y={80} stroke="var(--color-text-tertiary)" strokeDasharray="4 4" />}
    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-primary)' }} itemStyle={{ color: 'var(--color-text-primary)' }} cursor={{ stroke: 'var(--color-border-strong)' }} formatter={n => pareto ? percent(Number(n) / 100) : metric === 'value' ? money(Number(n), currency) : count(Number(n))} labelFormatter={label => pareto ? `Leading ${count(Number(label))} suppliers` : label} />
    <Line name={pareto ? 'Cumulative value share' : metric === 'value' ? 'Recorded award value' : 'Saved awards'} type="linear" dataKey={key} stroke="var(--color-accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
  </LineChart></ResponsiveContainer></div>;
}
export function DependencePlot({ rows, currency, inspect }: { rows: Overview['buyers']; currency: string; inspect: (slice: Slice, title: string) => void }) {
  const data = rows.filter(r => r.dependence !== null).slice(0, 100).map(r => ({ ...r, dependencePercent: r.dependence! * 100 }));
  return <div className="market-plot"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 15, right: 20, bottom: 25, left: 5 }} accessibilityLayer>
    <CartesianGrid stroke="var(--color-border-default)" />
    <XAxis type="number" dataKey="count" name="Award count" tick={{ fill: text, fontSize: 12 }} tickFormatter={compact} label={{ value: 'Saved award count', position: 'insideBottom', offset: -16, fill: text, fontSize: 12 }} />
    <YAxis type="number" dataKey="dependencePercent" name="Top supplier share" domain={[0, 100]} tick={{ fill: text, fontSize: 12 }} tickFormatter={n => n + '%'} width={52} />
    <ZAxis type="number" dataKey="positiveValue" range={[45, 600]} />
    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
      const r = payload?.[0]?.payload;
      return active && r ? <div className="market-tooltip" style={tooltipStyle}><strong>{r.name}</strong><p>{count(r.count)} awards · {money(r.value, currency)}</p><p>Top supplier: {r.leading}</p><p>{percent(r.dependence)} of positive award value</p></div> : null;
    }} />
    <Scatter data={data} fill="var(--color-accent)" fillOpacity={.65} isAnimationActive={false} onClick={point => { const r = point.payload ?? point; inspect({ buyer: r.name }, r.name); }} />
  </ScatterChart></ResponsiveContainer></div>;
}
export function ComparisonPlot({ data, currency }: { data: Comparison; currency: string }) {
  return <div className="market-plot" style={{ height: 380 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.rows.slice(0, 8)} layout="vertical" margin={{ right: 18, top: 8, bottom: 8 }} accessibilityLayer>
    <CartesianGrid horizontal={false} stroke="var(--color-border-default)" />
    <XAxis type="number" tick={{ fill: text, fontSize: 12 }} tickFormatter={compact} />
    <YAxis type="category" dataKey="name" tick={{ fill: text, fontSize: 12 }} width={120} tickFormatter={n => String(n).length > 18 ? String(n).slice(0, 17) + '…' : String(n)} interval={0} />
    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-primary)' }} itemStyle={{ color: 'var(--color-text-primary)' }} cursor={{ fill: 'var(--color-bg-hover)' }} formatter={n => data.metric === 'value' ? money(Number(n), currency) : count(Number(n))} />
    <Bar name="Period A" dataKey="a" fill="var(--color-text-tertiary)" isAnimationActive={false} />
    <Bar name="Period B" dataKey="b" fill="var(--color-accent)" isAnimationActive={false} />
  </BarChart></ResponsiveContainer></div>;
}
export function Heatmap({ rows, columns, cells, metric, currency, normalized, inspect, months = false }: {
  rows: string[]; columns: string[]; cells: Matrix['cells'] | Trends['cells']; metric: 'value' | 'count'; currency: string; normalized: boolean; months?: boolean;
  inspect: (slice: Slice, title: string) => void;
}) {
  const index = new Map(cells.map(c => [JSON.stringify([c.row, c.column]), c]));
  const maximum = Math.max(1, ...cells.map(c => Math.max(0, c[metric])));
  const totals = new Map(rows.map(row => [row, cells.filter(c => c.row === row).reduce((n, c) => n + Math.max(0, c[metric]), 0)]));
  if (!rows.length || !columns.length) return <p className="market-empty">No recorded awards match this view.</p>;
  return <>
    <p className="market-caption">Select a cell for its awards.{normalized ? ' Values are each row’s share.' : ''}</p>
    <div className="market-heat-scroll" tabIndex={0} aria-label="Scrollable award heatmap"><table className="market-heatmap"><thead><tr><th scope="col">Buyer</th>{columns.map(column => <th scope="col" key={column} title={column}>{months ? new Date(column + '-01T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' }) : column}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row}><th scope="row">{row}</th>{columns.map(column => {
        const cell = index.get(JSON.stringify([row, column]))!;
        const ratio = Math.max(0, cell[metric]) / (normalized ? totals.get(row) || 1 : maximum);
        const raw = metric === 'value' ? money(cell.value, currency) : `${count(cell.count)} awards`;
        return <td key={column}><button type="button" style={{ backgroundColor: `color-mix(in srgb, var(--color-accent) ${cell.count ? 12 + ratio * 68 : 0}%, var(--color-bg-surface))` }} aria-label={`${row}, ${column}: ${raw}; ${count(cell.count)} saved awards`} title={`${row} · ${column}\n${raw} · ${count(cell.count)} saved awards`} onClick={() => inspect(cell.slice, `${row} · ${column}`)}><span>{normalized ? percent(ratio) : metric === 'value' ? compact(cell.value) : count(cell.count)}</span></button></td>;
      })}</tr>)}</tbody></table></div>
  </>;
}
