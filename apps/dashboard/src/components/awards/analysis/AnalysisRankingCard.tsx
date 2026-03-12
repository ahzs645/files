import { Link } from "@tanstack/react-router";
import type { ContractAwardRankingRow } from "@bcbid/shared";
import { ArrowRight } from "lucide-react";

import { AnalysisChartCard } from "./AnalysisChartCard";
import {
  formatCompactNumber,
  formatCount,
  formatCurrency,
  formatPercentage,
} from "../../../lib/formatting";

export function AnalysisRankingCard({
  title,
  description,
  rows,
  entityKind,
  metric = "value",
}: {
  title: string;
  description: string;
  rows: ContractAwardRankingRow[];
  entityKind: "supplier" | "organization";
  metric?: "value" | "count" | "share";
}) {
  return (
    <AnalysisChartCard title={title} description={description}>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default px-4 py-8 text-center text-sm text-text-tertiary">
            No rows match the current filters.
          </div>
        ) : (
          rows.map((row, index) => {
            const target =
              entityKind === "supplier"
                ? "/contract-awards/analysis/suppliers/$supplierKey"
                : "/contract-awards/analysis/organizations/$organizationKey";
            const params =
              entityKind === "supplier"
                ? { supplierKey: row.key }
                : { organizationKey: row.key };

            const metricText =
              metric === "count"
                ? `${formatCount(row.awardCount)} awards`
                : metric === "share"
                  ? `${formatPercentage(row.shareOfValue)} share of value`
                  : formatCurrency(row.totalValue, { compact: true });

            return (
              <Link
                key={row.key}
                to={target}
                params={params}
                className="group flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-subtle px-4 py-3 transition-colors hover:border-border-strong hover:bg-bg-hover"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-muted text-xs font-semibold text-accent">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
                        {row.label}
                      </div>
                      <div className="mt-1 text-xs text-text-tertiary">
                        {row.secondaryLabel ?? `${formatCompactNumber(row.totalValue)} total value`}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-medium text-text-primary">{metricText}</div>
                    <div className="mt-1 text-xs text-text-tertiary">
                      {formatPercentage(row.shareOfAwards)} of awards
                    </div>
                  </div>
                  <ArrowRight
                    size={14}
                    className="text-text-tertiary transition-colors group-hover:text-accent"
                  />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </AnalysisChartCard>
  );
}
