import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import type {
  ContractAwardAnalysisFilters,
  ContractAwardEntityProfile,
} from "@bcbid/shared";

import { api } from "@convex/_generated/api";
import { ContractAwardEntityProfileView } from "../../../../components/awards/analysis/ContractAwardEntityProfileView";
import { DEFAULT_ANALYSIS_FILTERS } from "../../../../components/awards/analysis/analysisDefaults";
import { Spinner } from "../../../../components/ui/Spinner";

export const Route = createFileRoute(
  "/contract-awards/analysis/organizations/$organizationKey",
)({
  component: OrganizationAnalysisDetailPage,
});

function OrganizationAnalysisDetailPage() {
  const { organizationKey } = Route.useParams();
  const [filters, setFilters] = useState<ContractAwardAnalysisFilters>(
    DEFAULT_ANALYSIS_FILTERS,
  );
  const runOrganizationProfile = useAction(
    api.contractAwardsAnalysis.organizationProfile,
  );
  const [profile, setProfile] = useState<ContractAwardEntityProfile | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setError(null);
    setProfile(undefined);

    void runOrganizationProfile({
      organizationKey,
      filters,
    })
      .then((result) => {
        if (!cancelled) {
          setProfile(result as ContractAwardEntityProfile | null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load organization analysis.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters, organizationKey, runOrganizationProfile]);

  if (profile === undefined && !error) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={24} />
      </div>
    );
  }

  if (profile === undefined) {
    return (
      <div className="rounded-2xl border border-dashed border-border-default px-6 py-16 text-center text-sm text-text-tertiary">
        {error ?? "Could not load organization analysis."}
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-text-secondary">
          <Link to="/contract-awards/analysis" className="text-accent hover:text-accent-strong">
            Analysis
          </Link>{" "}
          / Issuing Organizations
        </div>
        <div className="rounded-2xl border border-dashed border-border-default px-6 py-16 text-center text-sm text-text-tertiary">
          Issuing organization not found in the imported contract awards dataset.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-secondary">
        <Link to="/contract-awards/analysis" className="text-accent hover:text-accent-strong">
          Analysis
        </Link>{" "}
        / Issuing Organizations / {profile.label}
      </div>
      <ContractAwardEntityProfileView
        profile={profile}
        filters={filters}
        onFiltersChange={setFilters}
        onResetFilters={() => setFilters(DEFAULT_ANALYSIS_FILTERS)}
      />
    </div>
  );
}
