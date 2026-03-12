import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import {
  AlertTriangle,
  BadgePercent,
  Building2,
  DollarSign,
  FileSignature,
  FileText,
  Scale,
  ShieldAlert,
  Users,
} from "lucide-react";
import type {
  ContractAwardAnalysisOverview,
  ContractAwardAnalysisFilters,
} from "@bcbid/shared";

import { api } from "@convex/_generated/api";
import { AnalysisDataQualityPanel } from "../../components/awards/analysis/AnalysisDataQualityPanel";
import { AnalysisFilterBar } from "../../components/awards/analysis/AnalysisFilterBar";
import { AnalysisFindingsPanel } from "../../components/awards/analysis/AnalysisFindingsPanel";
import { AnalysisMetricCard } from "../../components/awards/analysis/AnalysisMetricCard";
import { AnalysisRankingCard } from "../../components/awards/analysis/AnalysisRankingCard";
import {
  BreakdownBarChartCard,
  TrendChartCard,
  TypeMixStackedBarCard,
} from "../../components/awards/analysis/AnalysisCharts";
import { EntitySearchPanel } from "../../components/awards/analysis/EntitySearchPanel";
import { DEFAULT_ANALYSIS_FILTERS } from "../../components/awards/analysis/analysisDefaults";
import { Spinner } from "../../components/ui/Spinner";
import {
  formatCount,
  formatCurrency,
  formatPercentage,
} from "../../lib/formatting";

export const Route = createFileRoute("/contract-awards/analysis")({
  component: ContractAwardsAnalysisPage,
});

function ContractAwardsAnalysisPage() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (pathname !== "/contract-awards/analysis") {
    return <Outlet />;
  }

  return <ContractAwardsAnalysisHub />;
}

function ContractAwardsAnalysisHub() {
  const [filters, setFilters] = useState<ContractAwardAnalysisFilters>(
    DEFAULT_ANALYSIS_FILTERS,
  );
  const runOverview = useAction(api.contractAwardsAnalysis.overview);
  const [overview, setOverview] = useState<ContractAwardAnalysisOverview | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setError(null);
    setOverview(undefined);

    void runOverview(filters)
      .then((result) => {
        if (!cancelled) {
          setOverview(result as ContractAwardAnalysisOverview);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load analysis.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters, runOverview]);

  if (!overview && !error) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={24} />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="rounded-2xl border border-dashed border-border-default px-6 py-16 text-center text-sm text-text-tertiary">
        {error ?? "Could not load analysis."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">Analysis Hub</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Executive KPIs, analyst drilldowns, concentration views, and quality caveats generated from the imported awards dataset only.
          </p>
        </div>
        <div className="text-sm text-text-secondary">
          {overview.appliedFilters.includePlaceholderSuppliers
            ? "Placeholder suppliers included"
            : "Placeholder suppliers hidden by default"}
        </div>
      </div>

      <AnalysisFilterBar
        filters={filters}
        typeOptions={overview.typeOptions}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_ANALYSIS_FILTERS)}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnalysisMetricCard
          label="Total Award Value"
          value={formatCurrency(overview.summary.totalAwardValue, { compact: true })}
          detail={`${formatCount(overview.summary.totalAwards)} awards in current slice`}
          icon={<DollarSign size={16} />}
        />
        <AnalysisMetricCard
          label="Unique Suppliers"
          value={formatCount(overview.summary.uniqueSuppliers)}
          detail="Supplier entities after current placeholder handling"
          icon={<Users size={16} />}
        />
        <AnalysisMetricCard
          label="Issuing Organizations"
          value={formatCount(overview.summary.uniqueIssuingOrganizations)}
          detail="Organizations represented in the filtered portfolio"
          icon={<Building2 size={16} />}
        />
        <AnalysisMetricCard
          label="Average Award"
          value={formatCurrency(overview.summary.averageAwardValue)}
          detail={`Median ${formatCurrency(overview.summary.medianAwardValue)}`}
          icon={<Scale size={16} />}
        />
        <AnalysisMetricCard
          label="Contract Number Coverage"
          value={formatPercentage(overview.summary.contractNumberCoverage)}
          detail="Share of filtered awards with a contract number"
          icon={<FileSignature size={16} />}
        />
        <AnalysisMetricCard
          label="Justification Coverage"
          value={formatPercentage(overview.summary.justificationCoverage)}
          detail="Justification is treated as descriptive coverage only"
          icon={<FileText size={16} />}
        />
        <AnalysisMetricCard
          label="Placeholder Supplier Share"
          value={formatPercentage(overview.summary.placeholderSupplierShare)}
          detail="The share of rows using placeholder supplier names"
          icon={<ShieldAlert size={16} />}
        />
        <AnalysisMetricCard
          label="Top Supplier Concentration"
          value={formatPercentage(
            overview.supplierRankings.concentration.find((row) => row.key === "top10")
              ?.shareOfValue ?? 0,
          )}
          detail="Value share held by the top 10 suppliers"
          icon={<BadgePercent size={16} />}
        />
        <AnalysisMetricCard
          label="Future-Dated Awards"
          value={formatCount(overview.dataQuality.futureDatedAwardCount)}
          detail="Rows that need date review or source verification"
          icon={<AlertTriangle size={16} />}
        />
      </div>

      <EntitySearchPanel
        includePlaceholderSuppliers={
          overview.appliedFilters.includePlaceholderSuppliers
        }
      />

      {overview.summary.totalAwards === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-default px-6 py-16 text-center text-sm text-text-tertiary">
          No contract awards match the current filters.
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <TrendChartCard
              title="Award Value Trend"
              description="Use the date preset to switch the time grain from yearly to quarterly or monthly."
              data={overview.trends}
              dataKey="totalValue"
              color="#72bfff"
              mode="currency"
            />
            <TrendChartCard
              title="Award Count Trend"
              description="Award counts respond to the same filters as the value trend."
              data={overview.trends}
              dataKey="awardCount"
              color="#2fd89f"
              mode="count"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnalysisRankingCard
              title="Top Suppliers by Award Value"
              description="Suppliers ranked by total award value after current filters are applied."
              rows={overview.supplierRankings.byValue}
              entityKind="supplier"
            />
            <AnalysisRankingCard
              title="Top Suppliers by Award Count"
              description="Suppliers ranked by number of awards."
              rows={overview.supplierRankings.byAwardCount}
              entityKind="supplier"
              metric="count"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <BreakdownBarChartCard
              title="Supplier Concentration"
              description="How much of the filtered award value sits in the leading supplier cohorts."
              rows={overview.supplierRankings.concentration}
              metric="shareOfValue"
            />
            <BreakdownBarChartCard
              title="Supplier Diversity Distribution"
              description="Supplier count by number of issuing organizations served."
              rows={overview.supplierRankings.diversityDistribution}
              metric="awardCount"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnalysisRankingCard
              title="Top Issuing Organizations by Value"
              description="Issuers ranked by total award value."
              rows={overview.organizationRankings.byValue}
              entityKind="organization"
            />
            <AnalysisRankingCard
              title="Top Issuing Organizations by Award Count"
              description="Issuers ranked by number of awards."
              rows={overview.organizationRankings.byAwardCount}
              entityKind="organization"
              metric="count"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnalysisRankingCard
              title="Issuers with Highest Top-Supplier Dependence"
              description="Organizations sorted by the value share held by their top supplier."
              rows={overview.organizationRankings.topSupplierConcentration}
              entityKind="organization"
              metric="share"
            />
            <TypeMixStackedBarCard
              title="Opportunity Type Mix by Issuer"
              description="Top issuers split by opportunity-type value mix."
              rows={overview.organizationRankings.opportunityTypeMix}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnalysisFindingsPanel findings={overview.findings} />
            <AnalysisDataQualityPanel summary={overview.dataQuality} />
          </div>
        </>
      )}
    </div>
  );
}
