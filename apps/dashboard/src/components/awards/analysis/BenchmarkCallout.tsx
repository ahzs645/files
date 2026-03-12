import type { ContractAwardBenchmark } from "@bcbid/shared";

import { AnalysisChartCard } from "./AnalysisChartCard";
import {
  formatCount,
  formatCurrency,
  formatPercentage,
} from "../../../lib/formatting";

export function BenchmarkCallout({
  benchmark,
  concentrationLabel,
}: {
  benchmark: ContractAwardBenchmark;
  concentrationLabel: string;
}) {
  const rows = [
    {
      label: "Median award value",
      entity: formatCurrency(benchmark.entityMedianAwardValue),
      peer: formatCurrency(benchmark.peerMedianAwardValue),
    },
    {
      label: "Average award value",
      entity: formatCurrency(benchmark.entityAverageAwardValue),
      peer: formatCurrency(benchmark.peerAverageAwardValue),
    },
    {
      label: concentrationLabel,
      entity: formatPercentage(benchmark.entityConcentration),
      peer: formatPercentage(benchmark.peerMedianConcentration),
    },
    {
      label: "Award count",
      entity: formatCount(benchmark.entityAwardCount),
      peer: formatCount(benchmark.peerMedianAwardCount),
    },
  ];

  return (
    <AnalysisChartCard
      title="Peer Benchmark"
      description="Entity metrics are shown against peer medians under the current filter set."
    >
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid gap-3 rounded-xl border border-border-subtle bg-bg-subtle px-4 py-3 md:grid-cols-[1.4fr_1fr_1fr]"
          >
            <div className="text-sm font-medium text-text-primary">{row.label}</div>
            <div className="text-sm text-text-secondary">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                Entity
              </span>
              <div className="mt-1 text-text-primary">{row.entity}</div>
            </div>
            <div className="text-sm text-text-secondary">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                Peer median
              </span>
              <div className="mt-1 text-text-primary">{row.peer}</div>
            </div>
          </div>
        ))}
      </div>
    </AnalysisChartCard>
  );
}
