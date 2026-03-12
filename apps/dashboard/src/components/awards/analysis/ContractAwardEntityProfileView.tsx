import { Building2, CalendarRange, Scale, Users } from "lucide-react";
import type {
  ContractAwardAnalysisEntityKind,
  ContractAwardAnalysisFilters,
  ContractAwardEntityProfile,
} from "@bcbid/shared";

import { ContractAwardsTable } from "../ContractAwardsTable";
import { Card, CardHeader } from "../../ui/Card";
import { AnalysisDataQualityPanel } from "./AnalysisDataQualityPanel";
import { AnalysisFilterBar } from "./AnalysisFilterBar";
import { AnalysisFindingsPanel } from "./AnalysisFindingsPanel";
import { AnalysisMetricCard } from "./AnalysisMetricCard";
import { AnalysisRankingCard } from "./AnalysisRankingCard";
import { BenchmarkCallout } from "./BenchmarkCallout";
import {
  BreakdownBarChartCard,
  TrendChartCard,
} from "./AnalysisCharts";
import {
  formatCount,
  formatCurrency,
  formatDateLabel,
  formatPercentage,
} from "../../../lib/formatting";

export function ContractAwardEntityProfileView({
  profile,
  filters,
  onFiltersChange,
  onResetFilters,
}: {
  profile: ContractAwardEntityProfile;
  filters: ContractAwardAnalysisFilters;
  onFiltersChange: (next: ContractAwardAnalysisFilters) => void;
  onResetFilters: () => void;
}) {
  const entityLabel = profile.entityKind === "supplier" ? "Supplier" : "Issuing Organization";
  const counterpartyLabel =
    profile.entityKind === "supplier" ? "Issuing Organizations" : "Suppliers";
  const counterpartyKind: ContractAwardAnalysisEntityKind =
    profile.counterpartyKind;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-accent">
          {entityLabel} Drilldown
        </div>
        <h2 className="mt-2 text-xl font-semibold text-text-primary">{profile.label}</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Compare this {profile.entityKind} against peers, inspect counterparties, and keep the raw awards table aligned to the same filter set.
        </p>
      </div>

      <AnalysisFilterBar
        filters={filters}
        typeOptions={profile.typeOptions}
        onChange={onFiltersChange}
        onReset={onResetFilters}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AnalysisMetricCard
          label="Award Value"
          value={formatCurrency(profile.summary.totalAwardValue, { compact: true })}
          detail={`${formatCount(profile.summary.totalAwards)} awards`}
          icon={<Scale size={16} />}
        />
        <AnalysisMetricCard
          label={counterpartyLabel}
          value={formatCount(profile.summary.uniqueCounterparties)}
          detail={
            profile.summary.topCounterpartyLabel
              ? `Top: ${profile.summary.topCounterpartyLabel}`
              : "No counterparties"
          }
          icon={<Users size={16} />}
        />
        <AnalysisMetricCard
          label="Median Award"
          value={formatCurrency(profile.summary.medianAwardValue)}
          detail={`Average ${formatCurrency(profile.summary.averageAwardValue)}`}
          icon={<Building2 size={16} />}
        />
        <AnalysisMetricCard
          label="Top Counterparty Share"
          value={formatPercentage(profile.summary.concentrationToTopCounterparty)}
          detail={`${formatDateLabel(profile.summary.firstAwardDate)} to ${formatDateLabel(profile.summary.latestAwardDate)}`}
          icon={<CalendarRange size={16} />}
        />
      </div>

      {profile.summary.totalAwards === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-default px-6 py-16 text-center text-sm text-text-tertiary">
          This entity exists in the dataset, but no awards match the current filters.
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <TrendChartCard
              title="Award Value Trend"
              description="Award value over time for the current entity."
              data={profile.trends}
              dataKey="totalValue"
              color="#72bfff"
              mode="currency"
            />
            <TrendChartCard
              title="Award Count Trend"
              description="Award count over time for the current entity."
              data={profile.trends}
              dataKey="awardCount"
              color="#2fd89f"
              mode="count"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnalysisRankingCard
              title={`${counterpartyLabel} by Value`}
              description={`The strongest counterparties for this ${profile.entityKind}.`}
              rows={profile.counterpartyRankings}
              entityKind={counterpartyKind}
            />
            <BreakdownBarChartCard
              title="Opportunity Type Mix"
              description="Opportunity type composition for the current entity."
              rows={profile.opportunityTypeMix}
              metric="totalValue"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <BreakdownBarChartCard
              title="Award Size Distribution"
              description="Award count by contract value band."
              rows={profile.awardSizeDistribution}
              metric="awardCount"
            />
            <BenchmarkCallout
              benchmark={profile.benchmark}
              concentrationLabel={`Top ${profile.counterpartyKind} share`}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnalysisFindingsPanel findings={profile.findings} />
            <AnalysisDataQualityPanel summary={profile.dataQuality} />
          </div>

          <Card>
            <CardHeader
              eyebrow="Underlying Awards"
              title="Filtered Contract Awards"
            />
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                The table below uses the same filters as the summary metrics and charts above.
              </p>
              <ContractAwardsTable items={profile.awards} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
