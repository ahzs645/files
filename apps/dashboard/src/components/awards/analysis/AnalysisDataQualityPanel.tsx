import type { ContractAwardDataQualitySummary } from "@bcbid/shared";
import { AlertTriangle, BadgeAlert, FileWarning, ScanSearch } from "lucide-react";

import { AnalysisChartCard } from "./AnalysisChartCard";
import { formatCount, formatPercentage } from "../../../lib/formatting";

const rows = [
  {
    key: "placeholderSupplierRate",
    label: "Placeholder supplier share",
    countKey: "placeholderSupplierCount",
    icon: BadgeAlert,
  },
  {
    key: "missingContractNumberRate",
    label: "Missing contract number",
    countKey: "missingContractNumberCount",
    icon: FileWarning,
  },
  {
    key: "missingSupplierAddressRate",
    label: "Missing supplier address",
    countKey: "missingSupplierAddressCount",
    icon: ScanSearch,
  },
  {
    key: "missingContactEmailRate",
    label: "Missing contact email",
    countKey: "missingContactEmailCount",
    icon: AlertTriangle,
  },
  {
    key: "missingJustificationRate",
    label: "Missing justification",
    countKey: "missingJustificationCount",
    icon: FileWarning,
  },
  {
    key: "futureDatedAwardRate",
    label: "Future-dated awards",
    countKey: "futureDatedAwardCount",
    icon: BadgeAlert,
  },
] as const;

export function AnalysisDataQualityPanel({
  summary,
}: {
  summary: ContractAwardDataQualitySummary;
}) {
  return (
    <AnalysisChartCard
      title="Data Quality"
      description="Quality caveats stay visible, especially where placeholder suppliers and missing fields can distort rankings."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const Icon = row.icon;
          const rate = summary[row.key];
          const count = summary[row.countKey];

          return (
            <div
              key={row.key}
              className="rounded-xl border border-border-subtle bg-bg-subtle p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-text-primary">{row.label}</div>
                <Icon size={15} className="text-orange" />
              </div>
              <div className="mt-3 text-xl font-semibold text-text-primary">
                {formatPercentage(rate)}
              </div>
              <div className="mt-1 text-sm text-text-secondary">
                {formatCount(count)} of {formatCount(summary.totalRows)} rows
              </div>
            </div>
          );
        })}
      </div>
    </AnalysisChartCard>
  );
}
