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
  Legend,
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
            <AreaChart data={data}>
              <defs>
                <linearGradient id={`gradient-${title}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.38} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#8fa6b2", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#8fa6b2", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) =>
                  mode === "currency"
                    ? formatCompactNumber(Number(value))
                    : formatCount(Number(value))
                }
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(9,13,18,0.95)",
                  border: "1px solid rgba(189,216,227,0.12)",
                  borderRadius: 16,
                }}
                formatter={(value) =>
                  mode === "currency"
                    ? formatCurrency(coerceChartValue(value))
                    : formatCount(coerceChartValue(value))
                }
              />
              <Area
                type="monotone"
                dataKey={dataKey}
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
            <BarChart data={rows} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: "#8fa6b2", fontSize: 12 }}
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
                tick={{ fill: "#8fa6b2", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(9,13,18,0.95)",
                  border: "1px solid rgba(189,216,227,0.12)",
                  borderRadius: 16,
                }}
                formatter={(value) =>
                  metric === "totalValue"
                    ? formatCurrency(coerceChartValue(value))
                    : metric === "shareOfValue"
                      ? formatPercentage(coerceChartValue(value), 1)
                      : formatCount(coerceChartValue(value))
                }
              />
              <Bar dataKey={metric} radius={[10, 10, 10, 10]}>
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
  const chartData = rows.map((row) =>
    Object.fromEntries([
      ["label", row.label],
      ...typeKeys.map((typeKey) => [
        typeKey,
        row.breakdown.find((item) => item.label === typeKey)?.totalValue ?? 0,
      ]),
    ]),
  );

  return (
    <AnalysisChartCard title={title} description={description}>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#8fa6b2", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={-18}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tick={{ fill: "#8fa6b2", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => formatCompactNumber(Number(value))}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(9,13,18,0.95)",
                border: "1px solid rgba(189,216,227,0.12)",
                borderRadius: 16,
              }}
              formatter={(value) => formatCurrency(coerceChartValue(value))}
            />
            <Legend wrapperStyle={{ color: "#8fa6b2" }} />
            {typeKeys.map((typeKey, index) => (
              <Bar
                key={typeKey}
                dataKey={typeKey}
                stackId="mix"
                fill={palette[index % palette.length]}
                radius={index === typeKeys.length - 1 ? [8, 8, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </AnalysisChartCard>
  );
}
