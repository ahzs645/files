import type { ContractAwardAnalysisFilters } from "@bcbid/shared";

export const DEFAULT_ANALYSIS_FILTERS: ContractAwardAnalysisFilters = {
  datePreset: "all",
  fromDate: null,
  toDate: null,
  opportunityType: null,
  includePlaceholderSuppliers: false,
  minimumAwardValue: null,
};
