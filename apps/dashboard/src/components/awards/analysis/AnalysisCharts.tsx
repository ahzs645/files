import type {
  ContractAwardBreakdownRow,
  ContractAwardTrendPoint,
  ContractAwardTypeMixRow,
} from "@bcbid/shared";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AnalysisChartCard } from "./AnalysisChartCard";
import {
  formatCompactNumber,
  formatCount,
  formatCurrency,
  formatPercentage,
} from "../../../lib/formatting";

const palette = ["#72bfff", "#2fd89f", "#ff9f66", "#f6d56a", "#ff6b6b", "#94a3b8"];
const tooltipStyle = {
  backgroundColor: "var(--color-bg-surface-strong)",
  border: "1px solid var(--color-border-default)",
  borderRadius: 8,
  color: "var(--color-text-primary)",
};
const tooltipTextStyle = { color: "var(--color-text-primary)" };
const metricLabels = { totalValue: "Award value", awardCount: "Award count", shareOfValue: "Share of value" };

function coerceChartValue(value: string | number | readonly (string | number)[] | undefined) {
  if (Array.isArray(value)) {
    return coerceChartValue(value[0]);
  }
  return typeof value === "number" ? value : Number(value ?? 0);
}

function EmptyChartState() {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-border-default text-sm text-text-tertiary">
      No data for the current filter set.
    </div>
  );
}

export function TrendChartCard({
  title,
  description,
  data,
  dataKey,
  color,
  mode,
}: {
  title: string;
  description: string;
  data: ContractAwardTrendPoint[];
  dataKey: "totalValue" | "awardCount";
  color: string;
  mode: "currency" | "count";
}) {
  return (
    <AnalysisChartCard title={title} description={description}>
      {data.length === 0 ? (
        <EmptyChartState />
      ) : (
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} aria-label={title}>
              <defs>
                <linearGradient id={`gradient-${title}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.38} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border-default)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) =>
                  mode === "currency"
                    ? formatCompactNumber(Number(value))
                    : formatCount(Number(value))
                }
              />
              <Tooltip
                cursor={{ stroke: "var(--color-border-strong)" }}
                contentStyle={tooltipStyle}
                labelStyle={tooltipTextStyle}
                itemStyle={tooltipTextStyle}
                formatter={(value) =>
                  mode === "currency"
                    ? formatCurrency(coerceChartValue(value))
                    : formatCount(coerceChartValue(value))
                }
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                name={metricLabels[dataKey]}
                stroke={color}
                fill={`url(#gradient-${title})`}
                strokeWidth={2.2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisChartCard>
  );
}

export function BreakdownBarChartCard({
  title,
  description,
  rows,
  metric,
}: {
  title: string;
  description: string;
  rows: ContractAwardBreakdownRow[];
  metric: "totalValue" | "awardCount" | "shareOfValue";
}) {
  return (
    <AnalysisChartCard title={title} description={description}>
      {rows.length === 0 ? (
        <EmptyChartState />
      ) : (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} aria-label={title} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid stroke="var(--color-border-default)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) =>
                  metric === "totalValue"
                    ? formatCompactNumber(Number(value))
                    : metric === "shareOfValue"
                      ? formatPercentage(Number(value))
                      : formatCount(Number(value))
                }
              />
              <YAxis
                type="category"
                dataKey="label"
                width={120}
                tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--color-bg-hover)" }}
                contentStyle={tooltipStyle}
                labelStyle={tooltipTextStyle}
                itemStyle={tooltipTextStyle}
                formatter={(value) =>
                  metric === "totalValue"
                    ? formatCurrency(coerceChartValue(value))
                    : metric === "shareOfValue"
                      ? formatPercentage(coerceChartValue(value), 1)
                      : formatCount(coerceChartValue(value))
                }
              />
              <Bar name={metricLabels[metric]} dataKey={metric} radius={[10, 10, 10, 10]}>
                {rows.map((row, index) => (
                  <Cell
                    key={row.key}
                    fill={palette[index % palette.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalysisChartCard>
  );
}

export function TypeMixStackedBarCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: ContractAwardTypeMixRow[];
}) {
  if (rows.length === 0) {
    return (
      <AnalysisChartCard title={title} description={description}>
        <EmptyChartState />
      </AnalysisChartCard>
    );
  }

  const typeKeys = [...new Set(rows.flatMap((row) => row.breakdown.map((item) => item.label)))];
  const colors = [...palette, "#c4a7e7", "#5eead4", "#f9a8d4", "#a3e635", "#38bdf8", "#fb7185", "#fbbf24", "#818cf8", "#34d399", "#e879f9", "#f97316", "#a8a29e", "#22d3ee", "#bef264"];
  const chartData = rows.map((row) =>
    Object.fromEntries([
      ["label", row.label],
      ...typeKeys.map((typeKey, index) => [
        `type${index}`,
        row.breakdown.find((item) => item.label === typeKey)?.totalValue ?? 0,
      ]),
    ]),
  );

  return (
    <AnalysisChartCard title={title} description={description}>
      <div style={{ height: Math.max(240, rows.length * 48 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} aria-label={title} layout="vertical" margin={{ left: 0, right: 12 }}>
            <CartesianGrid stroke="var(--color-border-default)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => formatCompactNumber(Number(value))}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={130}
              tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={0}
              tickFormatter={(value) => String(value).length > 20 ? String(value).slice(0, 19) + "…" : String(value)}
            />
            <Tooltip
              cursor={{ fill: "var(--color-bg-hover)" }}
              content={({ active, payload, label }) => active && payload?.length ? (
                <div className="analysis-mix-tooltip" style={tooltipStyle}>
                  <p className="font-medium">{label}</p>
                  {payload.filter(item => coerceChartValue(item.value) !== 0).map(item => (
                    <div key={String(item.dataKey)} className="analysis-mix-tooltip-row">
                      <span>{item.name}</span>
                      <span>{formatCurrency(coerceChartValue(item.value))}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            />
            {typeKeys.map((typeKey, index) => (
              <Bar
                key={typeKey}
                name={typeKey}
                dataKey={`type${index}`}
                stackId="mix"
                fill={colors[index % colors.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="analysis-type-legend">
        <summary>Procurement types ({typeKeys.length})</summary>
        <ul>
          {typeKeys.map((typeKey, index) => (
            <li key={typeKey}>
              <span aria-hidden="true" style={{ backgroundColor: colors[index % colors.length] }} />
              {typeKey}
            </li>
          ))}
        </ul>
      </details>
    </AnalysisChartCard>
  );
}
